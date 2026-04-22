import { spawn, execFile } from "child_process";
import { promisify } from "util";
import { createInterface } from "readline";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);

// Absolute path to the solve/ Foundry workspace (relative to this file: engine/src/player/)
const SOLVE_DIR = join(fileURLToPath(import.meta.url), "../../../../solve");

const TIMEOUT_MS = 120_000; // 2 minutes

/** Parse a minimal dotenv file (KEY=value, # comments) for forge child env. */
export function parseDotEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith("\"") && val.endsWith("\"")) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/**
 * Run `solve/env.sh` against the engine (same as the manual workflow), then read
 * `solve/.env`. Equivalent to `cd solve && ./env.sh && set -a && source .env`
 * for variables consumed by `forge script`.
 *
 * Uses async `execFile` so the engine HTTP handler can answer `curl` from env.sh
 * (a synchronous spawn would deadlock the event loop).
 */
export async function materializeSolveEnvFromEnvSh(engineHttpUrl: string):
Promise<{ ok: true; vars: Record<string, string> } | { ok: false; error: string }> {
  try {
    await execFileAsync("bash", [join(SOLVE_DIR, "env.sh")], {
      cwd:       SOLVE_DIR,
      env:       { ...process.env, ENGINE_URL: engineHttpUrl },
      maxBuffer: 8 * 1024 * 1024,
      encoding:  "utf-8",
    });
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message?: string };
    const detail = [err.stderr, err.stdout].filter(Boolean).join("\n").trim();
    return { ok: false, error: detail || err.message || String(e) };
  }
  const envPath = join(SOLVE_DIR, ".env");
  if (!existsSync(envPath)) {
    return { ok: false, error: `env.sh ran but ${envPath} is missing` };
  }
  return { ok: true, vars: parseDotEnvFile(readFileSync(envPath, "utf-8")) };
}

export interface ForgeLogMessage {
  stream: "stdout" | "stderr" | "info" | "error";
  message: string;
}

export interface ForgeResult {
  success: boolean;
  exitCode: number;
  /** Populated by deployContract() when "Deployed to: 0x..." is found in stdout. */
  contractAddress?: string;
}

/**
 * Run a forge script against the local anvil node and stream output line by line.
 *
 * @param scriptPath  Path relative to solve/ (e.g. "script/Solve.s.sol")
 * @param env         Environment variables assembled by buildForgeEnv()
 * @param broadcast   Callback invoked for every output line
 * @param extraArgs   Optional extra CLI arguments appended after the defaults
 *                    (e.g. `["--sig", "run(uint256)", "42"]`)
 */
export async function runForgeScript(
  scriptPath: string,
  env: Record<string, string>,
  broadcast: (msg: ForgeLogMessage) => void,
  extraArgs: string[] = [],
): Promise<ForgeResult> {
  // Auto-detect the entry-point contract when a script file contains multiple
  // contracts (e.g. a helper contract + the Script subclass).  Forge refuses to
  // run without --tc when there are multiple contracts in the file, so we read
  // the source and inject --tc <ContractName> automatically — unless the caller
  // already supplied one.
  if (!extraArgs.some((a) => a === "--tc")) {
    const absPath = join(SOLVE_DIR, scriptPath);
    if (existsSync(absPath)) {
      const src = readFileSync(absPath, "utf-8");
      // Match: contract Foo is Script  OR  contract Foo is Base, Script  OR  contract Foo is Script, Base
      const matches = [
        ...src.matchAll(/^contract\s+(\w+)\s+is\s+(?:\w+,\s*)*Script\b/gm),
      ];
      if (matches.length === 1) {
        extraArgs = ["--tc", matches[0][1], ...extraArgs];
      }
    }
  }

  const args = [
    "script",
    scriptPath,
    "--rpc-url",     env.RPC_URL ?? "",
    "--private-key", env.PRIVATE_KEY ?? "",
    "--broadcast",
    "--non-interactive",
    ...extraArgs,
  ];

  return _runForge(args, env, broadcast);
}

/**
 * Deploy a single contract via `forge create` and stream output.
 * Parses "Deployed to: 0x..." from stdout to populate ForgeResult.contractAddress.
 *
 * @param contractPath  Path relative to solve/ (e.g. "src/Attacker.sol")
 * @param contractName  Solidity contract name (e.g. "Attacker")
 * @param env           Environment variables assembled by buildForgeEnv()
 * @param broadcast     Callback invoked for every output line
 */
export async function deployContract(
  contractPath: string,
  contractName: string,
  env: Record<string, string>,
  broadcast: (msg: ForgeLogMessage) => void,
): Promise<ForgeResult> {
  const args = [
    "create",
    `${contractPath}:${contractName}`,
    "--rpc-url",     env.RPC_URL ?? "",
    "--private-key", env.PRIVATE_KEY ?? "",
  ];

  return _runForge(args, env, broadcast, (line) => {
    // "Deployed to: 0xABC..."
    const match = line.match(/Deployed to:\s*(0x[0-9a-fA-F]{40})/);
    return match ? match[1] : undefined;
  });
}

// ── Internal helper ────────────────────────────────────────────────────────────

async function _runForge(
  args: string[],
  env: Record<string, string>,
  broadcast: (msg: ForgeLogMessage) => void,
  /** Optional parser that extracts a contract address from a stdout line. */
  extractAddress?: (line: string) => string | undefined,
): Promise<ForgeResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;

    // Augment PATH to include the foundry bin directory so forge/cast are
    // always findable regardless of how the engine process was launched.
    const foundryBin = process.env.FOUNDRY_BIN ?? `${process.env.HOME ?? "/root"}/.foundry/bin`;
    const augmentedPath = `${foundryBin}:${process.env.PATH ?? ""}`;

    try {
      child = spawn("forge", args, {
        cwd: SOLVE_DIR,
        env: {
          ...process.env,
          ...env,
          // Ensure forge can find the correct home / PATH
          HOME: process.env.HOME ?? "/root",
          PATH: augmentedPath,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      broadcast({ stream: "error", message: `Failed to spawn forge: ${String(err)}` });
      resolve({ success: false, exitCode: -1 });
      return;
    }

    let contractAddress: string | undefined;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      broadcast({ stream: "error", message: `forge timed out after ${TIMEOUT_MS / 1000}s — killing process` });
      child.kill("SIGKILL");
    }, TIMEOUT_MS);

    const rlStdout = createInterface({ input: child.stdout!, crlfDelay: Infinity });
    rlStdout.on("line", (line) => {
      broadcast({ stream: "stdout", message: line });
      if (extractAddress) {
        const addr = extractAddress(line);
        if (addr) contractAddress = addr;
      }
    });

    const rlStderr = createInterface({ input: child.stderr!, crlfDelay: Infinity });
    rlStderr.on("line", (line) => {
      broadcast({ stream: "stderr", message: line });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      broadcast({ stream: "error", message: `forge process error: ${err.message}` });
      resolve({ success: false, exitCode: -1 });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const exitCode = code ?? -1;
      const success  = !timedOut && exitCode === 0;
      const result: ForgeResult = { success, exitCode };
      if (contractAddress) result.contractAddress = contractAddress;
      resolve(result);
    });
  });
}
