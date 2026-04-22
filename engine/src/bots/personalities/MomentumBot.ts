import { ethers } from "ethers";
import { BotBase, type BotConfig } from "../BotBase.js";
import type { SeededPRNG } from "../SeededPRNG.js";
import type { PoolRegistry } from "../../market/PoolRegistry.js";

/**
 * MomentumBot — trend follower that joins a sustained directional price move.
 * Compares the average of the first half vs second half of a rolling price window.
 * When drift exceeds `threshold`, buys into an uptrend or sells into a downtrend.
 * This creates the pump-and-dump dynamic for manipulation challenges.
 *
 * Params:
 *   poolId          — target pool id
 *   trendWindow     — rolling price history length (default 10)
 *   threshold       — fractional drift to trigger (default 0.02 = 2%)
 *   swapSizeMinEth  — minimum trade size (default 0.5)
 *   swapSizeMaxEth  — maximum trade size (default 3.0)
 *   tradeFrequency  — probability of firing when triggered (default 0.7)
 *   maxSlippageBps  — (default 200)
 */
export class MomentumBot extends BotBase {
  private poolId: string;
  private priceHistory: number[] = [];

  constructor(config: BotConfig, signer: ethers.Wallet, pools: PoolRegistry, prng: SeededPRNG) {
    super(config, signer, pools, prng);
    this.poolId = (config.params.poolId as unknown as string) ?? "weth-usdc-uniswap";
  }

  async tick(blockNumber: number): Promise<void> {
    const freq = (this.config.params.tradeFrequency as number) ?? 0.7;
    if (!this.prng.chance(freq)) return;

    const currentPrice = await this.pools.getSpotPrice(this.poolId);
    this.priceHistory.push(currentPrice);

    const window = (this.config.params.trendWindow as number) ?? 10;
    if (this.priceHistory.length > window) this.priceHistory.shift();
    if (this.priceHistory.length < window) return; // warmup

    // Compare first half vs second half average to detect sustained trend
    const half  = Math.floor(window / 2);
    const early = this.priceHistory.slice(0, half).reduce((a, b) => a + b, 0) / half;
    const late  = this.priceHistory.slice(half).reduce((a, b) => a + b, 0) / (window - half);
    const drift = (late - early) / early;

    const threshold = (this.config.params.threshold as number) ?? 0.02;
    if (Math.abs(drift) < threshold) return;

    // Follow the trend (momentum = same direction, not fade)
    const buyToken0 = drift > 0; // price rising → buy WETH (push further)
    const minEth    = (this.config.params.swapSizeMinEth as number) ?? 0.5;
    const maxEth    = (this.config.params.swapSizeMaxEth as number) ?? 3.0;
    const swapEth   = this.prng.range(minEth, maxEth);
    const maxBps    = (this.config.params.maxSlippageBps as number) ?? 200;

    const { info }   = this.pools.getPool(this.poolId);
    const { reserve0, reserve1 } = await this.pools.getReserves(this.poolId);

    try {
      if (buyToken0) {
        const r0    = Number(reserve0) / 10 ** info.decimals0;
        const r1    = Number(reserve1) / 10 ** info.decimals1;
        const price = r1 / r0;
        const rawIn = BigInt(Math.floor(swapEth * price * 10 ** info.decimals1));
        const amountIn = await this._slippageCap(this.poolId, info.token1, rawIn, maxBps);
        if (amountIn === 0n) return;
        const tok1 = this.pools.getTokenWithSigner(info.token1, this.signer);
        if (BigInt(await tok1.balanceOf(this.signerAddress)) < amountIn) return;
        await tok1.approve(info.address, amountIn);
        const pool = this.pools.getPoolWithSigner(this.poolId, this.signer);
        await pool.swapExactIn(info.token1, amountIn, 0n, this.signerAddress);
      } else {
        const rawIn = ethers.parseUnits(swapEth.toFixed(6), info.decimals0);
        const amountIn = await this._slippageCap(this.poolId, info.token0, rawIn, maxBps);
        if (amountIn === 0n) return;
        const tok0 = this.pools.getTokenWithSigner(info.token0, this.signer);
        if (BigInt(await tok0.balanceOf(this.signerAddress)) < amountIn) return;
        await tok0.approve(info.address, amountIn);
        const pool = this.pools.getPoolWithSigner(this.poolId, this.signer);
        await pool.swapExactIn(info.token0, amountIn, 0n, this.signerAddress);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("insufficient")) {
        console.error(`[MomentumBot:${this.id}] block ${blockNumber}:`, msg.slice(0, 80));
      }
    }
  }
}
