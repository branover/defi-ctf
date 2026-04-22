import { ethers } from "ethers";
import { BotBase, type BotConfig } from "../BotBase.js";
import type { SeededPRNG } from "../SeededPRNG.js";
import type { PoolRegistry } from "../../market/PoolRegistry.js";

/**
 * MarketMakerBot — a high-frequency TWAP stabilizer that continuously nudges
 * price back toward its rolling average with small, slippage-capped trades.
 *
 * Unlike MeanReversionBot (probabilistic, medium trades, fixed threshold),
 * the market maker:
 *  - Runs every block (tradeFrequency ≈ 1.0)
 *  - Uses a tight slippage cap (maxSlippageBps ≈ 100 = 1%)
 *  - Sizes trades proportionally to the deviation magnitude
 *  - Anchors purely to the rolling TWAP (no external target price)
 *
 * This creates a realistic "passive market maker" that competes with volatile
 * bots and provides price discovery, making it harder for the player to exploit
 * simple momentum strategies but creating predictable mean-reversion patterns.
 *
 * Params: poolId, twapWindow (default 20), mmThreshold (default 0.008 = 0.8%),
 *         swapSizeMinEth, swapSizeMaxEth, tradeFrequency (default 1.0),
 *         maxSlippageBps (default 100)
 */
export class MarketMakerBot extends BotBase {
  private poolId: string;
  private priceHistory: number[] = [];

  constructor(config: BotConfig, signer: ethers.Wallet, pools: PoolRegistry, prng: SeededPRNG) {
    super(config, signer, pools, prng);
    this.poolId = this._s("poolId", "weth-usdc-uniswap");
  }

  async tick(blockNumber: number): Promise<void> {
    if (!this.prng.chance(this._p("tradeFrequency", 1.0))) return;

    const currentPrice = await this.pools.getSpotPrice(this.poolId);
    this.priceHistory.push(currentPrice);
    const twapWindow = this._p("twapWindow", 20);
    if (this.priceHistory.length > twapWindow) this.priceHistory.shift();

    // Need enough history before acting
    if (this.priceHistory.length < Math.min(5, twapWindow)) return;

    const twap      = this.priceHistory.reduce((a, b) => a + b, 0) / this.priceHistory.length;
    const deviation = (currentPrice - twap) / twap;
    const threshold = this._p("mmThreshold", 0.008);

    if (Math.abs(deviation) < threshold) return;

    // Scale trade size: linear ramp from min at threshold to max at 5× threshold
    const scale    = Math.min(1.0, Math.abs(deviation) / (threshold * 5));
    const minEth   = this._p("swapSizeMinEth", 0.1);
    const maxEth   = this._p("swapSizeMaxEth", 0.5);
    const tradeEth = minEth + scale * (maxEth - minEth);
    const maxBps   = this._p("maxSlippageBps", 100);

    const { info } = this.pools.getPool(this.poolId);
    const { reserve0, reserve1 } = await this.pools.getReserves(this.poolId);

    // deviation > 0 → price above TWAP → sell token0 to push price down
    // deviation < 0 → price below TWAP → buy token0 (spend token1) to push price up
    const sellToken0 = deviation > 0;

    try {
      if (sellToken0) {
        const rawIn    = ethers.parseUnits(tradeEth.toFixed(6), info.decimals0);
        const amountIn = await this._slippageCap(this.poolId, info.token0, rawIn, maxBps);
        if (amountIn === 0n) return;

        const tok0 = this.pools.getTokenWithSigner(info.token0, this.signer);
        if (BigInt(await tok0.balanceOf(this.signerAddress)) < amountIn) return;
        await tok0.approve(info.address, amountIn);
        const pool = this.pools.getPoolWithSigner(this.poolId, this.signer);
        await pool.swapExactIn(info.token0, amountIn, 0n, this.signerAddress);
      } else {
        const r0    = Number(reserve0) / 10 ** info.decimals0;
        const r1    = Number(reserve1) / 10 ** info.decimals1;
        const price = r1 / r0;
        const rawIn    = BigInt(Math.floor(tradeEth * price * 10 ** info.decimals1));
        const amountIn = await this._slippageCap(this.poolId, info.token1, rawIn, maxBps);
        if (amountIn === 0n) return;

        const tok1 = this.pools.getTokenWithSigner(info.token1, this.signer);
        if (BigInt(await tok1.balanceOf(this.signerAddress)) < amountIn) return;
        await tok1.approve(info.address, amountIn);
        const pool = this.pools.getPoolWithSigner(this.poolId, this.signer);
        await pool.swapExactIn(info.token1, amountIn, 0n, this.signerAddress);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("insufficient")) {
        console.error(`[MarketMakerBot:${this.id}] block ${blockNumber}:`, msg.slice(0, 80));
      }
    }
  }
}
