import { ethers } from "ethers";
import { BotBase, type BotConfig } from "../BotBase.js";
import type { SeededPRNG } from "../SeededPRNG.js";
import type { PoolRegistry } from "../../market/PoolRegistry.js";
import { ammAmountOut } from "../../market/AmmMath.js";

/**
 * ArbitrageBot — watches two pools for the same pair and arbitrages when the
 * spread is profitable AFTER accounting for slippage on both legs.
 * Params: poolIdA, poolIdB, minProfitBps, swapSizeMinEth, swapSizeMaxEth,
 *         tradeFrequency, maxSlippageBps (default 100 — tight slippage for arb)
 */
export class ArbitrageBot extends BotBase {
  private poolIdA: string;
  private poolIdB: string;

  constructor(config: BotConfig, signer: ethers.Wallet, pools: PoolRegistry, prng: SeededPRNG) {
    super(config, signer, pools, prng);
    this.poolIdA = this._s("poolIdA", "weth-usdc-uniswap");
    this.poolIdB = this._s("poolIdB", "weth-usdc-sushiswap");
  }

  async tick(blockNumber: number): Promise<void> {
    if (!this.prng.chance(this._p("tradeFrequency", 0.5))) return;

    const [priceA, priceB] = await Promise.all([
      this.pools.getSpotPrice(this.poolIdA),
      this.pools.getSpotPrice(this.poolIdB),
    ]);

    // Determine buy/sell direction
    const [buyPool, sellPool] = priceA < priceB
      ? [this.poolIdA, this.poolIdB]
      : [this.poolIdB, this.poolIdA];

    const { info } = this.pools.getPool(buyPool);
    const maxBps = this._p("maxSlippageBps", 100);
    const minEth = this._p("swapSizeMinEth", 0.1);
    const maxEth = this._p("swapSizeMaxEth", 1.0);
    const swapSize = this.prng.range(minEth, maxEth);

    // Fetch reserves for both pools
    const [{ reserve0: buyR0, reserve1: buyR1 }, { reserve0: sellR0, reserve1: sellR1 }] =
      await Promise.all([
        this.pools.getReserves(buyPool),
        this.pools.getReserves(sellPool),
      ]);

    // Compute cost in token1 (USDC) to buy swapSize WETH from buy pool
    const buyPrice = Number(buyR1) / 10 ** info.decimals1 / (Number(buyR0) / 10 ** info.decimals0);
    const rawCostIn1 = BigInt(Math.floor(swapSize * buyPrice * 10 ** info.decimals1));

    // Cap cost for slippage
    const costIn1 = await this._slippageCap(buyPool, info.token1, rawCostIn1, maxBps);
    if (costIn1 === 0n) return;

    // Pre-calculate profitability using off-chain AMM math
    // Leg 1: spend costIn1 USDC → receive wethEstimate WETH from buy pool
    const wethEstimate = ammAmountOut(costIn1, buyR1, buyR0);
    if (wethEstimate === 0n) return;

    // Leg 2: sell wethEstimate WETH → receive usdcBack USDC from sell pool
    const usdcBack = ammAmountOut(wethEstimate, sellR0, sellR1);
    if (usdcBack === 0n) return;

    // Check net profitability: usdcBack must beat costIn1 by minProfitBps
    const minProfitBps = this._p("minProfitBps", 20);
    const netGain = usdcBack > costIn1 ? usdcBack - costIn1 : 0n;
    const profitBps = costIn1 > 0n ? Number(netGain * 10000n / costIn1) : 0;
    if (profitBps < minProfitBps) return;

    try {
      // Leg 1: buy WETH from cheap pool
      const tok1 = this.pools.getTokenWithSigner(info.token1, this.signer);
      if (BigInt(await tok1.balanceOf(this.signerAddress)) < costIn1) return;
      await tok1.approve(info.address, costIn1);
      const buyContract = this.pools.getPoolWithSigner(buyPool, this.signer);

      // Use slippage guard: accept no less than estimate × (1 - maxBps/10000)
      const minWethOut = wethEstimate * BigInt(10000 - maxBps) / 10000n;
      const wethReceived: bigint = await buyContract.swapExactIn(
        info.token1, costIn1, minWethOut, this.signerAddress,
      );

      if (wethReceived === 0n) return;

      // Leg 2: sell received WETH in the expensive pool
      const { info: infoSell } = this.pools.getPool(sellPool);
      const tok0 = this.pools.getTokenWithSigner(info.token0, this.signer);
      const bal0 = BigInt(await tok0.balanceOf(this.signerAddress));
      const sellAmount = bal0 < wethReceived ? bal0 : wethReceived;
      if (sellAmount === 0n) return;
      const sellContract = this.pools.getPoolWithSigner(sellPool, this.signer);
      await tok0.approve(infoSell.address, sellAmount);
      await sellContract.swapExactIn(info.token0, sellAmount, 0n, this.signerAddress);
    } catch {}
  }
}
