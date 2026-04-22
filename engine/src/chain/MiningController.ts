import type { ChainClient } from "./ChainClient.js";

export type MiningState = "idle" | "running" | "paused" | "fast_forward";

export class MiningController {
  private state: MiningState = "idle";
  private _baseIntervalMs = 500;   // from manifest — never changed
  private _speedMult      = 1;     // runtime multiplier 1–10
  private baseTimestamp = 0;
  private _blockCount = 0;
  private _totalBlocks = 0;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _onBlock: ((blockNum: number) => Promise<void>) | null = null;

  /** Depth while ChallengeRunner._onBlock is executing (may await I/O). */
  private _gameBlockDepth = 0;
  private _outsideGameBlockWaiters: Array<() => void> = [];

  /**
   * Nesting depth for forge / player script paths that pause interval mining and
   * turn on Anvil automine so `forge --broadcast` txs can confirm without advancing
   * the simulated block counter.
   */
  private _playerScriptHoldDepth = 0;
  /** Whether the interval timer was running when the outermost hold began. */
  private _holdHadRunningTimer = false;

  constructor(private client: ChainClient) {}

  configure(opts: { blockIntervalMs: number; totalBlocks: number }) {
    this._baseIntervalMs = opts.blockIntervalMs;
    // Keep _speedMult — the UI slider is the player's preference; resetting to 1 here
    // made new challenges ignore the chosen multiplier until the slider moved again.
    this._totalBlocks = opts.totalBlocks;
    this._blockCount  = 0;
  }

  /** Set runtime speed multiplier (1–10). Takes effect on the next scheduled block. */
  setSpeed(mult: number) {
    this._speedMult = Math.max(1, Math.min(10, Math.round(mult)));
  }

  getSpeed(): number { return this._speedMult; }

  onBlock(handler: (blockNum: number) => Promise<void>) {
    this._onBlock = handler;
  }

  async start(baseTimestampSecs?: number) {
    // Reset any stale holds from disconnected WS clients before enabling interval mining.
    this._playerScriptHoldDepth = 0;
    this._holdHadRunningTimer = false;
    await this.client.rpc("evm_setAutomine", [false]);
    await this.client.rpc("evm_setIntervalMining", [0]);
    const wallNow = Math.floor(Date.now() / 1000);
    // Guard: baseTimestamp must be >= chain's current latest block timestamp.
    // After an evm_revert or when starting fresh, the chain may already have blocks
    // with timestamps ahead of wall-clock time. Using a stale timestamp causes
    // "Timestamp error: X is lower than previous block's timestamp" from Anvil.
    const latestBlock = await this.client.provider.getBlock("latest");
    const chainTs = latestBlock ? Number(latestBlock.timestamp) : 0;
    const requested = baseTimestampSecs ?? wallNow;
    this.baseTimestamp = Math.max(requested, chainTs + 1);
    this.state = "running";
    this._schedule();
  }

  pause() {
    if (this.state !== "running") return;
    this.state = "paused";
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  }

  resume() {
    if (this.state !== "paused") return;
    this.state = "running";
    this._schedule();
  }

  async fastForward(blocks: number): Promise<void> {
    const prev = this.state;
    this.state = "fast_forward";
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    for (let i = 0; i < blocks && !this._isDone(); i++) {
      await this._mineOne();
    }
    if (!this._isDone()) {
      this.state = prev === "paused" ? "paused" : "running";
      if (this.state === "running") this._schedule();
    }
  }

  async stop() {
    this.state = "idle";
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    // Reset the forge/player-script hold depth so stale holds from disconnected
    // WS clients do not block mining on the next challenge start.
    this._playerScriptHoldDepth = 0;
    this._holdHadRunningTimer = false;
    try { await this.client.rpc("evm_setAutomine", [true]); } catch {}
  }

  getState(): MiningState        { return this.state; }
  getBlockCount(): number        { return this._blockCount; }
  getTotalBlocks(): number       { return this._totalBlocks; }
  getBlocksRemaining(): number   { return Math.max(0, this._totalBlocks - this._blockCount); }

  /** True while a forge script / deploy hold is active (outermost depth > 0). */
  isPlayerScriptHoldActive(): boolean {
    return this._playerScriptHoldDepth > 0;
  }

  /** Called at the start of each simulated game block (after automine is enabled). */
  enterGameBlock(): void {
    this._gameBlockDepth++;
  }

  /** Called when a simulated game block finishes (in `finally`). */
  leaveGameBlock(): void {
    this._gameBlockDepth = Math.max(0, this._gameBlockDepth - 1);
    if (this._gameBlockDepth === 0) {
      const waiters = this._outsideGameBlockWaiters;
      this._outsideGameBlockWaiters = [];
      for (const w of waiters) w();
    }
  }

  private async _waitUntilOutsideGameBlock(): Promise<void> {
    if (this._gameBlockDepth === 0) return;
    await new Promise<void>((resolve) => {
      this._outsideGameBlockWaiters.push(resolve);
    });
  }

  /**
   * Pause interval mining and enable automine so external forge processes can
   * confirm transactions. Nested calls increment a depth counter; only the outermost
   * `endPlayerScriptHold` restores automine and the interval timer.
   *
   * When called from inside a game block tick (_gameBlockDepth > 0) — e.g. from a
   * player trigger that calls runForgeScript() — we skip _waitUntilOutsideGameBlock()
   * to avoid a deadlock: the trigger awaits a promise that can only resolve after
   * _onBlock() finishes, but _onBlock() won't finish until the trigger returns.
   * In this case automine is already ON (set by _onBlock itself) and the interval
   * timer is stopped, so the hold is a no-op structurally — we only track depth.
   */
  async beginPlayerScriptHold(): Promise<void> {
    // If already inside a game block tick, don't wait — automine is already on
    // and the interval timer is stopped. Just track depth to avoid deadlock.
    if (this._gameBlockDepth === 0) {
      await this._waitUntilOutsideGameBlock();
    }
    this._playerScriptHoldDepth++;
    if (this._playerScriptHoldDepth !== 1) return;
    this._holdHadRunningTimer = this.state === "running";
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    await this.client.rpc("evm_setAutomine", [true]).catch(() => {});
  }

  /**
   * Reverse {@link beginPlayerScriptHold}. Resyncs the next scheduled block timestamp
   * with Anvil after automined forge txs may have advanced wall/chain time.
   *
   * When still inside a game block (_gameBlockDepth > 0), automine is managed by
   * _onBlock itself — do not toggle it here, just decrement the depth counter.
   */
  async endPlayerScriptHold(): Promise<void> {
    if (this._playerScriptHoldDepth <= 0) return;
    this._playerScriptHoldDepth--;
    if (this._playerScriptHoldDepth > 0) return;

    // If still inside a game block, don't toggle automine — _onBlock manages it.
    if (this._gameBlockDepth > 0) {
      this._holdHadRunningTimer = false;
      return;
    }
    await this.client.rpc("evm_setAutomine", [false]).catch(() => {});
    await this._resyncBaseTimestampAfterHold();
    if (this.state === "running" && this._holdHadRunningTimer) {
      this._schedule();
    }
    this._holdHadRunningTimer = false;
  }

  private async _resyncBaseTimestampAfterHold(): Promise<void> {
    const latest = await this.client.provider.getBlock("latest");
    if (!latest) return;
    const latestTs = Number(latest.timestamp);
    const plannedNext = this.baseTimestamp + this._blockCount * 12;
    if (plannedNext <= latestTs) {
      this.baseTimestamp = latestTs + 1 - this._blockCount * 12;
    }
  }

  private get _intervalMs(): number {
    return Math.max(50, Math.round(this._baseIntervalMs / this._speedMult));
  }

  private _schedule() {
    if (this._isDone()) return;
    this._timer = setTimeout(() => this._tick(), this._intervalMs);
  }

  private async _tick() {
    if (this.state !== "running") return;
    await this._mineOne();
    if (!this._isDone()) this._schedule();
  }

  private async _mineOne() {
    const computed = this.baseTimestamp + this._blockCount * 12;
    // Guard: evm_setNextBlockTimestamp requires the new timestamp to be strictly
    // greater than the latest block's timestamp. When mining resumes after a paused
    // hold (e.g. a manual trade with automine on), Anvil may have mined automine
    // blocks whose timestamps overtook our simulated schedule. Clamp to ensure we
    // never go backwards. Also resync baseTimestamp so subsequent blocks stay ahead.
    const latestBlock = await this.client.provider.getBlock("latest");
    const latestTs = latestBlock ? Number(latestBlock.timestamp) : 0;
    const ts = Math.max(computed, latestTs + 1);
    if (ts > computed) {
      // Drift: resync baseTimestamp so the next block follows naturally.
      this.baseTimestamp = ts - this._blockCount * 12;
    }
    await this.client.rpc("evm_setNextBlockTimestamp", [ts]);
    await this.client.rpc("evm_mine", []);
    this._blockCount++;
    if (this._onBlock) {
      try { await this._onBlock(this._blockCount); } catch (e) {
        console.error("[MiningController] onBlock error:", e);
      }
    }
  }

  private _isDone(): boolean {
    if (this._totalBlocks > 0 && this._blockCount >= this._totalBlocks) {
      this.state = "idle";
      this.client.rpc("evm_setAutomine", [true]).catch(() => {});
      return true;
    }
    return false;
  }
}
