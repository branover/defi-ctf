import { ethers } from "ethers";
import { BotBase, type BotConfig } from "../BotBase.js";
import type { SeededPRNG } from "../SeededPRNG.js";
import type { PoolRegistry } from "../../market/PoolRegistry.js";
import type { ContractRegistry } from "../../challenge/ContractRegistry.js";
import type { MarketHistory } from "../../market/MarketHistory.js";

/**
 * VolumeTrackerBot — follows unusual trading volume in the OHLCV candle data.
 * When it detects that the most-recently-closed candle's volume exceeds a rolling
 * average by `spikeMultiplier`, it buys `buyAmountEth` worth of tokenA (WETH) from
 * the pool.  After holding for `sellDelayBlocks` it sells the entire position back.
 *
 * The intended player path: generate wash-trade volume to trigger this bot, then
 * sell into its buying demand for profit.
 *
 * Params:
 *   poolId            — target pool id (e.g. "weth-meme-uniswap")
 *   baselineCandles   — how many closed candles to average for the baseline (default 5)
 *   spikeMultiplier   — ratio of current candle volume to baseline that triggers a buy
 *                       (default 3.0)
 *   buyAmountEth      — WETH equivalent to spend per buy-trigger (default "0.5")
 *   sellDelayBlocks   — blocks to wait after buying before selling (default 10)
 */
export class VolumeTrackerBot extends BotBase {
  private poolId: string;
  private baselineCandles: number;
  private spikeMultiplier: number;
  private buyAmountEth: number;
  private sellDelayBlocks: number;

  /** True when the bot is holding a tokenA position. */
  private holding = false;
  /** Block number at which the bot bought, used to time the sell. */
  private buyBlock = 0;
  /** Amount of tokenA (in smallest units) currently held as a position. */
  private tokenAHeld = 0n;

  constructor(
    config:           BotConfig,
    signer:           ethers.Wallet,
    pools:            PoolRegistry,
    prng:             SeededPRNG,
    contractRegistry?: ContractRegistry,
    marketHistory?:   MarketHistory,
  ) {
    super(config, signer, pools, prng, contractRegistry, marketHistory);
    this.poolId           = this._s("poolId", "weth-meme-uniswap");
    this.baselineCandles  = this._p("baselineCandles", 5);
    this.spikeMultiplier  = this._p("spikeMultiplier", 3.0);
    this.buyAmountEth     = this._p("buyAmountEth", 0.5);
    this.sellDelayBlocks  = this._p("sellDelayBlocks", 10);
  }

  async tick(blockNumber: number): Promise<void> {
    // ── Sell phase ──────────────────────────────────────────────────────────
    if (this.holding && blockNumber - this.buyBlock >= this.sellDelayBlocks) {
      await this._sellPosition(blockNumber);
      return;
    }

    // Don't try to buy again while already holding a position.
    if (this.holding) return;

    // ── Volume spike detection ───────────────────────────────────────────────
    if (!this.marketHistory) return;

    // We need at least baselineCandles + 1 closed candles.
    // getCandles returns all candles including the in-progress one last.
    // We look at closed candles only: slice off the last (current, possibly open) candle.
    const allCandles = this.marketHistory.getCandles(this.poolId);
    // Need at least (baselineCandles + 1) entries: baseline window + one current to compare.
    if (allCandles.length < this.baselineCandles + 1) return;

    // The most recently *closed* candle is allCandles[length - 2];
    // the baseline is the `baselineCandles` candles before that.
    const closedCandles = allCandles.slice(0, -1); // drop the currently-open candle
    const currentCandle = closedCandles[closedCandles.length - 1];
    const baselineSlice = closedCandles.slice(-this.baselineCandles - 1, -1); // last N before current

    if (baselineSlice.length < this.baselineCandles) return; // not enough history yet

    const avgVolume = baselineSlice.reduce((sum, c) => sum + c.volume, 0) / baselineSlice.length;
    if (avgVolume <= 0) return; // no baseline yet — can't detect a spike

    const spikeDetected = currentCandle.volume > avgVolume * this.spikeMultiplier;
    if (!spikeDetected) return;

    console.log(
      `[VolumeTrackerBot:${this.id}] block ${blockNumber}: volume spike! ` +
      `candle=${currentCandle.volume.toFixed(0)} avg=${avgVolume.toFixed(0)} ` +
      `(${(currentCandle.volume / avgVolume).toFixed(1)}x) — buying`,
    );

    await this._buy(blockNumber);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Determine which token is WETH and which is the speculative asset.
   * The bot spends WETH to buy the non-WETH token, following the momentum.
   * Returns { wethAddr, wethDecimals, assetAddr, assetDecimals, assetSymbol }.
   */
  private _tokenRoles(info: { token0: string; token1: string; symbol0: string; symbol1: string; decimals0: number; decimals1: number }) {
    const wethIsToken0 = info.symbol0.toUpperCase() === "WETH";
    return wethIsToken0
      ? {
          wethAddr:       info.token0,
          wethDecimals:   info.decimals0,
          assetAddr:      info.token1,
          assetDecimals:  info.decimals1,
          assetSymbol:    info.symbol1,
        }
      : {
          wethAddr:       info.token1,
          wethDecimals:   info.decimals1,
          assetAddr:      info.token0,
          assetDecimals:  info.decimals0,
          assetSymbol:    info.symbol0,
        };
  }

  private async _buy(blockNumber: number): Promise<void> {
    try {
      const { info } = this.pools.getPool(this.poolId);
      const { wethAddr, assetAddr, assetDecimals, assetSymbol } = this._tokenRoles(info);

      // Spend `buyAmountEth` worth of WETH to buy the speculative asset.
      const rawIn = ethers.parseEther(this.buyAmountEth.toFixed(6));
      const amountIn = await this._slippageCap(this.poolId, wethAddr, rawIn, 300);
      if (amountIn === 0n) return;

      const tokWeth = this.pools.getTokenWithSigner(wethAddr, this.signer);
      const balWeth = BigInt(await tokWeth.balanceOf(this.signerAddress));
      if (balWeth < amountIn) {
        console.log(`[VolumeTrackerBot:${this.id}] insufficient WETH balance — skipping buy`);
        return;
      }

      await tokWeth.approve(info.address, amountIn);
      const pool = this.pools.getPoolWithSigner(this.poolId, this.signer);
      await pool.swapExactIn(wethAddr, amountIn, 0n, this.signerAddress);

      // Record full asset balance so we can sell it all later.
      const tokAsset = this.pools.getTokenWithSigner(assetAddr, this.signer);
      this.tokenAHeld = BigInt(await tokAsset.balanceOf(this.signerAddress));

      this.holding  = true;
      this.buyBlock = blockNumber;

      console.log(
        `[VolumeTrackerBot:${this.id}] block ${blockNumber}: bought ` +
        `${ethers.formatUnits(this.tokenAHeld, assetDecimals)} ${assetSymbol}`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("insufficient")) {
        console.error(`[VolumeTrackerBot:${this.id}] buy error @ block ${blockNumber}:`, msg.slice(0, 120));
      }
    }
  }

  private async _sellPosition(blockNumber: number): Promise<void> {
    try {
      const { info } = this.pools.getPool(this.poolId);
      const { assetAddr, assetDecimals, assetSymbol } = this._tokenRoles(info);

      const tokAsset = this.pools.getTokenWithSigner(assetAddr, this.signer);
      const balance = BigInt(await tokAsset.balanceOf(this.signerAddress));
      if (balance === 0n) {
        this.holding    = false;
        this.tokenAHeld = 0n;
        return;
      }

      const amountIn = await this._slippageCap(this.poolId, assetAddr, balance, 300);
      if (amountIn === 0n) {
        this.holding    = false;
        this.tokenAHeld = 0n;
        return;
      }

      await tokAsset.approve(info.address, amountIn);
      const pool = this.pools.getPoolWithSigner(this.poolId, this.signer);
      await pool.swapExactIn(assetAddr, amountIn, 0n, this.signerAddress);

      console.log(
        `[VolumeTrackerBot:${this.id}] block ${blockNumber}: sold ` +
        `${ethers.formatUnits(amountIn, assetDecimals)} ${assetSymbol} (held ${blockNumber - this.buyBlock} blocks)`,
      );

      this.holding    = false;
      this.tokenAHeld = 0n;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("insufficient")) {
        console.error(`[VolumeTrackerBot:${this.id}] sell error @ block ${blockNumber}:`, msg.slice(0, 120));
      }
      // Reset state so the bot doesn't stay stuck in holding mode on repeated errors.
      this.holding    = false;
      this.tokenAHeld = 0n;
    }
  }
}
