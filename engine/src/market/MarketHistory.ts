import { CandleBuilder, type Candle } from "./CandleBuilder.js";

export interface PriceTick {
  blockNumber: number;
  timestamp:   number;
  price:       number;
  reserve0:    bigint;
  reserve1:    bigint;
}

/** Per-pool price history: ring buffer of ticks + full candle history */
export class MarketHistory {
  private ticks:   PriceTick[] = [];
  private candles: Map<string, Candle[]> = new Map();
  private builders: Map<string, CandleBuilder> = new Map();
  /** Last seen reserve0 per pool, used to compute per-block swap volume */
  private lastReserve0: Map<string, bigint> = new Map();
  private readonly MAX_TICKS = 5000;

  clear() {
    this.ticks = [];
    this.candles.clear();
    this.builders.clear();
    this.lastReserve0.clear();
  }

  registerPool(id: string, blocksPerCandle = 10) {
    this.candles.set(id, []);
    this.builders.set(id, new CandleBuilder(blocksPerCandle));
  }

  recordTick(poolId: string, tick: PriceTick): { candle: Candle; isNew: boolean } | null {
    // Infer volume from reserve0 change (absolute delta in token0 units, normalised to float).
    // This is an approximation: any block where reserves changed reflects swap activity.
    const prev = this.lastReserve0.get(poolId);
    const volumeRaw = prev !== undefined ? (tick.reserve0 > prev ? tick.reserve0 - prev : prev - tick.reserve0) : 0n;
    // Keep volume as a raw bigint-scaled number; consumers normalise by decimals if needed.
    // We store it as a plain JS number (token0 smallest units).  For WETH (18 dec) this can
    // be large, but Number can represent up to 2^53 safely for amounts < ~9000 WETH.
    const volume = Number(volumeRaw);
    this.lastReserve0.set(poolId, tick.reserve0);

    this.ticks.push(tick);
    if (this.ticks.length > this.MAX_TICKS) this.ticks.shift();

    const builder = this.builders.get(poolId);
    if (!builder) return null;

    const result = builder.feed(tick.blockNumber, tick.price, volume);
    const poolCandles = this.candles.get(poolId)!;

    if (result.isNew) {
      poolCandles.push(result.candle);
    } else {
      poolCandles[poolCandles.length - 1] = result.candle;
    }

    return result;
  }

  getCandles(poolId: string, lastN?: number): Candle[] {
    const all = this.candles.get(poolId) ?? [];
    return lastN ? all.slice(-lastN) : [...all];
  }

  getLatestPrice(poolId: string): number | null {
    const candles = this.candles.get(poolId);
    if (!candles || candles.length === 0) return null;
    return candles[candles.length - 1].close;
  }
}
