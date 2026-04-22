import { spawn, type ChildProcess } from "child_process";
import { config } from "../config.js";

const ANVIL_BIN = process.env.ANVIL_BIN ?? "/home/kali/.foundry/bin/anvil";
const MNEMONIC = config.mnemonic;

export class AnvilManager {
  private proc: ChildProcess | null = null;

  async start(): Promise<void> {
    if (this.proc) return;

    const args = [
      "--no-mining",
      "--port",              String(config.anvilPort),
      "--mnemonic",          MNEMONIC,
      "--accounts",          "20",
      "--chain-id",          String(config.chainId),
      "--block-base-fee-per-gas", "0",
      "--gas-limit",         "30000000",
    ];

    this.proc = spawn(ANVIL_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });

    this.proc.on("error", (err) => {
      console.error("[Anvil] spawn error:", err.message);
    });

    this.proc.stderr?.on("data", (d: Buffer) => {
      const line = d.toString().trim();
      if (line) console.error("[Anvil stderr]", line);
    });

    await this._waitReady();
    console.log(`[Anvil] ready on port ${config.anvilPort}`);
  }

  private _waitReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const poll = async () => {
        attempts++;
        try {
          const res = await fetch(`http://127.0.0.1:${config.anvilPort}`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
          });
          if (res.ok) return resolve();
        } catch {}
        if (attempts >= 60) return reject(new Error("Anvil did not start in time"));
        setTimeout(poll, 200);
      };
      poll();
    });
  }

  async reset(): Promise<void> {
    await fetch(`http://127.0.0.1:${config.anvilPort}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "anvil_reset", params: [], id: 1 }),
    });
  }

  kill(): void {
    this.proc?.kill("SIGTERM");
    this.proc = null;
  }

  isRunning(): boolean {
    return this.proc !== null;
  }
}
