import { ethers } from "ethers";
import { BotBase, type BotConfig } from "../BotBase.js";
import type { SeededPRNG } from "../SeededPRNG.js";
import type { PoolRegistry } from "../../market/PoolRegistry.js";

/**
 * PeriodicBot — fires a large trade exactly every `blockInterval` blocks.
 * Predictable, front-runnable by design — used for MEV / whale-watch challenges.
 * The bot does not use a slippage cap so its trades always move price significantly.
 *
 * Params:
 *   poolId        — target pool id
 *   direction     — "buy" | "sell" | "random" (PRNG per firing, default "random")
 *   swapSizeEth   — trade size in ETH units (default 30)
 *   blockInterval — fire every N blocks (default 30)
 *   startBlock    — optional: don't fire before this block (default 0)
 */
export class PeriodicBot extends BotBase {
  private poolId: string;

  constructor(config: BotConfig, signer: ethers.Wallet, pools: PoolRegistry, prng: SeededPRNG) {
    super(config, signer, pools, prng);
    this.poolId = (config.params.poolId as unknown as string) ?? "weth-usdc-uniswap";
  }

  async tick(blockNumber: number): Promise<void> {
    const interval   = (this.config.params.blockInterval as number) ?? 30;
    const startBlock = (this.config.params.startBlock   as number) ?? 0;
    if (blockNumber < startBlock) return;
    if ((blockNumber - startBlock) % interval !== 0) return;

    let direction = (this.config.params.direction as unknown as string) ?? "random";
    if (direction === "random") direction = this.prng.chance(0.5) ? "buy" : "sell";

    const swapEth = (this.config.params.swapSizeEth as number) ?? 30;
    const { info } = this.pools.getPool(this.poolId);
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
      } else {
        const amountIn = ethers.parseUnits(swapEth.toFixed(6), info.decimals0);
        const tok0 = this.pools.getTokenWithSigner(info.token0, this.signer);
        if (BigInt(await tok0.balanceOf(this.signerAddress)) < amountIn) return;
        await tok0.approve(info.address, amountIn);
        const pool = this.pools.getPoolWithSigner(this.poolId, this.signer);
        await pool.swapExactIn(info.token0, amountIn, 0n, this.signerAddress);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("insufficient")) {
        console.error(`[PeriodicBot:${this.id}] block ${blockNumber}:`, msg.slice(0, 80));
      }
    }
  }
}
