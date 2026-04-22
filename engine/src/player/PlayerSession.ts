import type { ethers } from "ethers";
import type { TriggerRegistry } from "../triggers/TriggerRegistry.js";

export class PlayerSession {
  public triggersRegistered: string[] = [];
  public logs: Array<{ level: string; message: string; blockNumber: number }> = [];

  constructor(
    public readonly sessionId: string,
    public readonly signer: ethers.Wallet,
    public readonly registry: TriggerRegistry,
  ) {}

  log(level: "log" | "warn" | "error", message: string, blockNumber: number) {
    this.logs.push({ level, message, blockNumber });
    if (this.logs.length > 200) this.logs.shift();
  }

  clearTriggers() {
    for (const id of this.triggersRegistered) {
      this.registry.remove(id);
    }
    this.triggersRegistered = [];
  }
}
