import { ethers } from "ethers";
import { BotBase, type BotConfig } from "../BotBase.js";
import type { SeededPRNG } from "../SeededPRNG.js";
import type { PoolRegistry } from "../../market/PoolRegistry.js";

/**
 * AccumulatorBot — small, consistent directional buys at a fixed block interval.
 * Deterministic cadence (no PRNG) creates a visible trend in volume/price analysis.
 * The cumulative drift is the signal; individual trades are individually small enough
 * to be dismissed as noise, but together they create a clear trend for players to spot.
 *
 * Params:
 *   poolId        — target pool id
 *   direction     — "buy" (spend token1 to get token0) | "sell" (spend token0 to get token1)
 *   swapSizeEth   — fixed swap size in ETH-equivalent units (default 0.5)
 *   blockInterval — fire every N blocks (default 5)
 *   maxSlippageBps — max price impact guard (default 100 = 1%)
 */
export class AccumulatorBot extends BotBase {
  private poolId: string;

  constructor(config: BotConfig, signer: ethers.Wallet, pools: PoolRegistry, prng: SeededPRNG) {
    super(config, signer, pools, prng);
    this.poolId = (config.params.poolId as unknown as string) ?? "weth-usdc-uniswap";
  }

  async tick(blockNumber: number): Promise<void> {
    const interval = (this.config.params.blockInterval as number) ?? 5;
    if (blockNumber % interval !== 0) return;

    const direction  = (this.config.params.direction as unknown as string) ?? "buy";
    const swapEth    = (this.config.params.swapSizeEth as number) ?? 0.5;
    const maxBps     = (this.config.params.maxSlippageBps as number) ?? 100;
    const { info }   = this.pools.getPool(this.poolId);
    const { reserve0, reserve1 } = await this.pools.getReserves(this.poolId);

    try {
      if (direction === "buy") {
        // Buy token0 (WETH) by spending token1 (USDC)
        const r0 = Number(reserve0) / 10 ** info.decimals0;
        const r1 = Number(reserve1) / 10 ** info.decimals1;
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
        // Sell token0 (WETH)
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
        console.error(`[AccumulatorBot:${this.id}] block ${blockNumber}:`, msg.slice(0, 80));
      }
    }
  }
}
