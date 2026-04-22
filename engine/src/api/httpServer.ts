import express from "express";
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync } from "fs";
import { join, normalize, relative, dirname, sep } from "path";
import { fileURLToPath } from "url";
import { config } from "../config.js";
import { safeJoin } from "../pathUtils.js";
import type { ChallengeLoader } from "../challenge/ChallengeLoader.js";
import type { ChallengeManifest } from "../challenge/ChallengeLoader.js";
import { buildChallengeCard } from "../challenge/challengeCard.js";
import type { ChallengeRunner } from "../challenge/ChallengeRunner.js";
import type { MarketHistory } from "../market/MarketHistory.js";
import type { TriggerRegistry } from "../triggers/TriggerRegistry.js";
import type { PoolRegistry } from "../market/PoolRegistry.js";
import type { ChainClient } from "../chain/ChainClient.js";
import type { ContractRegistry } from "../challenge/ContractRegistry.js";
import { buildCalldataSelectorMap, decodeCalldataWithMap } from "../chain/CalldataDecoder.js";
import { fetchNftMarketplaceSalesWithLabels } from "../market/fetchNftMarketplaceSales.js";
import { materializeSolveEnvFromEnvSh } from "../player/ForgeRunner.js";

// ── File tree helpers (for solution/ folder management) ───────────────────────

interface FileNode { name: string; path: string; isDir: boolean; readOnly?: boolean; children?: FileNode[]; }

/**
 * Canonical WETH / USDC / DAI from `contracts/out/addresses.json` (Deploy.s.sol).
 * Exposed in connection_info so `solve/env.sh` can emit TOKEN_WETH etc. even when
 * no challenge is running — runner.tokenAddresses is empty until a start().
 */
function baseProtocolTokensFromAddressesFile(): Record<string, string> {
  const out: Record<string, string> = {};
  const f = config.addressesFile;
  if (!existsSync(f)) return out;
  try {
    const raw = JSON.parse(readFileSync(f, "utf-8")) as Record<string, unknown>;
    const pairs: [string, string][] = [
      ["weth", "WETH"],
      ["usdc", "USDC"],
      ["dai", "DAI"],
    ];
    for (const [jsonKey, symbol] of pairs) {
      const addr = raw[jsonKey];
      if (typeof addr === "string" && addr.startsWith("0x")) out[symbol] = addr;
    }
  } catch { /* ignore malformed */ }
  return out;
}

function buildFileTree(absDir: string, relBase: string): FileNode[] {
  return readdirSync(absDir, { withFileTypes: true })
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .map(entry => {
      const absPath = join(absDir, entry.name);
      const relPath = relative(relBase, absPath);
      if (entry.isDirectory()) {
        return { name: entry.name, path: relPath, isDir: true, children: buildFileTree(absPath, relBase) };
      }
      return { name: entry.name, path: relPath, isDir: false };
    });
}

/** Like buildFileTree but only includes .sol files (and directories that contain them).
 *  Files inside a lib/ directory (at any depth) are marked readOnly: true.
 */
function buildSolFileTree(absDir: string, relBase: string, readOnly = false): FileNode[] {
  const entries = readdirSync(absDir, { withFileTypes: true })
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  const result: FileNode[] = [];
  for (const entry of entries) {
    const absPath = join(absDir, entry.name);
    const relPath = relative(relBase, absPath);
    if (entry.isDirectory()) {
      const isLib = entry.name === "lib";
      const childReadOnly = readOnly || isLib;
      const children = buildSolFileTree(absPath, relBase, childReadOnly);
      // Only include the directory if it contains at least one .sol file
      if (children.length > 0) {
        result.push({ name: entry.name, path: relPath, isDir: true, readOnly: childReadOnly, children });
      }
    } else if (entry.name.endsWith(".sol")) {
      result.push({ name: entry.name, path: relPath, isDir: false, ...(readOnly ? { readOnly: true } : {}) });
    }
  }
  return result;
}

/** Absolute path to the contracts/src directory (for lib/ population). */
const CONTRACTS_SRC_DIR = join(fileURLToPath(import.meta.url), "../../../../contracts/src");

/**
 * Maps special contract type strings to their Solidity source file names.
 * Mirrors the logic in ChallengeRunner._upgradeableArtifactName().
 */
function resolveContractTypeName(type: string): string {
  switch (type) {
    case "upgradeable-erc20-impl": return "ERC20Implementation";
    case "upgradeable-erc20":      return "UpgradeableERC20";
    case "vault-impl":             return "VaultImplementation";
    case "uninitialized-proxy":    return "UninitializedProxy";
    case "amm-proxy":              return "UpgradeableAMM";
    case "amm-proxy-impl":         return "ConstantProductAMMImpl";
    default:                       return type;
  }
}

/**
 * Find a .sol file in contracts/src by contract name.
 * Returns the absolute path if found, null otherwise.
 */
function findContractSource(contractName: string): string | null {
  const search = (dir: string): string | null => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = search(absPath);
        if (found) return found;
      } else if (entry.name === `${contractName}.sol`) {
        return absPath;
      }
    }
    return null;
  };
  return search(CONTRACTS_SRC_DIR);
}

/**
 * Populate (or refresh) the lib/ subdirectory of a challenge's solve workspace
 * with read-only copies of the relevant contract source files.
 * Always overwrites so that lib/ stays in sync with contracts/src/.
 */
function populateLibDir(challengeId: string, manifest: ChallengeManifest, challengeDir: string): void {
  if (!manifest.contracts || manifest.contracts.length === 0) return;

  const libDir = join(challengeDir, "lib");
  if (!existsSync(libDir)) mkdirSync(libDir, { recursive: true });

  for (const contract of manifest.contracts) {
    const contractName = resolveContractTypeName(contract.type);
    const srcPath = findContractSource(contractName);
    if (!srcPath) {
      console.warn(`[populateLibDir] could not find source for contract type "${contract.type}" (resolved: "${contractName}") in challenge ${challengeId}`);
      continue;
    }
    const destPath = join(libDir, `${contractName}.sol`);
    try {
      copyFileSync(srcPath, destPath);
    } catch (e) {
      console.warn(`[populateLibDir] failed to copy ${srcPath} to ${destPath}:`, e);
    }
  }
}

// safeResolve has been superseded by the shared safeJoin() utility (../pathUtils.ts).
// safeJoin canonicalises via path.resolve() (defence-in-depth beyond regex sanitisation)
// and uses a trailing-separator prefix check to prevent /root-prefix-attacks.

/** Return the solution/ directory for a challenge, creating it if needed. */
function getSolutionDir(loader: ChallengeLoader, id: string): string | null {
  const challengeDir = loader.getDir(id);
  if (!challengeDir) return null;
  // Canonicalize: ensure "solution" resolves strictly within challengeDir.
  const solutionDir = safeJoin(challengeDir, "solution");
  if (!solutionDir) return null;
  if (!existsSync(solutionDir)) mkdirSync(solutionDir, { recursive: true });
  return solutionDir;
}

/** Absolute path to the solve/ Foundry workspace (lives next to engine/). */
const SOLVE_DIR = join(fileURLToPath(import.meta.url), "../../../../solve");

/**
 * Return the per-challenge Solidity source directory inside the solve/ workspace.
 * Creates the directory (and seeds a Script.s.sol template) if it doesn't exist yet.
 * Returns null if challengeId is invalid (contains path traversal characters).
 */
function getChallengeSolveDir(challengeId: string): string | null {
  // First line of defence: only allow alphanumerics, hyphens, and underscores.
  if (!challengeId || !/^[a-zA-Z0-9_-]+$/.test(challengeId)) return null;

  // Second line of defence: canonicalize via path.resolve() and assert the
  // result stays within solve/challenges/. This catches any bypass (symlinks,
  // encoded characters, platform quirks) that slips past the regex.
  const challengesRoot = join(SOLVE_DIR, "challenges");
  const dir = safeJoin(challengesRoot, challengeId);
  if (!dir) return null;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // Seed a starter script if the directory is empty of .sol files.
  // Prefer the per-challenge Script.s.sol from solve/challenge-templates/<id>/Script.s.sol,
  // then fall back to the master template at solve/script/Solve.s.sol.
  // Only use the inline minimal stub if neither exists.
  const hasSolFiles = readdirSync(dir).some(f => f.endsWith(".sol"));
  if (!hasSolFiles) {
    // Try per-challenge template first (tracked in solve/challenge-templates/)
    const challengeTemplatePath = join(SOLVE_DIR, "challenge-templates", challengeId, "Script.s.sol");
    const masterTemplatePath    = join(SOLVE_DIR, "script", "Solve.s.sol");
    let seedContent: string;
    if (existsSync(challengeTemplatePath)) {
      seedContent = readFileSync(challengeTemplatePath, "utf-8");
    } else if (existsSync(masterTemplatePath)) {
      seedContent = readFileSync(masterTemplatePath, "utf-8");
    } else {
      seedContent = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";

/**
 * @title  Solve script for ${challengeId}
 * @notice Run with: forge script challenges/${challengeId}/Script.s.sol --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast
 */
contract SolveScript is Script {
    function run() external {
        uint256 playerKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(playerKey);

        // TODO: add your exploit here

        vm.stopBroadcast();
    }
}
`;
    }
    writeFileSync(join(dir, "Script.s.sol"), seedContent, "utf-8");
  }

  return dir;
}

/**
 * Sanitise an internal Error for client-facing responses.
 * Returns the error message text but strips absolute filesystem paths that
 * could reveal the server's directory layout.  Stack traces are never included.
 */
function safeErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  // Replace any substring that looks like an absolute path
  // (e.g. /home/kali/defi-ctf/engine/src/...).
  return msg.replace(/\/[^\s'",]*/g, "[path]");
}

export function createHttpServer(
  loader:           ChallengeLoader,
  runner:           ChallengeRunner,
  history:          MarketHistory,
  registry:         TriggerRegistry,
  pools:            PoolRegistry,
  client:           ChainClient,
  contractRegistry: ContractRegistry,
) {
  const app = express();
  // Limit JSON body size to 1 MB to prevent memory exhaustion from oversized
  // payloads (e.g. a script_run or file write with megabytes of content).
  app.use(express.json({ limit: "1mb" }));

  // ── Challenge-start mutex ────────────────────────────────────────────────────
  // Prevents two concurrent POST /api/challenge/start requests from interleaving
  // their deployment steps and leaving the chain in a partial/corrupt state.
  // Only one start is allowed at a time; the second caller gets a 409 immediately.
  let _startInFlight = false;

  // CORS for local dev
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.sendStatus(204); return; }
    next();
  });

  // Health check
  app.get("/health", (_req, res) => res.json({ ok: true }));

  // Connection info — everything a Foundry/cast workflow needs in one call.
  //
  // Security note: this endpoint intentionally exposes the player's private key
  // so that players can copy it into their local Foundry / cast workflow.  This
  // is by design: the key is for a throwaway Anvil wallet with no real funds.
  // The engine runs entirely locally (or inside a Docker container) and the key
  // has no value outside the challenge context.  Do NOT change this to serve
  // real keys or production credentials.
  app.get("/api/connection_info", (_req, res) => {
    const playerSigner = client.getPlayerSigner();

    // Tokens: base protocol addresses (always), then challenge runner (overrides),
    // then live pool token addresses (same symbols as AMM reserves).
    const tokens: Record<string, string> = baseProtocolTokensFromAddressesFile();
    for (const [sym, addr] of runner.tokenAddresses) {
      tokens[sym] = addr;
    }
    for (const pool of pools.getAllPools()) {
      tokens[pool.symbol0] = pool.token0;
      tokens[pool.symbol1] = pool.token1;
    }

    // Build contracts map from the live registry
    const contracts: Record<string, string> = {};
    for (const id of contractRegistry.list()) {
      contracts[id] = contractRegistry.getAddress(id);
    }

    // Build pools map — each entry is a rich object with address, exchange, displayName, tokens
    const poolMap: Record<string, {
      address:     string;
      exchange:    string;
      displayName: string;
      tokenA:      string;
      tokenB:      string;
    }> = {};
    for (const pool of pools.getAllPools()) {
      poolMap[pool.id] = {
        address:     pool.address,
        exchange:    pool.exchange,
        displayName: pool.displayName,
        tokenA:      pool.symbol0,
        tokenB:      pool.symbol1,
      };
    }

    // Build botAccounts map — exposes bot addresses for challenges that need them
    // (e.g. long-squeeze, cascade where the player must know who to liquidate).
    // Keyed by botAccount index.
    const botAccounts: Record<string, string> = {};
    const manifest = runner.manifest;
    if (manifest?.botPositions && manifest.botPositions.length > 0) {
      for (const pos of manifest.botPositions) {
        const idx = pos.botAccount;
        const addr = client.getSigner(idx).address;
        botAccounts[String(idx)] = addr;
      }
    }

    res.json({
      rpcUrl:  `http://127.0.0.1:${config.anvilPort}`,
      chainId: config.chainId,
      player: {
        address:    playerSigner.address,
        privateKey: playerSigner.privateKey,
      },
      contracts,
      tokens,
      pools: poolMap,
      ...(Object.keys(botAccounts).length > 0 ? { botAccounts } : {}),
    });
  });

  // List challenges
  app.get("/api/challenges", (_req, res) => {
    res.json(loader.list().map(buildChallengeCard));
  });

  // Get challenge state
  app.get("/api/challenge/state", (_req, res) => {
    res.json(runner.getState());
  });

  // Start challenge
  app.post("/api/challenge/start", async (req, res) => {
    const { challengeId } = req.body as { challengeId?: string };
    if (!challengeId) { res.status(400).json({ error: "challengeId required" }); return; }
    const manifest = loader.get(challengeId);
    if (!manifest) { res.status(404).json({ error: "challenge not found" }); return; }

    // Mutex guard: reject concurrent starts immediately so two racing requests
    // cannot interleave their deployment steps and corrupt chain state.
    if (_startInFlight) {
      res.status(409).json({ error: "Challenge start already in progress" });
      return;
    }
    _startInFlight = true;
    try {
      await runner.start(manifest);

      // Regenerate solve/.env after a successful start so the player's .env file
      // is always up to date with the current challenge's contract addresses,
      // RPC URL, and private key — without requiring a manual ./env.sh call.
      const engineUrl = `http://127.0.0.1:${config.httpPort}`;
      materializeSolveEnvFromEnvSh(engineUrl).then((result) => {
        if (result.ok) {
          console.log("[httpServer] solve/.env refreshed after challenge start");
        } else {
          console.warn("[httpServer] solve/.env refresh failed:", result.error);
        }
      }).catch(() => {});

      res.json({ ok: true });
    } catch (e) {
      // Log full error server-side for debugging; send sanitized message to client.
      console.error("[httpServer] challenge start error:", e);
      // On failure, the runner's internal _starting flag has been reset (via its
      // own finally block), so subsequent start attempts are allowed.  We do NOT
      // need to call runner.stop() here — ChallengeRunner.start() already reverts
      // to the last clean snapshot on entry and its finally block resets _starting.
      res.status(500).json({ error: safeErrorMessage(e) });
    } finally {
      _startInFlight = false;
    }
  });

  // Stop challenge
  app.post("/api/challenge/stop", async (_req, res) => {
    await runner.stop();
    res.json({ ok: true });
  });

  // Environment variables — returns the current solve/.env contents as a raw
  // key=value string and as a parsed key→value map so the IDE can display them.
  // Also triggers a fresh env.sh run to ensure values are up to date.
  app.get("/api/env", async (_req, res) => {
    const engineUrl = `http://127.0.0.1:${config.httpPort}`;
    const result = await materializeSolveEnvFromEnvSh(engineUrl);
    if (!result.ok) {
      // env.sh failed (no challenge running, or curl/jq not installed).
      // Return an empty-but-valid payload so the UI can show a helpful message.
      res.json({ ok: false, error: result.error, vars: {}, raw: "" });
      return;
    }
    // Re-read the raw .env file so the response includes comments and formatting.
    const envPath = join(SOLVE_DIR, ".env");
    let raw = "";
    try { raw = readFileSync(envPath, "utf-8"); } catch { /* fallback to empty */ }
    res.json({ ok: true, vars: result.vars, raw });
  });

  // Control: pause/resume/fast-forward
  app.post("/api/control", async (req, res) => {
    const { action, blocks } = req.body as { action: string; blocks?: number };
    switch (action) {
      case "pause":        runner.pause();  break;
      case "resume":       runner.resume(); break;
      case "fast_forward": {
        // Cap fast-forward at 500 blocks per call to prevent DoS via a very
        // large value that would monopolise the engine's event loop.
        const safeBlocks = Math.min(Math.max(1, Math.floor(blocks ?? 10)), 500);
        await runner.fastForward(safeBlocks);
        break;
      }
      default: res.status(400).json({ error: "unknown action" }); return;
    }
    res.json({ ok: true });
  });

  // Block explorer — returns full block data with transactions
  // GET /api/blocks?from=<blockNum>&limit=<n>
  // from=0 or missing → most recent `limit` blocks (up to 100)
  app.get("/api/blocks", async (req, res) => {
    try {
      // Parse and clamp inputs to safe integer ranges to prevent integer overflow
      // in `fromBlock + limit - 1` and to avoid sending very large block numbers
      // to the Anvil JSON-RPC provider which may behave unexpectedly.
      const fromBlock = Math.max(0, parseInt(req.query.from as string) || 0);
      const limit     = Math.min(parseInt(req.query.limit as string) || 50, 100);

      const latestBlock = await client.provider.getBlock("latest");
      if (!latestBlock) { res.json({ blocks: [] }); return; }
      const latest = latestBlock.number;

      let blockNumbers: number[];
      if (!fromBlock || fromBlock <= 0) {
        const start = Math.max(0, latest - limit + 1);
        blockNumbers = [];
        for (let n = start; n <= latest; n++) blockNumbers.push(n);
      } else {
        const end = Math.min(fromBlock + limit - 1, latest);
        blockNumbers = [];
        for (let n = fromBlock; n <= end; n++) blockNumbers.push(n);
      }

      // Build selector map once for the whole batch to avoid rebuilding
      // it per-transaction.
      const selectorMap = buildCalldataSelectorMap(contractRegistry);

      const blocks = await Promise.all(
        blockNumbers.map(async (n) => {
          try {
            const blk = await client.provider.getBlock(n, true);
            if (!blk) return null;
            const txs = blk.prefetchedTransactions ?? [];
            const transactions = await Promise.all(txs.map(async (tx) => {
              let gasUsed = "0";
              try {
                const rcpt = await client.provider.getTransactionReceipt(tx.hash);
                gasUsed = rcpt ? rcpt.gasUsed.toString() : "0";
              } catch { /* best-effort */ }

              const decoded = decodeCalldataWithMap(tx.data, selectorMap);

              return {
                hash:        tx.hash,
                from:        tx.from,
                to:          tx.to ?? null,
                value:       tx.value.toString(),
                input:       tx.data,
                gasUsed,
                blockNumber: n,
                decoded,
              };
            }));
            return { number: blk.number, timestamp: blk.timestamp, hash: blk.hash ?? "", transactions };
          } catch { return null; }
        }),
      );

      res.json({ blocks: blocks.filter(Boolean) });
    } catch (e) {
      res.status(500).json({ error: safeErrorMessage(e) });
    }
  });

  // Price history — accepts poolId (e.g. "weth-usdc-uniswap") as the path parameter.
  // The route param is named :poolId; a :pair alias is kept at the same path for
  // backward compatibility (both names resolve to the same lookup).
  app.get("/api/history/:poolId", (req, res) => {
    const poolId = req.params.poolId;
    // Cap lastN to 1 000 to prevent memory exhaustion from a malicious or
    // accidental request for millions of candles.
    const lastN = Math.min(Math.max(1, parseInt(req.query.lastN as string) || 200), 1000);
    res.json(history.getCandles(poolId, lastN));
  });

  // Challenge README (raw markdown)
  app.get("/api/challenge/:id/readme", (req, res) => {
    const dir = loader.getDir(req.params.id);
    if (!dir) { res.status(404).json({ error: "challenge not found" }); return; }
    // Canonicalize: even though "README.md" is a static name, use safeJoin to
    // ensure the challenge directory itself hasn't been set to an unexpected value.
    const readmePath = safeJoin(dir, "README.md");
    if (!readmePath) { res.status(400).json({ error: "invalid path" }); return; }
    if (!existsSync(readmePath)) { res.status(404).json({ error: "no readme" }); return; }
    res.type("text/plain; charset=utf-8").send(readFileSync(readmePath, "utf-8"));
  });

  // Challenge JS template — returns solve/challenge-templates/<id>/solve.js if it exists,
  // falling back to the master solve/script/solve.js for non-tutorial challenges.
  // The IDE seeds a new player solution file with this content on first visit.
  app.get("/api/challenge/:id/template", (req, res) => {
    const challengeId = req.params.id;
    if (!challengeId || !/^[a-zA-Z0-9_-]+$/.test(challengeId)) {
      res.status(400).json({ error: "invalid challenge id" }); return;
    }
    if (!loader.get(challengeId)) {
      res.status(404).json({ error: "challenge not found" }); return;
    }
    const templatePath = join(SOLVE_DIR, "challenge-templates", challengeId, "solve.js");
    const masterPath   = join(SOLVE_DIR, "script", "solve.js");
    const path = existsSync(templatePath) ? templatePath : existsSync(masterPath) ? masterPath : null;
    if (!path) { res.status(404).json({ error: "no template" }); return; }
    res.type("text/plain; charset=utf-8").send(readFileSync(path, "utf-8"));
  });

  // Solidity template — returns solve/challenge-templates/<id>/Script.s.sol if it exists and is non-empty,
  // falling back to the master solve/script/Solve.s.sol.
  // Used by the IDE to seed the Solidity workspace on first visit for non-tutorial challenges.
  app.get("/api/challenge/:id/solidity-template", (req, res) => {
    const challengeId = req.params.id;
    if (!challengeId || !/^[a-zA-Z0-9_-]+$/.test(challengeId)) {
      res.status(400).json({ error: "invalid challenge id" }); return;
    }
    if (!loader.get(challengeId)) {
      res.status(404).json({ error: "challenge not found" }); return;
    }
    const challengeScriptPath = join(SOLVE_DIR, "challenge-templates", challengeId, "Script.s.sol");
    const masterPath           = join(SOLVE_DIR, "script", "Solve.s.sol");
    let filePath: string | null = null;
    if (existsSync(challengeScriptPath)) {
      const content = readFileSync(challengeScriptPath, "utf-8");
      if (content.trim().length > 0) filePath = challengeScriptPath;
    }
    if (!filePath && existsSync(masterPath)) filePath = masterPath;
    if (!filePath) { res.status(404).json({ error: "no solidity template" }); return; }
    res.type("text/plain; charset=utf-8").send(readFileSync(filePath, "utf-8"));
  });

  // Triggers list
  app.get("/api/triggers", (_req, res) => {
    res.json(registry.list());
  });

  // Pool depth data — real-time liquidity info for each active pool
  app.get("/api/pools", async (_req, res) => {
    try {
      const allPools = pools.getAllPools();
      if (allPools.length === 0) {
        res.json([]);
        return;
      }
      const result = await Promise.all(allPools.map(async (info) => {
        try {
          const { reserve0, reserve1 } = await pools.getReserves(info.id);
          const depth = await pools.getDepth(info.id);
          const spotPrice = Number(reserve1) / 10 ** info.decimals1 /
                           (Number(reserve0) / 10 ** info.decimals0);
          const tvlEst = 2 * (Number(reserve1) / 10 ** info.decimals1);
          return {
            id:        info.id,
            symbol0:   info.symbol0,
            symbol1:   info.symbol1,
            decimals0: info.decimals0,
            decimals1: info.decimals1,
            spotPrice,
            tvlEst,
            reserve0:  reserve0.toString(),
            reserve1:  reserve1.toString(),
            depth: {
              spotPrice: depth.spotPrice,
              tvlUSD:    depth.tvlUSD,
              ask: depth.ask.map(l => ({ bps: l.bps, token0Delta: l.token0Delta.toString(), usdApprox: l.usdApprox })),
              bid: depth.bid.map(l => ({ bps: l.bps, token0Delta: l.token0Delta.toString(), usdApprox: l.usdApprox })),
            },
          };
        } catch {
          return null;
        }
      }));
      res.json(result.filter(Boolean));
    } catch (e) {
      res.status(500).json({ error: safeErrorMessage(e) });
    }
  });

  // ── Solution folder file management ────────────────────────────────────────

  // List files in the challenge's solution/ directory (tree structure)
  app.get("/api/challenge/:id/files", (req, res) => {
    const solutionDir = getSolutionDir(loader, req.params.id);
    if (!solutionDir) { res.status(404).json({ error: "challenge not found" }); return; }
    res.json(buildFileTree(solutionDir, solutionDir));
  });

  // Get the content of a single file
  app.get("/api/challenge/:id/file", (req, res) => {
    const solutionDir = getSolutionDir(loader, req.params.id);
    if (!solutionDir) { res.status(404).json({ error: "challenge not found" }); return; }
    const relPath = req.query.path as string;
    if (!relPath) { res.status(400).json({ error: "path required" }); return; }
    const abs = safeJoin(solutionDir, relPath);
    if (!abs) { res.status(400).json({ error: "invalid path" }); return; }
    if (!existsSync(abs) || statSync(abs).isDirectory()) {
      res.status(404).json({ error: "file not found" }); return;
    }
    res.type("text/plain; charset=utf-8").send(readFileSync(abs, "utf-8"));
  });

  // Create or overwrite a file (directories are created automatically)
  app.post("/api/challenge/:id/file", (req, res) => {
    const solutionDir = getSolutionDir(loader, req.params.id);
    if (!solutionDir) { res.status(404).json({ error: "challenge not found" }); return; }
    const { path: relPath, content } = req.body as { path?: string; content?: string };
    if (!relPath) { res.status(400).json({ error: "path required" }); return; }
    // Enforce a per-file content size cap (512 KB) so the file endpoint cannot
    // be used to exhaust disk space on the host.  The express body-size limit
    // (1 MB) is the outer bound; this per-file check is an additional guard.
    const MAX_FILE_BYTES = 512 * 1024;
    if (content && Buffer.byteLength(content, "utf-8") > MAX_FILE_BYTES) {
      res.status(413).json({ error: "file content exceeds 512 KB limit" }); return;
    }
    const abs = safeJoin(solutionDir, relPath);
    if (!abs) { res.status(400).json({ error: "invalid path" }); return; }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content ?? "", "utf-8");
    res.json({ ok: true });
  });

  // Delete a file or directory (recursive)
  app.delete("/api/challenge/:id/file", (req, res) => {
    const solutionDir = getSolutionDir(loader, req.params.id);
    if (!solutionDir) { res.status(404).json({ error: "challenge not found" }); return; }
    const relPath = req.query.path as string;
    if (!relPath) { res.status(400).json({ error: "path required" }); return; }
    const abs = safeJoin(solutionDir, relPath);
    if (!abs) { res.status(400).json({ error: "invalid path" }); return; }
    if (!existsSync(abs)) { res.status(404).json({ error: "not found" }); return; }
    if (normalize(abs) === normalize(solutionDir)) {
      res.status(400).json({ error: "cannot delete root solution directory" }); return;
    }
    rmSync(abs, { recursive: true, force: true });
    res.json({ ok: true });
  });

  // ── Solve workspace file management ────────────────────────────────────────
  // All endpoints are scoped to solve/challenges/<challengeId>/ and only expose .sol files.

  // List .sol files in the per-challenge solve directory.
  // Query param: ?challenge=<challengeId> (required)
  app.get("/api/solve/files", (req, res) => {
    const challengeId = req.query.challenge as string;
    if (!challengeId) { res.status(400).json({ error: "challenge query param required" }); return; }
    if (!existsSync(SOLVE_DIR)) { res.status(404).json({ error: "solve workspace not found" }); return; }
    const challengeDir = getChallengeSolveDir(challengeId);
    if (!challengeDir) { res.status(400).json({ error: "invalid challenge id" }); return; }
    // Populate lib/ with read-only contract sources for any challenge that has contracts
    const manifest = loader.get(challengeId);
    if (manifest && manifest.contracts && manifest.contracts.length > 0) {
      try { populateLibDir(challengeId, manifest, challengeDir); } catch (e) {
        console.warn("[api/solve/files] populateLibDir error:", e);
      }
    }
    res.json(buildSolFileTree(challengeDir, challengeDir));
  });

  // Get the content of a single .sol file inside the challenge's solve directory.
  // Query params: ?challenge=<challengeId>&path=<relPath>
  app.get("/api/solve/file", (req, res) => {
    const challengeId = req.query.challenge as string;
    const relPath = req.query.path as string;
    if (!challengeId) { res.status(400).json({ error: "challenge query param required" }); return; }
    if (!relPath) { res.status(400).json({ error: "path required" }); return; }
    const challengeDir = getChallengeSolveDir(challengeId);
    if (!challengeDir) { res.status(400).json({ error: "invalid challenge id" }); return; }
    const abs = safeJoin(challengeDir, relPath);
    if (!abs) { res.status(400).json({ error: "invalid path" }); return; }
    if (!existsSync(abs) || statSync(abs).isDirectory()) {
      res.status(404).json({ error: "file not found" }); return;
    }
    res.type("text/plain; charset=utf-8").send(readFileSync(abs, "utf-8"));
  });

  // Create or overwrite a .sol file inside the challenge's solve directory.
  // Body: { challenge: string; path: string; content?: string }
  app.post("/api/solve/file", (req, res) => {
    const { challenge: challengeId, path: relPath, content } = req.body as { challenge?: string; path?: string; content?: string };
    if (!challengeId) { res.status(400).json({ error: "challenge required" }); return; }
    if (!relPath) { res.status(400).json({ error: "path required" }); return; }
    // Enforce a per-file content size cap (512 KB) so the Solidity file endpoint
    // cannot be used to exhaust disk space on the host.
    const MAX_FILE_BYTES = 512 * 1024;
    if (content && Buffer.byteLength(content, "utf-8") > MAX_FILE_BYTES) {
      res.status(413).json({ error: "file content exceeds 512 KB limit" }); return;
    }
    const challengeDir = getChallengeSolveDir(challengeId);
    if (!challengeDir) { res.status(400).json({ error: "invalid challenge id" }); return; }
    const abs = safeJoin(challengeDir, relPath);
    if (!abs) { res.status(400).json({ error: "invalid path" }); return; }
    if (abs.includes(`${sep}lib${sep}`) || abs.endsWith(`${sep}lib`)) {
      res.status(403).json({ error: "lib/ files are read-only" }); return;
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content ?? "", "utf-8");
    res.json({ ok: true });
  });

  // Delete a .sol file or directory inside the challenge's solve directory.
  // Query params: ?challenge=<challengeId>&path=<relPath>
  app.delete("/api/solve/file", (req, res) => {
    const challengeId = req.query.challenge as string;
    const relPath = req.query.path as string;
    if (!challengeId) { res.status(400).json({ error: "challenge query param required" }); return; }
    if (!relPath) { res.status(400).json({ error: "path required" }); return; }
    const challengeDir = getChallengeSolveDir(challengeId);
    if (!challengeDir) { res.status(400).json({ error: "invalid challenge id" }); return; }
    const abs = safeJoin(challengeDir, relPath);
    if (!abs) { res.status(400).json({ error: "invalid path" }); return; }
    if (abs.includes(`${sep}lib${sep}`) || abs.endsWith(`${sep}lib`)) {
      res.status(403).json({ error: "lib/ files are read-only" }); return;
    }
    if (!existsSync(abs)) { res.status(404).json({ error: "not found" }); return; }
    if (normalize(abs) === normalize(challengeDir)) {
      res.status(400).json({ error: "cannot delete challenge solve directory root" }); return;
    }
    rmSync(abs, { recursive: true, force: true });
    res.json({ ok: true });
  });

  // ── NFT endpoints ──────────────────────────────────────────────────────────

  const NFT_COLLECTION_ABI = [
    "function totalSupply() view returns (uint256)",
    "function rarityScore(uint256 tokenId) view returns (uint8)",
    "function revealed() view returns (bool)",
    "function getTokensOfOwner(address owner) view returns (uint256[])",
  ];

  const NFT_MARKETPLACE_ABI = [
    "function getListings() view returns (uint256[] tokenIds, address[] sellers, uint256[] prices)",
    "function floorPrice() view returns (uint256)",
    "function listings(uint256) view returns (address seller, uint256 price, bool active)",
    "function collection() view returns (address)",
  ];

  /**
   * GET /api/nft/:contractId/listings
   * Returns active listings with rarity scores.
   * :contractId must be an NFTMarketplace contract id.
   */
  app.get("/api/nft/:contractId/listings", async (req, res) => {
    try {
      const mktAddr = contractRegistry.getAddress(req.params.contractId);
      const marketplace = new (await import("ethers")).ethers.Contract(mktAddr, NFT_MARKETPLACE_ABI, client.provider);

      const [tokenIds, sellers, prices]: [bigint[], string[], bigint[]] = await marketplace.getListings();
      const collectionAddr: string = await marketplace.collection();
      const collection = new (await import("ethers")).ethers.Contract(collectionAddr, NFT_COLLECTION_ABI, client.provider);
      const isRevealed: boolean = await collection.revealed();

      const result = await Promise.all(tokenIds.map(async (tid, i) => {
        let rarityScoreVal = 0;
        if (isRevealed) {
          try { rarityScoreVal = Number(await collection.rarityScore(tid)); } catch {}
        }
        return {
          tokenId:     tid.toString(),
          seller:      sellers[i],
          price:       (await import("ethers")).ethers.formatEther(prices[i]),
          rarityScore: rarityScoreVal,
        };
      }));

      res.json(result);
    } catch (e) {
      res.status(500).json({ error: safeErrorMessage(e) });
    }
  });

  /**
   * GET /api/nft/:contractId/owned?address=0x...
   * Returns tokenIds + rarity scores owned by the address.
   * :contractId must be an NFTMarketplace contract id (we find the collection from it).
   */
  app.get("/api/nft/:contractId/owned", async (req, res) => {
    try {
      const ownerAddr = req.query.address as string;
      if (!ownerAddr) { res.status(400).json({ error: "address required" }); return; }

      const mktAddr = contractRegistry.getAddress(req.params.contractId);
      const marketplace = new (await import("ethers")).ethers.Contract(mktAddr, NFT_MARKETPLACE_ABI, client.provider);
      const collectionAddr: string = await marketplace.collection();
      const collection = new (await import("ethers")).ethers.Contract(collectionAddr, NFT_COLLECTION_ABI, client.provider);

      const tokenIds: bigint[] = await collection.getTokensOfOwner(ownerAddr);
      const isRevealed: boolean = await collection.revealed();

      const result = await Promise.all(tokenIds.map(async (tid) => {
        let rarityScoreVal = 0;
        if (isRevealed) {
          try { rarityScoreVal = Number(await collection.rarityScore(tid)); } catch {}
        }
        return { tokenId: tid.toString(), rarityScore: rarityScoreVal };
      }));

      res.json(result);
    } catch (e) {
      res.status(500).json({ error: safeErrorMessage(e) });
    }
  });

  /**
   * GET /api/nft/:contractId/floor
   * Returns { floorPrice: "0.5", tokenId: "42" } or null.
   * :contractId must be an NFTMarketplace contract id.
   */
  app.get("/api/nft/:contractId/floor", async (req, res) => {
    try {
      const mktAddr = contractRegistry.getAddress(req.params.contractId);
      const marketplace = new (await import("ethers")).ethers.Contract(mktAddr, NFT_MARKETPLACE_ABI, client.provider);

      const floor: bigint = await marketplace.floorPrice();
      if (floor === 0n) {
        res.json(null);
        return;
      }

      // Find the tokenId at floor price
      const [tokenIds, , prices]: [bigint[], string[], bigint[]] = await marketplace.getListings();
      let floorTokenId: string | null = null;
      for (let i = 0; i < tokenIds.length; i++) {
        if (prices[i] === floor) { floorTokenId = tokenIds[i].toString(); break; }
      }

      res.json({
        floorPrice: (await import("ethers")).ethers.formatEther(floor),
        tokenId: floorTokenId,
      });
    } catch (e) {
      res.status(500).json({ error: safeErrorMessage(e) });
    }
  });

  /**
   * GET /api/nft/:contractId/sales
   * Returns every `Sold` event from the marketplace on the current chain state
   * (player + bot trades), newest first, with address-book labels for the UI.
   */
  app.get("/api/nft/:contractId/sales", async (req, res) => {
    try {
      const contractId = req.params.contractId;
      if (!contractRegistry.list().includes(contractId)) {
        res.json([]);
        return;
      }
      const mktAddr = contractRegistry.getAddress(contractId);
      const latest    = await client.provider.getBlockNumber();
      const addressBook = runner.getState().addressBook ?? {};
      const sales = await fetchNftMarketplaceSalesWithLabels(
        client.provider,
        mktAddr,
        0,
        latest,
        addressBook,
      );
      res.json(sales);
    } catch (e) {
      res.status(500).json({ error: safeErrorMessage(e) });
    }
  });

  return app;
}
