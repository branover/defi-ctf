import { WebSocketServer, WebSocket } from "ws";
import { ethers } from "ethers";
import type { Server } from "http";
import type { ChallengeRunner } from "../challenge/ChallengeRunner.js";
import type { MiningController } from "../chain/MiningController.js";
import type { ChallengeLoader } from "../challenge/ChallengeLoader.js";
import type { ScriptSandbox } from "../player/ScriptSandbox.js";
import type { RunForgeScriptFn } from "../player/ScriptSandbox.js";
import type { PlayerSession } from "../player/PlayerSession.js";
import type { TriggerRegistry } from "../triggers/TriggerRegistry.js";
import type { ChainClient } from "../chain/ChainClient.js";
import type { PoolRegistry } from "../market/PoolRegistry.js";
import type { ContractRegistry } from "../challenge/ContractRegistry.js";
import { runForgeScript, deployContract, materializeSolveEnvFromEnvSh, type ForgeLogMessage } from "../player/ForgeRunner.js";
import { buildChallengeCard } from "../challenge/challengeCard.js";
import { buildCalldataSelectorMap, decodeCalldataWithMap } from "../chain/CalldataDecoder.js";
import { config } from "../config.js";
import { safeJoin } from "../pathUtils.js";
import { join } from "path";
import { fileURLToPath } from "url";
import { recordSale } from "../market/NftSalesStore.js";

/** Absolute path to the solve/ Foundry workspace (lives next to engine/). */
const SOLVE_DIR = join(fileURLToPath(import.meta.url), "../../../../solve");

/**
 * Build the environment record that forge/cast processes receive.
 * Mirrors the shape of /api/connection_info but as flat env vars matching solve/.env format.
 */
function buildForgeEnv(
  session:          PlayerSession,
  client:           ChainClient,
  pools:            PoolRegistry,
  contractRegistry: ContractRegistry,
): Record<string, string> {
  const env: Record<string, string> = {
    RPC_URL:        `http://127.0.0.1:${config.anvilPort}`,
    PRIVATE_KEY:    session.signer.privateKey,
    PLAYER_ADDRESS: session.signer.address,
  };

  // ADDR_<ID> for each deployed contract (uppercase, hyphens → underscores)
  for (const id of contractRegistry.list()) {
    const key = `ADDR_${id.toUpperCase().replace(/-/g, "_")}`;
    env[key] = contractRegistry.getAddress(id);
  }

  // TOKEN_<SYMBOL> for each token encountered in pools (deduplicated by address)
  const seenTokens = new Set<string>();
  for (const pool of pools.getAllPools()) {
    if (!seenTokens.has(pool.token0)) {
      env[`TOKEN_${pool.symbol0.toUpperCase()}`] = pool.token0;
      seenTokens.add(pool.token0);
    }
    if (!seenTokens.has(pool.token1)) {
      env[`TOKEN_${pool.symbol1.toUpperCase()}`] = pool.token1;
      seenTokens.add(pool.token1);
    }
  }

  // POOL_<ID> for each pool — address + exchange metadata
  for (const pool of pools.getAllPools()) {
    const prefix = `POOL_${pool.id.toUpperCase().replace(/-/g, "_")}`;
    env[prefix]              = pool.address;
    env[`${prefix}_EXCHANGE`] = pool.exchange;
    env[`${prefix}_DISPLAY`]  = pool.displayName;
    env[`${prefix}_TOKEN_A`]  = pool.symbol0;
    env[`${prefix}_TOKEN_B`]  = pool.symbol1;
  }

  return env;
}

/**
 * Run `solve/env.sh` (curl to this engine) then merge `.env` into the forge env.
 * Session keys (`PRIVATE_KEY`, etc.) win on collision — same as `source .env` after
 * a manual refresh, but the WS player wallet always overrides stale file keys.
 */
async function mergeForgeEnvWithEnvSh(
  engineHttpUrl: string,
  session: PlayerSession,
  client: ChainClient,
  pools: PoolRegistry,
  contractRegistry: ContractRegistry,
  onLog?: (m: ForgeLogMessage) => void,
): Promise<Record<string, string>> {
  const builtIn = buildForgeEnv(session, client, pools, contractRegistry);
  const sh = await materializeSolveEnvFromEnvSh(engineHttpUrl);
  if (!sh.ok) {
    onLog?.({
      stream: "info",
      message: `[env.sh] ${sh.error} — using built-in forge env only (install curl+jq, or run ./env.sh manually)`,
    });
    return builtIn;
  }
  onLog?.({ stream: "info", message: "[env.sh] refreshed solve/.env; merging into forge environment" });
  return { ...sh.vars, ...builtIn };
}

/**
 * WebSocket server — real-time bridge between the engine and browser clients.
 *
 * ## Connection lifecycle
 *   - Each connection gets an isolated PlayerSession with its own signer wallet,
 *     trigger set, and log buffer (up to 200 entries).
 *   - On connect, the server immediately pushes the current challenge state
 *     (`challenge`) and the full challenge catalogue (`challenges`).
 *
 * ## Message protocol
 * All messages (both directions) use the envelope:
 *   `{ "type": "<message_type>", "payload": { ... } }`
 *
 * ### Client → Server (handled in _handleMessage)
 *   ping             — heartbeat; server replies with pong
 *   challenge_start  — start a challenge by ID
 *   challenge_stop   — stop the running challenge
 *   control          — pause / resume / fast_forward / set_speed
 *   script_run       — execute a JS strategy script in the player sandbox
 *   script_stop      — clear all triggers registered by this session
 *   trigger_remove   — remove a single trigger by ID
 *   get_challenges   — re-request the full challenge catalogue
 *   subscribe_pair   — reserved (no-op; all price/candle messages broadcast to all)
 *   get_blocks       — { from?: number; limit?: number } → blocks_result with full tx data
 *   forge_script_run — run a forge script from the solve/ workspace
 *   forge_deploy     — compile and deploy a Solidity contract from solve/src/
 *   nft_buy          — buy one or many listed NFTs (tokenId or tokenIds[])
 *   nft_list         — list an owned NFT token for sale
 *
 * ### Server → Client
 *   Broadcasts (all clients):  challenge, price, candle, block, win, trigger_fired,
 *                               nft_update, trade
 *   Unicasts (sender only):    pong, script_log, triggers, error,
 *                               forge_log, forge_done, nft_buy_ok, nft_list_ok, challenges
 *   Mixed:                     speed — unicast after control + on connect; broadcast after challenge_start
 *
 * See docs/websocket-api.md for the full payload schemas.
 */
export class WSServer {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();
  private sessions = new Map<WebSocket, PlayerSession>();
  /** Serialize inbound WS handling per socket so async handlers (e.g. nft_buy) do not overlap. */
  private _wsInboundChains = new WeakMap<WebSocket, Promise<void>>();
  /**
   * Tracks how many times each WS socket has called beginPlayerScriptHold() without a
   * matching endPlayerScriptHold(). Used to release stale holds when a client disconnects.
   */
  private _wsHoldDepths = new Map<WebSocket, number>();

  constructor(
    server:                   Server,
    private runner:           ChallengeRunner,
    private mining:           MiningController,
    private loader:           ChallengeLoader,
    private sandbox:          ScriptSandbox,
    private registry:         TriggerRegistry,
    private client:           ChainClient,
    private pools:            PoolRegistry,
    private contractRegistry: ContractRegistry,
  ) {
    this.wss = new WebSocketServer({ server, path: "/ws" });
    this.wss.on("connection", (ws) => this._onConnect(ws));
  }

  /**
   * Resolve WETH contract address for wrap/unwrap/balance — not every challenge
   * has AMM pools (e.g. Floor Sweep); fall back to runner tokens or marketplace.
   */
  private async _resolveWethAddress(): Promise<string | undefined> {
    for (const pool of this.pools.getAllPools()) {
      if (pool.symbol0.toUpperCase() === "WETH") return pool.token0;
      if (pool.symbol1.toUpperCase() === "WETH") return pool.token1;
    }
    const fromRunner = this.runner.tokenAddresses.get("WETH");
    if (fromRunner) return fromRunner;
    const WETH_ON_MKT_ABI = ["function weth() view returns (address)"];
    for (const id of this.contractRegistry.list()) {
      try {
        const addr = this.contractRegistry.getAddress(id);
        const c    = new ethers.Contract(addr, WETH_ON_MKT_ABI, this.client.provider);
        const w    = await c.weth();
        if (typeof w === "string" && w.startsWith("0x") && w !== ethers.ZeroAddress) return w;
      } catch { /* not an NFT marketplace */ }
    }
    return undefined;
  }

  /** Send a message to every currently-connected client. */
  broadcast(type: string, payload: unknown) {
    const msg = JSON.stringify({ type, payload });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  private _onConnect(ws: WebSocket) {
    this.clients.add(ws);

    // Create a player session for this connection
    const session: PlayerSession = {
      sessionId: `session_${Date.now()}`,
      signer: this.client.getPlayerSigner(),
      registry: this.registry,
      triggersRegistered: [],
      logs: [],
      log: function(level, message, blockNumber) {
        this.logs.push({ level, message, blockNumber });
        if (this.logs.length > 200) this.logs.shift();
      },
      clearTriggers: function() {
        for (const id of this.triggersRegistered) {
          this.registry.remove(id);
        }
        this.triggersRegistered = [];
      },
    };
    this.sessions.set(ws, session);

    // Send current challenge state on connect
    const state = this.runner.getState();
    ws.send(JSON.stringify({ type: "challenge", payload: state }));
    ws.send(JSON.stringify({ type: "challenges", payload: this.loader.list().map(buildChallengeCard) }));
    ws.send(JSON.stringify({ type: "speed", payload: { speed: this.mining.getSpeed() } }));

    ws.on("message", (data) => {
      const prev = this._wsInboundChains.get(ws) ?? Promise.resolve();
      const run = async () => {
        let msg: { type: string; payload: unknown };
        try {
          msg = JSON.parse(data.toString()) as { type: string; payload: unknown };
        } catch (e) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "error", payload: { code: "PARSE_ERROR", message: String(e) } }));
          }
          return;
        }
        await this._handleMessage(ws, session, msg);
      };
      const next = prev.then(run).catch((err) => {
        console.error("[WSServer] inbound message chain:", err);
      });
      this._wsInboundChains.set(ws, next);
    });

    ws.on("close", () => {
      this.clients.delete(ws);
      // Clear the session's registered triggers BEFORE removing the session from the map.
      // If we delete the session first, the challenge_start trigger-clear loop cannot reach
      // these triggers, leaving orphaned callbacks from dead WS clients in the registry.
      const closingSession = this.sessions.get(ws);
      if (closingSession) closingSession.clearTriggers();
      this.sessions.delete(ws);
      // Release any forge / player-script holds this client acquired but never released.
      // Without this cleanup, a disconnected client's hold permanently blocks interval mining.
      const depth = this._wsHoldDepths.get(ws) ?? 0;
      this._wsHoldDepths.delete(ws);
      if (depth > 0) {
        console.warn(`[WSServer] client disconnected with ${depth} active forge hold(s) — releasing`);
        // endPlayerScriptHold is safe to call in a fire-and-forget manner here; it checks
        // internally that depth > 0 before decrementing, so extra calls are harmless.
        const release = async () => {
          for (let i = 0; i < depth; i++) {
            await this.mining.endPlayerScriptHold();
          }
        };
        release().catch((e) => console.error("[WSServer] hold release error:", e));
      }
    });

    ws.on("error", (e) => console.error("[WSServer] client error:", e.message));
  }

  private async _handleMessage(ws: WebSocket, session: PlayerSession, msg: { type: string; payload: unknown }) {
    const send = (type: string, payload: unknown) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, payload }));
    };

    try {
      switch (msg.type) {
        case "ping":
          send("pong", { timestamp: Date.now() });
          break;

        case "challenge_select": {
          // Clear triggers when the player selects a different challenge so stale
          // triggers from the previous challenge don't bleed into the new one.
          // Triggers are NOT cleared on challenge_start so players can pre-register
          // them before clicking Start.
          for (const s of this.sessions.values()) {
            s.clearTriggers();
          }
          this.broadcast("triggers", { triggers: [] });
          break;
        }

        case "challenge_start": {
          const { challengeId } = msg.payload as { challengeId: string };
          const manifest = this.loader.get(challengeId);
          if (!manifest) { send("error", { code: "NOT_FOUND", message: `Unknown challenge: ${challengeId}` }); return; }
          await this.runner.start(manifest);
          // Slider + mining speed stay aligned (multiplier survives configure() between challenges).
          this.broadcast("speed", { speed: this.mining.getSpeed() });

          // Regenerate solve/.env with fresh contract addresses so players don't
          // need to manually run ./env.sh before their first forge script.
          const engineUrl = `http://127.0.0.1:${config.httpPort}`;
          materializeSolveEnvFromEnvSh(engineUrl).then((result) => {
            if (result.ok) {
              console.log("[WSServer] solve/.env refreshed after challenge start");
              // Notify the initiating client so its IDE env tab can refresh
              send("env_updated", {});
            } else {
              console.warn("[WSServer] solve/.env refresh after challenge start failed:", result.error);
            }
          }).catch(() => {});

          // Re-broadcast the current trigger list so the TriggerPanel repopulates
          // after the challenge-start "running" event clears its display for a new challenge.
          send("triggers", { triggers: this.registry.list() });
          break;
        }

        case "challenge_stop":
          await this.runner.stop();
          // Do NOT clear triggers on stop — players can restart the same challenge
          // without re-running their script. Triggers are only cleared on challenge_select
          // (switching to a different challenge).
          send("challenge", this.runner.getState());
          break;

        case "control": {
          const { action, blocks, speed } = msg.payload as { action: string; blocks?: number; speed?: number };
          switch (action) {
            case "pause":        this.runner.pause();  break;
            case "resume":       this.runner.resume(); break;
            case "fast_forward": {
              // Cap fast-forward at 500 blocks per call to prevent a single
              // client from issuing a request that loops for hours and DoS-ing
              // the engine's single-threaded event loop.
              const safeBlocks = Math.min(Math.max(1, Math.floor(blocks ?? 10)), 500);
              await this.runner.fastForward(safeBlocks);
              break;
            }
            case "set_speed":
              if (speed !== undefined) this.mining.setSpeed(speed);
              break;
          }
          // Echo back current speed so UI stays in sync
          send("speed", { speed: this.mining.getSpeed() });
          break;
        }

        case "script_run": {
          const { source } = msg.payload as { source: string };
          // Reject unreasonably large scripts before handing them to the VM.
          // 256 KB is generous for any legitimate strategy script; beyond this
          // the submission is more likely a DoS attempt or an exfiltration payload.
          const MAX_SCRIPT_BYTES = 256 * 1024;
          if (!source || Buffer.byteLength(source, "utf-8") > MAX_SCRIPT_BYTES) {
            send("error", { code: "SCRIPT_TOO_LARGE", message: "Script exceeds 256 KB size limit" });
            break;
          }

          // Build a per-session runForgeScript function that closes over the
          // session's credentials and streams output to the script log.
          const sessionForgeRunner: RunForgeScriptFn = async (scriptPath, opts = {}) => {
            await this.mining.beginPlayerScriptHold();
            this._wsHoldDepths.set(ws, (this._wsHoldDepths.get(ws) ?? 0) + 1);
            try {
              // Validate and resolve the script path against SOLVE_DIR.
              const resolvedAbs = safeJoin(SOLVE_DIR, scriptPath);
              if (!resolvedAbs) {
                throw new Error(`runForgeScript: invalid or unsafe script path: ${scriptPath}`);
              }
              const resolvedRelative = resolvedAbs.slice(SOLVE_DIR.length + 1);

              // Collect all output lines into a buffer (also forward as script_log entries).
              const outputLines: string[] = [];
              const logLine = (forgeMsg: ForgeLogMessage) => {
                outputLines.push(forgeMsg.message);
                send("script_log", {
                  sessionId:   session.sessionId,
                  level:       forgeMsg.stream === "stderr" || forgeMsg.stream === "error" ? "warn" : "log",
                  message:     `[forge] ${forgeMsg.message}`,
                  blockNumber: 0,
                });
              };

              const engineUrl = `http://127.0.0.1:${config.httpPort}`;
              const env = await mergeForgeEnvWithEnvSh(
                engineUrl, session, this.client, this.pools, this.contractRegistry, logLine,
              );
              const extraArgs = opts.args ?? [];

              const result = await runForgeScript(resolvedRelative, env, logLine, extraArgs);

              return {
                success:  result.success,
                exitCode: result.exitCode,
                output:   outputLines.join("\n"),
              };
            } finally {
              // Decrement per-socket hold counter before releasing the global hold.
              const held = this._wsHoldDepths.get(ws) ?? 0;
              if (held > 0) this._wsHoldDepths.set(ws, held - 1);
              await this.mining.endPlayerScriptHold();
              // Force an immediate win-condition check so challenges solved entirely
              // via forge (e.g. broken-token, spot-the-oracle) are detected without
              // waiting for the next mined block.
              await this.runner.checkWinConditionAfterForge();
            }
          };

          this.sandbox.setTokenAddresses(this.runner.tokenAddresses);
          this.sandbox.execute(source, session, sessionForgeRunner);
          send("script_log", { level: "log", message: `Script loaded. ${session.triggersRegistered.length} trigger(s) registered.`, blockNumber: 0 });
          send("triggers", { triggers: this.registry.list() });
          break;
        }

        case "script_stop":
          session.clearTriggers();
          send("triggers", { triggers: this.registry.list() });
          break;

        case "trigger_remove": {
          const { triggerId } = msg.payload as { triggerId: string };
          this.registry.remove(triggerId);
          send("triggers", { triggers: this.registry.list() });
          break;
        }

        case "subscribe_pair":
          // Just a hint — we broadcast all pairs. No per-client filtering in PoC.
          break;

        case "get_challenges":
          send("challenges", { challenges: this.loader.list().map(buildChallengeCard) });
          break;

        case "get_history": {
          const { pair, lastN } = msg.payload as { pair: string; lastN?: number };
          // Import MarketHistory dynamically to avoid circular dep
          send("history", { pair, candles: [] }); // full history sent via HTTP
          break;
        }

        case "get_blocks": {
          // Returns up to `limit` blocks starting from block `from`.
          // If `from` is 0 or missing, returns the most recent `limit` blocks.
          const { from: fromBlock, limit: rawLimit } =
            msg.payload as { from?: number; limit?: number };
          const limit = Math.min(rawLimit ?? 50, 100);
          try {
            const latestBlock = await this.client.provider.getBlock("latest");
            if (!latestBlock) { send("blocks_result", { blocks: [] }); break; }
            const latest = latestBlock.number;

            // Determine the range of block numbers to fetch
            let blockNumbers: number[];
            if (!fromBlock || fromBlock <= 0) {
              // Fetch newest `limit` blocks
              const start = Math.max(0, latest - limit + 1);
              blockNumbers = [];
              for (let n = start; n <= latest; n++) blockNumbers.push(n);
            } else {
              // Fetch `limit` blocks starting at `fromBlock`
              const end = Math.min(fromBlock + limit - 1, latest);
              blockNumbers = [];
              for (let n = fromBlock; n <= end; n++) blockNumbers.push(n);
            }

            // Build selector map once for the whole batch to avoid rebuilding
            // it per-transaction.
            const selectorMap = buildCalldataSelectorMap(this.contractRegistry);

            const blocks = await Promise.all(
              blockNumbers.map(async (n) => {
                try {
                  const blk = await this.client.provider.getBlock(n, /* prefetchTxs */ true);
                  if (!blk) return null;
                  const txs = blk.prefetchedTransactions ?? [];
                  const transactions = await Promise.all(txs.map(async (tx) => {
                    let gasUsed = "0";
                    try {
                      const rcpt = await this.client.provider.getTransactionReceipt(tx.hash);
                      gasUsed = rcpt ? rcpt.gasUsed.toString() : "0";
                    } catch { /* best-effort */ }

                    // Decode calldata using the registry's deployed contract ABIs
                    // plus a built-in table of common ERC-20/DEX selectors.
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

                  return {
                    number:       blk.number,
                    timestamp:    blk.timestamp,
                    hash:         blk.hash ?? "",
                    transactions,
                  };
                } catch {
                  return null;
                }
              }),
            );

            send("blocks_result", { blocks: blocks.filter(Boolean) });
          } catch (e) {
            send("error", { code: "GET_BLOCKS_ERROR", message: String(e) });
          }
          break;
        }

        case "forge_script_run": {
          const { scriptPath, challengeId: forgeChallId } = msg.payload as { scriptPath: string; challengeId?: string };
          // First line of defence: regex on challengeId.
          if (forgeChallId && !/^[a-zA-Z0-9_-]+$/.test(forgeChallId)) {
            send("forge_log", { stream: "error", message: "Invalid challengeId" });
            send("forge_done", { success: false, exitCode: -1 });
            break;
          }
          // Second line of defence: canonicalize the full path via safeJoin and
          // assert it stays within SOLVE_DIR. This covers scriptPath traversal too.
          const resolvedScriptAbs = forgeChallId
            ? safeJoin(join(SOLVE_DIR, "challenges", forgeChallId), scriptPath)
            : safeJoin(SOLVE_DIR, scriptPath);
          if (!resolvedScriptAbs) {
            send("forge_log", { stream: "error", message: "Invalid script path" });
            send("forge_done", { success: false, exitCode: -1 });
            break;
          }
          // forge is invoked from SOLVE_DIR, so pass the path relative to it.
          const resolvedScriptPath = resolvedScriptAbs.slice(SOLVE_DIR.length + 1);
          const engineUrl = `http://127.0.0.1:${config.httpPort}`;
          await this.mining.beginPlayerScriptHold();
          try {
            const env = await mergeForgeEnvWithEnvSh(
              engineUrl, session, this.client, this.pools, this.contractRegistry,
              (m) => send("forge_log", m),
            );
            send("forge_log", { stream: "info", message: `Running forge script: ${resolvedScriptPath}` });
            const result = await runForgeScript(
              resolvedScriptPath,
              env,
              (msg: ForgeLogMessage) => send("forge_log", msg),
            );
            send("forge_done", result);
          } catch (err) {
            send("forge_log", { stream: "error", message: String(err) });
            send("forge_done", { success: false, exitCode: -1 });
          } finally {
            await this.mining.endPlayerScriptHold();
            // Force an immediate win-condition check so challenges solved entirely
            // via forge (e.g. broken-token, spot-the-oracle) are detected without
            // waiting for the next mined block.
            await this.runner.checkWinConditionAfterForge();
          }
          break;
        }

        case "forge_deploy": {
          const { contractPath, contractName, challengeId: deployChallId } = msg.payload as { contractPath: string; contractName: string; challengeId?: string };
          // First line of defence: regex on challengeId.
          if (deployChallId && !/^[a-zA-Z0-9_-]+$/.test(deployChallId)) {
            send("forge_log", { stream: "error", message: "Invalid challengeId" });
            send("forge_done", { success: false, exitCode: -1 });
            break;
          }
          // Guard: contractName is embedded in a spawn args array as
          // `${path}:${contractName}`. Although spawn()'s array form is not
          // processed by a shell, a malformed contractName containing characters
          // like `/`, `..`, or shell metacharacters can cause forge to misbehave
          // (e.g. option injection if it starts with "--"). Restrict to valid
          // Solidity identifiers: alphanumeric + underscore, must start with a
          // letter or underscore, max 256 chars.
          if (!contractName || !/^[a-zA-Z_][a-zA-Z0-9_]{0,255}$/.test(contractName)) {
            send("forge_log", { stream: "error", message: "Invalid contract name: must be a valid Solidity identifier" });
            send("forge_done", { success: false, exitCode: -1 });
            break;
          }
          // Second line of defence: canonicalize the full path via safeJoin and
          // assert it stays within SOLVE_DIR. This covers contractPath traversal too.
          const resolvedContractAbs = deployChallId
            ? safeJoin(join(SOLVE_DIR, "challenges", deployChallId), contractPath)
            : safeJoin(SOLVE_DIR, contractPath);
          if (!resolvedContractAbs) {
            send("forge_log", { stream: "error", message: "Invalid contract path" });
            send("forge_done", { success: false, exitCode: -1 });
            break;
          }
          // forge is invoked from SOLVE_DIR, so pass the path relative to it.
          const resolvedContractPath = resolvedContractAbs.slice(SOLVE_DIR.length + 1);
          const engineUrl = `http://127.0.0.1:${config.httpPort}`;
          await this.mining.beginPlayerScriptHold();
          try {
            const env = await mergeForgeEnvWithEnvSh(
              engineUrl, session, this.client, this.pools, this.contractRegistry,
              (m) => send("forge_log", m),
            );
            send("forge_log", { stream: "info", message: `Deploying ${resolvedContractPath}:${contractName}` });
            const result = await deployContract(
              resolvedContractPath,
              contractName,
              env,
              (msg: ForgeLogMessage) => send("forge_log", msg),
            );
            send("forge_done", result);
          } catch (err) {
            send("forge_log", { stream: "error", message: String(err) });
            send("forge_done", { success: false, exitCode: -1 });
          } finally {
            await this.mining.endPlayerScriptHold();
          }
          break;
        }

        case "manual_trade": {
          const { pool: poolId, tokenIn: tokenInSymbol, amountIn: amountInHuman } =
            msg.payload as { pool: string; tokenIn: string; amountIn: string };
          await this.mining.beginPlayerScriptHold();
          try {
            const { ethers } = await import("ethers");

            const { info } = this.pools.getPool(poolId);

            // Resolve tokenIn symbol → address (also accept a raw address)
            let tokenInAddr: string;
            const symUpper = tokenInSymbol.toUpperCase();
            if (ethers.isAddress(tokenInSymbol)) {
              tokenInAddr = tokenInSymbol;
            } else if (symUpper === info.symbol0.toUpperCase()) {
              tokenInAddr = info.token0;
            } else if (symUpper === info.symbol1.toUpperCase()) {
              tokenInAddr = info.token1;
            } else {
              send("manual_trade_result", { error: `Unknown token "${tokenInSymbol}" for pool ${poolId}` });
              break;
            }

            const isToken0In = tokenInAddr.toLowerCase() === info.token0.toLowerCase();
            const decimalsIn = isToken0In ? info.decimals0 : info.decimals1;

            // Parse human-readable amount to wei
            let amountIn: bigint;
            try {
              amountIn = ethers.parseUnits(amountInHuman, decimalsIn);
            } catch {
              send("manual_trade_result", { error: `Invalid amount: "${amountInHuman}"` });
              break;
            }

            if (amountIn <= 0n) {
              send("manual_trade_result", { error: "Amount must be greater than zero." });
              break;
            }

            // Check player balance
            const playerAddr = session.signer.address;
            const tokenContract = this.pools.getToken(tokenInAddr);
            const balance: bigint = BigInt(await tokenContract.balanceOf(playerAddr));
            if (balance < amountIn) {
              const have = ethers.formatUnits(balance, decimalsIn);
              const need = ethers.formatUnits(amountIn, decimalsIn);
              send("manual_trade_result", {
                error: `Insufficient balance: have ${have}, need ${need}`,
              });
              break;
            }

            // Estimate output via staticCall (best-effort)
            const signerNM = new ethers.NonceManager(session.signer);
            const poolContract = this.pools.getPoolWithSigner(poolId, signerNM);
            let estimatedOut = 0n;
            try {
              estimatedOut = BigInt(
                await poolContract.swapExactIn.staticCall(tokenInAddr, amountIn, 0n, playerAddr),
              );
            } catch { /* best-effort */ }

            // Execute the swap (same path as ScriptSandbox.swap)
            await this.pools.getTokenWithSigner(tokenInAddr, signerNM).approve(info.address, amountIn);
            const tx = await poolContract.swapExactIn(
              tokenInAddr, amountIn, 0n, playerAddr,
            ) as import("ethers").ContractTransactionResponse;

            let blockNumber = tx.blockNumber ?? 0;
            if (!blockNumber) {
              try {
                const rcpt = await tx.wait(1);
                blockNumber = rcpt?.blockNumber ?? 0;
              } catch { /* best-effort */ }
            }

            // Broadcast trade event so ChartPanel markers appear automatically
            const direction: "buy" | "sell" = isToken0In ? "sell" : "buy";
            this.broadcast("trade", {
              blockNumber,
              pool:      poolId,
              direction,
              tokenIn:   tokenInAddr,
              amountIn:  amountIn.toString(),
              amountOut: estimatedOut.toString(),
              txHash:    tx.hash,
            });

            const decimalsOut  = isToken0In ? info.decimals1 : info.decimals0;
            const symbolOut    = isToken0In ? info.symbol1  : info.symbol0;

            send("manual_trade_result", {
              amountOut:         estimatedOut.toString(),
              amountOutDecimals: decimalsOut,
              amountOutSymbol:   symbolOut,
              txHash:            tx.hash,
            });
          } catch (e) {
            send("manual_trade_result", { error: String(e) });
          } finally {
            await this.mining.endPlayerScriptHold();
          }
          break;
        }

        case "get_balance": {
          const { symbol } = msg.payload as { symbol: string };
          try {
            const { ethers } = await import("ethers");
            const playerAddr = session.signer.address;
            let balance: bigint;
            let decimals = 18;
            if (symbol.toUpperCase() === "ETH") {
              balance = await (session.signer.provider as import("ethers").JsonRpcProvider)
                .getBalance(playerAddr);
            } else {
              let found = false;
              for (const pool of this.pools.getAllPools()) {
                if (symbol.toUpperCase() === pool.symbol0.toUpperCase()) {
                  balance = BigInt(await this.pools.getToken(pool.token0).balanceOf(playerAddr));
                  decimals = pool.decimals0;
                  found = true;
                  break;
                }
                if (symbol.toUpperCase() === pool.symbol1.toUpperCase()) {
                  balance = BigInt(await this.pools.getToken(pool.token1).balanceOf(playerAddr));
                  decimals = pool.decimals1;
                  found = true;
                  break;
                }
              }
              if (!found) {
                const symU = symbol.toUpperCase();
                const tokenAddr = this.runner.tokenAddresses.get(symU);
                if (tokenAddr) {
                  const def = this.runner.manifest?.tokens.find(t => t.symbol.toUpperCase() === symU);
                  decimals = def?.decimals ?? 18;
                  const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];
                  const tok = new ethers.Contract(tokenAddr, ERC20_ABI, this.client.provider);
                  balance = BigInt(await tok.balanceOf(playerAddr));
                  found = true;
                }
              }
              if (!found) {
                send("balance_result", { symbol, error: `Unknown token: ${symbol}` });
                break;
              }
            }
            send("balance_result", {
              symbol,
              balance: ethers.formatUnits(balance!, decimals),
            });
          } catch (e) {
            send("balance_result", { symbol, error: String(e) });
          }
          break;
        }

        case "wrap_eth": {
          // Issue #46: wrap native ETH → WETH via deposit()
          const { amount: wrapAmount } = msg.payload as { amount: string };
          await this.mining.beginPlayerScriptHold();
          try {
            const { ethers } = await import("ethers");

            const wethAddr = await this._resolveWethAddress();
            if (!wethAddr) {
              send("wrap_result", { error: "WETH contract not found (no pools, tokens, or marketplace)" });
              break;
            }

            const amountWei = ethers.parseEther(wrapAmount);
            if (amountWei <= 0n) {
              send("wrap_result", { error: "Amount must be greater than zero" });
              break;
            }

            const playerAddr = session.signer.address;
            const ethBalance = await this.client.getBalance(playerAddr);
            if (ethBalance < amountWei) {
              send("wrap_result", {
                error: `Insufficient ETH: have ${ethers.formatEther(ethBalance)}, need ${wrapAmount}`,
              });
              break;
            }

            const WETH_ABI = ["function deposit() payable", "function balanceOf(address) view returns (uint256)"];
            const signerNM = new ethers.NonceManager(session.signer);
            const weth = new ethers.Contract(wethAddr, WETH_ABI, signerNM);
            const tx = await weth.deposit({ value: amountWei }) as import("ethers").ContractTransactionResponse;
            await tx.wait(1);

            const newWethBalance = await weth.balanceOf(playerAddr);
            send("wrap_result", {
              wethBalance: ethers.formatEther(newWethBalance),
              txHash: tx.hash,
            });
          } catch (e) {
            send("wrap_result", { error: String(e) });
          } finally {
            await this.mining.endPlayerScriptHold();
          }
          break;
        }

        case "unwrap_eth": {
          // Issue #46: unwrap WETH → native ETH via withdraw()
          const { amount: unwrapAmount } = msg.payload as { amount: string };
          await this.mining.beginPlayerScriptHold();
          try {
            const { ethers } = await import("ethers");

            const wethAddr = await this._resolveWethAddress();
            if (!wethAddr) {
              send("unwrap_result", { error: "WETH contract not found (no pools, tokens, or marketplace)" });
              break;
            }

            const amountWei = ethers.parseEther(unwrapAmount);
            if (amountWei <= 0n) {
              send("unwrap_result", { error: "Amount must be greater than zero" });
              break;
            }

            const playerAddr = session.signer.address;
            const WETH_ABI = [
              "function withdraw(uint256 wad)",
              "function balanceOf(address) view returns (uint256)",
            ];
            const signerNM = new ethers.NonceManager(session.signer);
            const weth = new ethers.Contract(wethAddr, WETH_ABI, signerNM);

            const wethBalance: bigint = BigInt(await weth.balanceOf(playerAddr));
            if (wethBalance < amountWei) {
              send("unwrap_result", {
                error: `Insufficient WETH: have ${ethers.formatEther(wethBalance)}, need ${unwrapAmount}`,
              });
              break;
            }

            const tx = await weth.withdraw(amountWei) as import("ethers").ContractTransactionResponse;
            await tx.wait(1);

            const newEthBalance = await this.client.getBalance(playerAddr);
            send("unwrap_result", {
              ethBalance: ethers.formatEther(newEthBalance),
              txHash: tx.hash,
            });
          } catch (e) {
            send("unwrap_result", { error: String(e) });
          } finally {
            await this.mining.endPlayerScriptHold();
          }
          break;
        }

        case "nft_buy": {
          await this._handleNftBuy(send, session, msg.payload as { contractId: string; tokenId?: number; tokenIds?: number[] });
          break;
        }

        case "nft_list": {
          const { contractId, tokenId, price } = msg.payload as { contractId: string; tokenId: number; price: string };
          const { ethers } = await import("ethers");

          const MARKETPLACE_ABI = [
            "function listToken(uint256 tokenId, uint256 price)",
            "function getListings() view returns (uint256[] tokenIds, address[] sellers, uint256[] prices)",
            "function collection() view returns (address)",
          ];
          const COLLECTION_ABI = [
            "function approve(address to, uint256 tokenId)",
            "function revealed() view returns (bool)",
            "function rarityScore(uint256) view returns (uint8)",
          ];

          try {
            const mktAddr   = this.contractRegistry.getAddress(contractId);
            const signerNM  = new ethers.NonceManager(session.signer);
            const mktRO     = new ethers.Contract(mktAddr, MARKETPLACE_ABI, this.client.provider);
            const collAddr: string = await mktRO.collection();
            const collection = new ethers.Contract(collAddr, COLLECTION_ABI, signerNM);
            const marketplace = new ethers.Contract(mktAddr, MARKETPLACE_ABI, signerNM);

            const priceWei = ethers.parseEther(price);
            // Submit approve + listToken without waiting between — same block, one wait
            await collection.approve(mktAddr, tokenId);
            await (await marketplace.listToken(tokenId, priceWei)).wait(1);

            // Broadcast updated listings
            const collRO = new ethers.Contract(collAddr, [...COLLECTION_ABI, "function rarityScore(uint256) view returns (uint8)"], this.client.provider);
            const [tIds, sellers, prices]: [bigint[], string[], bigint[]] = await mktRO.getListings();
            const isRevealed: boolean = await collRO.revealed();
            const listings = await Promise.all(tIds.map(async (tid, i) => {
              let rarity = 0;
              if (isRevealed) { try { rarity = Number(await collRO.rarityScore(tid)); } catch {} }
              return { tokenId: tid.toString(), seller: sellers[i], price: ethers.formatEther(prices[i]), rarityScore: rarity };
            }));
            this.broadcast("nft_update", { contractId, listings });
            send("nft_list_ok", { tokenId, price });
          } catch (e) {
            send("error", { code: "NFT_ERROR", message: String(e) });
          }
          break;
        }
      }
    } catch (e) {
      send("error", { code: "HANDLER_ERROR", message: String(e) });
    }
  }

  /** Refresh marketplace listings for all clients (shared shape as nft_list / nft_buy success). */
  private async _broadcastNftListingsUpdate(contractId: string): Promise<void> {
    const { ethers } = await import("ethers");
    const MARKETPLACE_ABI = [
      "function getListings() view returns (uint256[] tokenIds, address[] sellers, uint256[] prices)",
      "function collection() view returns (address)",
    ];
    const COLLECTION_ABI = [
      "function revealed() view returns (bool)",
      "function rarityScore(uint256) view returns (uint8)",
    ];
    const mktAddr = this.contractRegistry.getAddress(contractId);
    const mktRO   = new ethers.Contract(mktAddr, MARKETPLACE_ABI, this.client.provider);
    const collAddr: string = await mktRO.collection();
    const collRO  = new ethers.Contract(collAddr, COLLECTION_ABI, this.client.provider);
    const [tIds, sellers, prices]: [bigint[], string[], bigint[]] = await mktRO.getListings();
    const isRevealed: boolean = await collRO.revealed();
    const listings = await Promise.all(tIds.map(async (tid, i) => {
      let rarity = 0;
      if (isRevealed) { try { rarity = Number(await collRO.rarityScore(tid)); } catch { /* ignore */ } }
      return { tokenId: tid.toString(), seller: sellers[i], price: ethers.formatEther(prices[i]), rarityScore: rarity };
    }));
    this.broadcast("nft_update", { contractId, listings });
  }

  /**
   * Buy one or many listed NFTs in a single logical request: one WETH wrap (if needed),
   * one approve for the sum of prices, then sequential buyToken calls.
   */
  private async _handleNftBuy(
    send: (type: string, payload: unknown) => void,
    session: PlayerSession,
    payload: { contractId: string; tokenId?: number; tokenIds?: number[] },
  ): Promise<void> {
    const MAX_NFT_BUY_BATCH = 50;
    const { ethers } = await import("ethers");
    const { contractId, tokenId, tokenIds } = payload;
    const rawIds = tokenIds?.length ? tokenIds : tokenId != null ? [tokenId] : [];
    const unique = [...new Set(
      rawIds.map((t) => Number(t)).filter((n) => Number.isInteger(n) && n >= 0),
    )];
    if (unique.length === 0) {
      send("error", { code: "NFT_ERROR", message: "No token id(s) to buy" });
      return;
    }
    if (unique.length > MAX_NFT_BUY_BATCH) {
      send("error", { code: "NFT_ERROR", message: `At most ${MAX_NFT_BUY_BATCH} NFTs per purchase` });
      return;
    }

    const MARKETPLACE_ABI = [
      "function listings(uint256) view returns (address seller, uint256 price, bool active)",
      "function buyToken(uint256 tokenId)",
      "function getListings() view returns (uint256[] tokenIds, address[] sellers, uint256[] prices)",
      "function weth() view returns (address)",
    ];
    const WETH_WRAP_ABI = [
      "function balanceOf(address) view returns (uint256)",
      "function deposit() payable",
      "function approve(address spender, uint256 amount) returns (bool)",
    ];

    try {
      const mktAddr      = this.contractRegistry.getAddress(contractId);
      const signerNM     = new ethers.NonceManager(session.signer);
      const marketplace  = new ethers.Contract(mktAddr, MARKETPLACE_ABI, signerNM);

      type Snap = { tokenId: number; seller: string; price: bigint };
      const snaps: Snap[] = [];
      for (const tid of unique) {
        const li = await marketplace.listings(tid);
        const sellerAddr = String(li.seller);
        const listingPrice = li.price as bigint;
        const active       = Boolean(li.active);
        if (!active) {
          send("error", { code: "NFT_ERROR", message: `Token ${tid} is not listed` });
          return;
        }
        snaps.push({ tokenId: tid, seller: sellerAddr, price: listingPrice });
      }

      const totalPrice = snaps.reduce((a, s) => a + s.price, 0n);
      const wethAddr: string = await marketplace.weth();
      const weth = new ethers.Contract(wethAddr, WETH_WRAP_ABI, signerNM);
      const buyerAddr = session.signer.address;
      const wethBal: bigint = BigInt(await weth.balanceOf(buyerAddr));

      // Submit deposit + approve + all buyToken calls without waiting between them.
      // NonceManager sequences nonces (deposit→approve→buy), so all land in one block
      // and execute in the correct order. Wait once at the end instead of per-tx.
      if (wethBal < totalPrice) {
        await weth.deposit({ value: totalPrice - wethBal });
      }
      await weth.approve(mktAddr, totalPrice);

      const buyTxs: ethers.TransactionResponse[] = [];
      for (const s of snaps) {
        buyTxs.push(await marketplace.buyToken(s.tokenId));
      }
      // Wait for the last tx — everything preceding it lands in the same block
      const receipts = await Promise.all(buyTxs.map(tx => tx.wait(1)));

      const bought: Array<{ tokenId: number; price: string; txHash: string; block?: number }> = [];
      for (let i = 0; i < snaps.length; i++) {
        const s       = snaps[i];
        const receipt = receipts[i];
        const priceEth = ethers.formatEther(s.price);
        recordSale(contractId, {
          tokenId:   String(s.tokenId),
          price:     priceEth,
          seller:    s.seller,
          buyer:     buyerAddr,
          txHash:    receipt?.hash ?? "",
          block:     receipt?.blockNumber != null ? Number(receipt.blockNumber) : undefined,
          timestamp: Date.now(),
        });
        bought.push({
          tokenId: s.tokenId,
          price:   priceEth,
          txHash:  receipt?.hash ?? "",
          block:   receipt?.blockNumber != null ? Number(receipt.blockNumber) : undefined,
        });
      }

      await this._broadcastNftListingsUpdate(contractId);
      const last = bought[bought.length - 1];
      send("nft_buy_ok", {
        tokenIds: bought.map((b) => b.tokenId),
        tokenId:  bought[0]?.tokenId,
        price:    last?.price,
        buyer:    buyerAddr,
        txHash:   last?.txHash,
        block:    last?.block,
        purchases: bought,
      });
    } catch (e) {
      try {
        await this._broadcastNftListingsUpdate(contractId);
      } catch { /* ignore */ }
      send("error", { code: "NFT_ERROR", message: String(e) });
    }
  }
}
