import { ethers } from "ethers";
import { BotBase, type BotConfig } from "../BotBase.js";
import type { SeededPRNG } from "../SeededPRNG.js";
import type { PoolRegistry } from "../../market/PoolRegistry.js";

/**
 * VolatileBot — makes random large swaps to create price volatility.
 * Params: poolId, swapSizeMinEth, swapSizeMaxEth, tradeFrequency, maxSlippageBps (default 300)
 */
export class VolatileBot extends BotBase {
  private poolId: string;

  constructor(config: BotConfig, signer: ethers.Wallet, pools: PoolRegistry, prng: SeededPRNG) {
    super(config, signer, pools, prng);
    this.poolId = this._s("poolId", "weth-usdc-uniswap");
  }

  async tick(blockNumber: number): Promise<void> {
    if (!this.prng.chance(this._p("tradeFrequency", 0.3))) return;

    const { info } = this.pools.getPool(this.poolId);
    const { reserve0, reserve1 } = await this.pools.getReserves(this.poolId);

    const buyToken0   = this.prng.chance(0.5);
    const minEth      = this._p("swapSizeMinEth", 0.5);
    const maxEth      = this._p("swapSizeMaxEth", 3.0);
    const swapEthVal  = this.prng.range(minEth, maxEth);
    const maxBps      = this._p("maxSlippageBps", 300);

    try {
      if (buyToken0) {
        // Sell token1 → buy token0 (e.g. spend USDC to buy WETH)
        const r0 = Number(reserve0) / 10 ** info.decimals0;
        const r1 = Number(reserve1) / 10 ** info.decimals1;
        const price = r1 / r0;
        const rawAmountIn = BigInt(Math.floor(swapEthVal * price * 10 ** info.decimals1));
        const amountIn = await this._slippageCap(this.poolId, info.token1, rawAmountIn, maxBps);
        if (amountIn === 0n) return;

        const tok1 = this.pools.getTokenWithSigner(info.token1, this.signer);
        if (BigInt(await tok1.balanceOf(this.signerAddress)) < amountIn) return;
        await tok1.approve(info.address, amountIn);
        const pool = this.pools.getPoolWithSigner(this.poolId, this.signer);
        await pool.swapExactIn(info.token1, amountIn, 0n, this.signerAddress);
      } else {
        // Sell token0 → buy token1 (e.g. sell WETH to get USDC)
        const rawAmountIn = ethers.parseUnits(swapEthVal.toFixed(6), info.decimals0);
        const amountIn = await this._slippageCap(this.poolId, info.token0, rawAmountIn, maxBps);
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
        console.error(`[VolatileBot:${this.id}] block ${blockNumber}:`, msg.slice(0, 80));
      }
    }
  }
}
