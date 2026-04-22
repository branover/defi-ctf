import { ethers } from "ethers";
import type { SeededPRNG } from "./SeededPRNG.js";
import type { PoolRegistry } from "../market/PoolRegistry.js";
import type { ContractRegistry } from "../challenge/ContractRegistry.js";
import type { MarketHistory } from "../market/MarketHistory.js";
import { maxTradeForImpact } from "../market/AmmMath.js";

export interface BotConfig {
  id:          string;
  personality: string;
  account:     number;
  params:      Record<string, number | string>;
}

export abstract class BotBase {
  /** NonceManager tracks nonces locally to avoid stale-nonce RPC races */
  protected signer: ethers.NonceManager;
  /** Synchronous address from the underlying wallet */
  protected signerAddress: string;

  constructor(
    protected config:             BotConfig,
    rawSigner:                    ethers.Wallet,
    protected pools:              PoolRegistry,
    protected prng:               SeededPRNG,
    protected contractRegistry?:  ContractRegistry,
    protected marketHistory?:     MarketHistory,
  ) {
    this.signerAddress = rawSigner.address;
    this.signer = new ethers.NonceManager(rawSigner);
  }

  abstract tick(blockNumber: number): Promise<void>;

  get id(): string { return this.config.id; }

  /** Read a numeric param with fallback; safe against string|number union. */
  protected _p(key: string, fallback = 0): number {
    return Number(this.config.params[key] ?? fallback);
  }

  /** Read a string param (e.g. poolId) with fallback. */
  protected _s(key: string, fallback = ""): string {
    return String(this.config.params[key] ?? fallback);
  }

  /**
   * Returns min(requested, maxAmountIn) where maxAmountIn is the largest
   * trade that won't exceed maxBps price impact on the given pool/token.
   *
   * If the cap is 0 (degenerate case), returns requested unchanged so the
   * bot doesn't silently stop trading due to bad params.
   */
  protected async _slippageCap(
    poolId:      string,
    tokenInAddr: string,
    requested:   bigint,
    maxBps:      number,
  ): Promise<bigint> {
    try {
      const { info } = this.pools.getPool(poolId);
      const { reserve0, reserve1 } = await this.pools.getReserves(poolId);
      const isT0 = tokenInAddr.toLowerCase() === info.token0.toLowerCase();
      const [reserveIn, decimalsIn] = isT0
        ? [reserve0, info.decimals0]
        : [reserve1, info.decimals1];
      const cap = maxTradeForImpact(maxBps / 10000, reserveIn, decimalsIn);
      if (cap === 0n) return requested; // safety: never completely disable trading
      return requested < cap ? requested : cap;
    } catch {
      return requested; // fall back to unrestricted on error
    }
  }
}
