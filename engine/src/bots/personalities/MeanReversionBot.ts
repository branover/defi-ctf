import { ethers } from "ethers";
import { BotBase, type BotConfig } from "../BotBase.js";
import type { SeededPRNG } from "../SeededPRNG.js";
import type { PoolRegistry } from "../../market/PoolRegistry.js";

/**
 * MeanReversionBot — trades toward a target/TWAP price.
 * Trade size scales proportionally to the deviation magnitude.
 * Params: poolId, targetPrice, swapSizeMinEth, swapSizeMaxEth, revertThreshold,
 *         tradeFrequency, twapWindow, maxSlippageBps (default 200)
 */
export class MeanReversionBot extends BotBase {
  private poolId: string;
  private priceHistory: number[] = [];

  constructor(config: BotConfig, signer: ethers.Wallet, pools: PoolRegistry, prng: SeededPRNG) {
    super(config, signer, pools, prng);
    this.poolId = this._s("poolId", "weth-usdc-uniswap");
  }

  async tick(blockNumber: number): Promise<void> {
    if (!this.prng.chance(this._p("tradeFrequency", 0.2))) return;

    const currentPrice = await this.pools.getSpotPrice(this.poolId);
    this.priceHistory.push(currentPrice);
    const window = this._p("twapWindow", 20);
    if (this.priceHistory.length > window) this.priceHistory.shift();
    const twap        = this.priceHistory.reduce((a, b) => a + b, 0) / this.priceHistory.length;
    const targetPrice = this._p("targetPrice", twap);
    const threshold   = this._p("revertThreshold", 0.05);

    const deviation = (currentPrice - targetPrice) / targetPrice;
    if (Math.abs(deviation) < threshold) return;

    // Scale trade size to deviation: reaches maxEth at 5× threshold
    const scale    = Math.min(1.0, Math.abs(deviation) / (threshold * 5));
    const minEth   = this._p("swapSizeMinEth", 0.2);
    const maxEth   = this._p("swapSizeMaxEth", 1.5);
    const tradeEth = minEth + scale * (maxEth - minEth);
    const maxBps   = this._p("maxSlippageBps", 200);

    const { info } = this.pools.getPool(this.poolId);
    const { reserve0, reserve1 } = await this.pools.getReserves(this.poolId);

    try {
      if (deviation > 0) {
        // Price too high → sell token0 to bring it down
        const rawIn = ethers.parseUnits(tradeEth.toFixed(6), info.decimals0);
        const amountIn = await this._slippageCap(this.poolId, info.token0, rawIn, maxBps);
        if (amountIn === 0n) return;
        const tok0 = this.pools.getTokenWithSigner(info.token0, this.signer);
        if (BigInt(await tok0.balanceOf(this.signerAddress)) < amountIn) return;
        await tok0.approve(info.address, amountIn);
        const pool = this.pools.getPoolWithSigner(this.poolId, this.signer);
        await pool.swapExactIn(info.token0, amountIn, 0n, this.signerAddress);
      } else {
        // Price too low → buy token0 with token1
        const r0 = Number(reserve0) / 10 ** info.decimals0;
        const r1 = Number(reserve1) / 10 ** info.decimals1;
        const price = r1 / r0;
        const rawIn = BigInt(Math.floor(tradeEth * price * 10 ** info.decimals1));
        const amountIn = await this._slippageCap(this.poolId, info.token1, rawIn, maxBps);
        if (amountIn === 0n) return;
        const tok1 = this.pools.getTokenWithSigner(info.token1, this.signer);
        if (BigInt(await tok1.balanceOf(this.signerAddress)) < amountIn) return;
        await tok1.approve(info.address, amountIn);
        const pool = this.pools.getPoolWithSigner(this.poolId, this.signer);
        await pool.swapExactIn(info.token1, amountIn, 0n, this.signerAddress);
      }
    } catch {}
  }
}
