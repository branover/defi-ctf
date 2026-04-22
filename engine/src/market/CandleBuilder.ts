export interface Candle {
  time:   number;  // Unix seconds (block timestamp)
  open:   number;
  high:   number;
  low:    number;
  close:  number;
  volume: number;  // cumulative swap volume in token0 units during candle period
}

/** Aggregates per-block price ticks into OHLCV candles. */
export class CandleBuilder {
  private current: Candle | null = null;
  private blocksPerCandle: number;
  private candleStartBlock = 0;

  constructor(blocksPerCandle = 10) {
    this.blocksPerCandle = blocksPerCandle;
  }

  /**
   * Feed a new price tick. Returns:
   * - { candle, isNew: true }  when a new candle period begins (previous candle is closed)
   * - { candle, isNew: false } when the current candle is updated
   */
  feed(blockNumber: number, price: number, volume = 0): { candle: Candle; isNew: boolean } {
    const candleIndex = Math.floor(blockNumber / this.blocksPerCandle);
    const candleTime  = candleIndex * this.blocksPerCandle * 12; // 12 sec/block

    if (!this.current || Math.floor(this.candleStartBlock / this.blocksPerCandle) !== candleIndex) {
      // Start a new candle
      this.candleStartBlock = blockNumber;
      this.current = { time: candleTime, open: price, high: price, low: price, close: price, volume };
      return { candle: { ...this.current }, isNew: true };
    }

    this.current.high   = Math.max(this.current.high, price);
    this.current.low    = Math.min(this.current.low,  price);
    this.current.close  = price;
    this.current.volume += volume;
    return { candle: { ...this.current }, isNew: false };
  }

  getCurrent(): Candle | null {
    return this.current ? { ...this.current } : null;
  }
}
