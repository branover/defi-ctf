import { ethers } from "ethers";
import { BotBase, type BotConfig } from "../BotBase.js";
import type { SeededPRNG } from "../SeededPRNG.js";
import type { PoolRegistry } from "../../market/PoolRegistry.js";

/**
 * SniperBot — fires a single large trade at exactly `triggerBlock` and never again.
 * Used for JIT-liquidity challenges and one-shot market events.
 * No slippage cap — intentional large price impact.
 *
 * Params:
 *   poolId       — target pool id
 *   direction    — "buy" | "sell" (default "buy")
 *   swapSizeEth  — trade size in ETH units (default 100)
 *   triggerBlock — block number to fire on (default 100)
 */
export class SniperBot extends BotBase {
  private poolId: string;
  private fired = false;

  constructor(config: BotConfig, signer: ethers.Wallet, pools: PoolRegistry, prng: SeededPRNG) {
    super(config, signer, pools, prng);
    this.poolId = (config.params.poolId as unknown as string) ?? "weth-usdc-uniswap";
  }

  async tick(blockNumber: number): Promise<void> {
    if (this.fired) return;
    const triggerBlock = (this.config.params.triggerBlock as number) ?? 100;
    if (blockNumber < triggerBlock) return;
    this.fired = true;

    const direction = (this.config.params.direction as unknown as string) ?? "buy";
    const swapEth   = (this.config.params.swapSizeEth as number) ?? 100;
    const { info }  = this.pools.getPool(this.poolId);
    const { reserve0, reserve1 } = await this.pools.getReserves(this.poolId);

    try {
      if (direction === "buy") {
        const r0    = Number(reserve0) / 10 ** info.decimals0;
        const r1    = Number(reserve1) / 10 ** info.decimals1;
        const price = r1 / r0;
        const amountIn = BigInt(Math.floor(swapEth * price * 10 ** info.decimals1));
        const tok1 = this.pools.getTokenWithSigner(info.token1, this.signer);
        if (BigInt(await tok1.balanceOf(this.signerAddress)) < amountIn) return;
        await tok1.approve(info.address, amountIn);
        const pool = this.pools.getPoolWithSigner(this.poolId, this.signer);
        await pool.swapExactIn(info.token1, amountIn, 0n, this.signerAddress);
        console.log(`[SniperBot:${this.id}] fired BUY ${swapEth} ETH at block ${blockNumber}`);
      } else {
        const amountIn = ethers.parseUnits(swapEth.toFixed(6), info.decimals0);
        const tok0 = this.pools.getTokenWithSigner(info.token0, this.signer);
        if (BigInt(await tok0.balanceOf(this.signerAddress)) < amountIn) return;
        await tok0.approve(info.address, amountIn);
        const pool = this.pools.getPoolWithSigner(this.poolId, this.signer);
        await pool.swapExactIn(info.token0, amountIn, 0n, this.signerAddress);
        console.log(`[SniperBot:${this.id}] fired SELL ${swapEth} ETH at block ${blockNumber}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[SniperBot:${this.id}] block ${blockNumber}:`, msg.slice(0, 80));
    }
  }
}
