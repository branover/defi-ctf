import {
  createChart, createSeriesMarkers, type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi,
  CandlestickSeries, HistogramSeries, LineSeries,
} from "lightweight-charts";
import type { WSClient } from "../ws/WSClient.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OHLCVCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PairOption {
  id: string;
  label: string;
  exchangeId: string;
  exchangeName: string;
}

export interface TradeEvent {
  blockNumber: number;
  pool: string;
  direction: "buy" | "sell";
  tokenIn: string;
  amountIn: string;
  amountOut: string;
  txHash: string;
  timestamp?: number;
}

type Indicator = "sma20" | "ema20" | "bb20" | "none";

// ── Math helpers ──────────────────────────────────────────────────────────────

function calcSMA(data: OHLCVCandle[], period = 20): { time: number; value: number }[] {
  return data.map((_, i) => {
    if (i < period - 1) return null;
    const slice = data.slice(i - period + 1, i + 1);
    const avg = slice.reduce((s, c) => s + c.close, 0) / period;
    return { time: data[i].time, value: avg };
  }).filter(Boolean) as { time: number; value: number }[];
}

function calcEMA(data: OHLCVCandle[], period = 20): { time: number; value: number }[] {
  if (data.length < period) return [];
  const k = 2 / (period + 1);
  const result: { time: number; value: number }[] = [];
  let ema = data.slice(0, period).reduce((s, c) => s + c.close, 0) / period;
  result.push({ time: data[period - 1].time, value: ema });
  for (let i = period; i < data.length; i++) {
    ema = data[i].close * k + ema * (1 - k);
    result.push({ time: data[i].time, value: ema });
  }
  return result;
}

function calcBB(data: OHLCVCandle[], period = 20, mult = 2): {
  upper: { time: number; value: number }[];
  lower: { time: number; value: number }[];
} {
  const upper: { time: number; value: number }[] = [];
  const lower: { time: number; value: number }[] = [];
  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1);
    const avg = slice.reduce((s, c) => s + c.close, 0) / period;
    const variance = slice.reduce((s, c) => s + (c.close - avg) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper.push({ time: data[i].time, value: avg + mult * sd });
    lower.push({ time: data[i].time, value: avg - mult * sd });
  }
  return { upper, lower };
}

// Aggregate candles from N-block engine candles into M*N-block display candles
function aggregate(candles: OHLCVCandle[], factor: number): OHLCVCandle[] {
  if (factor <= 1) return candles;
  const out: OHLCVCandle[] = [];
  for (let i = 0; i < candles.length; i += factor) {
    const slice = candles.slice(i, i + factor);
    if (slice.length === 0) break;
    out.push({
      time:   slice[0].time,
      open:   slice[0].open,
      high:   Math.max(...slice.map(c => c.high)),
      low:    Math.min(...slice.map(c => c.low)),
      close:  slice[slice.length - 1].close,
      volume: slice.reduce((s, c) => s + c.volume, 0),
    });
  }
  return out;
}

// Format a wei-string amount into a short human-readable label (e.g. 1.23e18 → "1.23")
function fmtAmount(raw: string): string {
  try {
    const n = parseFloat(raw);
    if (isNaN(n)) return raw;
    // Assume 18 decimals for amounts coming from the engine
    const val = n / 1e18;
    if (val >= 1000) return val.toFixed(0);
    if (val >= 1)    return val.toFixed(2);
    if (val >= 0.001) return val.toFixed(4);
    return val.toExponential(2);
  } catch {
    return raw;
  }
}

// ── ChartPanel ────────────────────────────────────────────────────────────────

export class ChartPanel {
  private container:    HTMLElement;
  private chart:        IChartApi;
  private candleSeries: ISeriesApi<"Candlestick">;
  private volumeSeries: ISeriesApi<"Histogram">;
  private indSeries:    ISeriesApi<"Line">[] = [];
  private priceLabel:   HTMLElement;
  private controls:     HTMLElement;
  private tradeLogEl:   HTMLElement;

  private currentPair       = "";
  private currentExchangeId = "";
  private rawCandles:        OHLCVCandle[] = [];
  private currentIndicator:  Indicator = "none";
  private currentTfFactor    = 1;  // timeframe multiplier vs engine candle size
  private availablePairs: PairOption[] = [];

  // Trade state
  private trades: TradeEvent[] = [];
  // Markers plugin attached to the candleSeries for buy/sell annotations
  private tradeMarkersPlugin: ISeriesMarkersPluginApi<number> | null = null;

  // Callbacks
  onPairChange?: (pair: string) => void;

  constructor(
    container: HTMLElement,
    private ws: WSClient,
    initialPairs: PairOption[] = [],
  ) {
    this.container = container;
    container.style.cssText = "display:flex;flex-direction:column;height:100%;position:relative;";

    // ── Top control bar ──────────────────────────────────────────────────────
    this.controls = document.createElement("div");
    this.controls.className = "chart-controls";
    this.controls.innerHTML = `
      <select class="chart-select platform-select" title="Platform"></select>
      <select class="chart-select pair-select" title="Pair">
        <option value="">—</option>
      </select>
      <span class="chart-sep">|</span>
      <span class="ctrl-label">TF</span>
      ${[1, 2, 5].map(f => `<button class="chart-btn tf-btn${f === 1 ? " active" : ""}" data-tf="${f}">${f}×</button>`).join("")}
      <span class="chart-sep">|</span>
      <span class="ctrl-label" title="Overlay indicators on the price chart">IND</span>
      ${([
        { id: "none",  label: "off",   tip: "No indicator overlay" },
        { id: "sma20", label: "SMA20", tip: "Simple Moving Average (20 periods)" },
        { id: "ema20", label: "EMA20", tip: "Exponential Moving Average (20 periods)" },
        { id: "bb20",  label: "BB20",  tip: "Bollinger Bands (20 periods, 2σ)" },
      ] as const).map(({ id, label, tip }) => `
        <button class="chart-btn ind-btn${id === "none" ? " active" : ""}" data-ind="${id}" title="${tip}">${label}</button>
      `).join("")}
    `;
    container.appendChild(this.controls);

    // ── Chart div ────────────────────────────────────────────────────────────
    const chartDiv = document.createElement("div");
    chartDiv.style.cssText = "flex:1;min-height:0;width:100%;position:relative;";
    container.appendChild(chartDiv);

    // ── Price label (inside chart area so absolute position clears controls) ─
    this.priceLabel = document.createElement("div");
    this.priceLabel.className = "price-label";
    this.priceLabel.textContent = "—";
    chartDiv.appendChild(this.priceLabel);

    this.chart = createChart(chartDiv, {
      layout:     { background: { color: "#0d1117" }, textColor: "#c9d1d9" },
      grid:       { vertLines: { color: "#21262d" }, horzLines: { color: "#21262d" } },
      crosshair:  { mode: 1 },
      rightPriceScale: { borderColor: "#30363d" },
      timeScale:  { borderColor: "#30363d", timeVisible: true },
      width:  chartDiv.clientWidth,
      height: chartDiv.clientHeight || 300,
    });

    this.candleSeries = this.chart.addSeries(CandlestickSeries, {
      upColor: "#3fb950", downColor: "#f85149",
      wickUpColor: "#3fb950", wickDownColor: "#f85149",
      borderVisible: false,
    });

    this.volumeSeries = this.chart.addSeries(HistogramSeries, {
      color: "#388bfd40",
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    this.chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    // Auto-resize
    new ResizeObserver(() => {
      this.chart.applyOptions({ width: chartDiv.clientWidth, height: chartDiv.clientHeight });
    }).observe(chartDiv);

    // ── Control listeners ────────────────────────────────────────────────────
    const platformSel = this.controls.querySelector<HTMLSelectElement>(".platform-select")!;
    const pairSel = this.controls.querySelector<HTMLSelectElement>(".pair-select")!;
    platformSel.addEventListener("change", () => {
      this.currentExchangeId = platformSel.value;
      this._renderPairOptions();
      if (pairSel.value) this.onPairChange?.(pairSel.value);
    });
    pairSel.addEventListener("change", () => {
      if (pairSel.value) this.onPairChange?.(pairSel.value);
    });

    this.controls.querySelectorAll<HTMLButtonElement>(".tf-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        this.controls.querySelectorAll(".tf-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        this.currentTfFactor = parseInt(btn.dataset.tf!);
        this._redraw();
      });
    });

    this.controls.querySelectorAll<HTMLButtonElement>(".ind-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        this.controls.querySelectorAll(".ind-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        this.currentIndicator = btn.dataset.ind as Indicator;
        // Pass fitContent=false so toggling an indicator does not reset the
        // user's current zoom/scroll position (#139).
        this._redraw(false);
      });
    });

    // ── Trade log panel ──────────────────────────────────────────────────────
    this.tradeLogEl = document.createElement("div");
    this.tradeLogEl.className = "trade-log";
    this.tradeLogEl.innerHTML = `
      <div class="trade-log-header">
        <span class="trade-log-title">Trades</span>
        <button class="chart-btn trade-log-toggle" title="Toggle trade log">▼</button>
      </div>
      <div class="trade-log-body"></div>
    `;
    container.appendChild(this.tradeLogEl);

    const toggleBtn = this.tradeLogEl.querySelector<HTMLButtonElement>(".trade-log-toggle")!;
    const logBody   = this.tradeLogEl.querySelector<HTMLElement>(".trade-log-body")!;
    let logOpen = false;
    logBody.style.display = "none";
    toggleBtn.addEventListener("click", () => {
      logOpen = !logOpen;
      logBody.style.display = logOpen ? "block" : "none";
      toggleBtn.textContent = logOpen ? "▲" : "▼";
    });

    // ── WS subscriptions ─────────────────────────────────────────────────────
    ws.on("candle", (raw) => {
      const p = raw as { pair: string; candle: OHLCVCandle; isUpdate: boolean };
      if (p.pair !== this.currentPair) return;
      if (p.isUpdate && this.rawCandles.length > 0) {
        this.rawCandles[this.rawCandles.length - 1] = p.candle;
      } else {
        this.rawCandles.push(p.candle);
        if (this.rawCandles.length > 2000) this.rawCandles.shift();
      }
      this._pushLiveCandle(p.candle);
    });

    ws.on("price", (raw) => {
      const p = raw as { pair: string; price: number };
      if (p.pair !== this.currentPair) return;
      this.priceLabel.textContent = `${p.pair.toUpperCase()}  $${p.price.toFixed(2)}`;
    });

    ws.on("trade", (raw) => {
      const t = raw as TradeEvent;
      if (t.pool !== this.currentPair) return;
      this.trades.push(t);
      this._addTradeMarker(t);
      this._appendTradeLogRow(t);
    });

    this.updatePairOptions(initialPairs);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  setPair(pair: string, history: OHLCVCandle[]) {
    this.currentPair  = pair;
    this.rawCandles   = [...history];

    const option = this.availablePairs.find(p => p.id === pair);
    if (option) {
      this.currentExchangeId = option.exchangeId;
    }
    this._renderPlatformOptions();
    this._renderPairOptions();

    // Replay trade markers for the new pair
    this._redrawTradeMarkers();
    this._redraw();
    this.priceLabel.textContent = option ? `${option.label} · ${option.exchangeName}` : pair.toUpperCase();
  }

  getCurrentPair(): string {
    return this.currentPair;
  }

  updatePairOptions(pairs: PairOption[]) {
    this.availablePairs = [...pairs];
    if (!this.currentExchangeId && this.availablePairs.length > 0) {
      this.currentExchangeId = this.availablePairs[0].exchangeId;
    }
    // If the current pair is still in the new set, keep it selected (Issue #35).
    // Only fall back to first if it's truly gone.
    if (this.currentPair && !this.availablePairs.some(p => p.id === this.currentPair)) {
      this.currentPair = "";
    }
    this._renderPlatformOptions();
    this._renderPairOptions();
  }

  /**
   * Reset chart state when a new challenge starts (Issue #26).
   * Clears all candle data, trade markers, and the trade log.
   * Preserves the user's panel layout and indicator preferences.
   */
  reset() {
    this.rawCandles = [];
    this.trades = [];
    this.currentPair = "";

    // Clear candles & volume from the chart
    this.candleSeries.setData([]);
    this.volumeSeries.setData([]);

    // Remove indicator series
    this.indSeries.forEach(s => { try { this.chart.removeSeries(s); } catch {} });
    this.indSeries = [];

    // Detach trade marker plugin and clear trade state
    this._clearTradeMarkers();

    // Clear trade log body
    const logBody = this.tradeLogEl.querySelector<HTMLElement>(".trade-log-body");
    if (logBody) logBody.innerHTML = "";

    // Reset price label
    this.priceLabel.textContent = "—";
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _renderPlatformOptions() {
    const platformSel = this.controls.querySelector<HTMLSelectElement>(".platform-select")!;
    const entries = new Map<string, string>();
    for (const p of this.availablePairs) {
      if (!entries.has(p.exchangeId)) entries.set(p.exchangeId, p.exchangeName);
    }
    const platforms = [...entries.entries()];

    // Issue #44: only touch the DOM when the option list actually changes so the
    // browser doesn't reset the visible selected-option highlight on every tick.
    const newHtml = platforms.length
      ? platforms.map(([id, name]) => `<option value="${id}">${name}</option>`).join("")
      : `<option value="">—</option>`;
    if (platformSel.innerHTML !== newHtml) platformSel.innerHTML = newHtml;

    if (this.currentExchangeId && entries.has(this.currentExchangeId)) {
      platformSel.value = this.currentExchangeId;
    } else if (platforms.length > 0) {
      this.currentExchangeId = platforms[0][0];
      platformSel.value = this.currentExchangeId;
    } else {
      this.currentExchangeId = "";
      platformSel.value = "";
    }
  }

  private _renderPairOptions() {
    const pairSel = this.controls.querySelector<HTMLSelectElement>(".pair-select")!;
    const visible = this.currentExchangeId
      ? this.availablePairs.filter(p => p.exchangeId === this.currentExchangeId)
      : this.availablePairs;

    // Issue #44: capture what the DOM thinks is selected before we touch innerHTML,
    // then use that as a fallback so selection survives even a full option rebuild.
    const savedValue = this.currentPair || pairSel.value;

    const newHtml = visible.length
      ? visible.map(p => `<option value="${p.id}">${p.label}</option>`).join("")
      : `<option value="">—</option>`;
    if (pairSel.innerHTML !== newHtml) pairSel.innerHTML = newHtml;

    // Issue #35 / #44: if the currently selected pair is still visible, keep it sticky.
    if (savedValue && visible.some(p => p.id === savedValue)) {
      this.currentPair = savedValue;
      pairSel.value = savedValue;
      return;
    }
    if (visible.length > 0) {
      this.currentPair = visible[0].id;
      pairSel.value = this.currentPair;
    } else {
      this.currentPair = "";
      pairSel.value = "";
    }
  }

  private _redraw(fitContent = true) {
    const display = aggregate(this.rawCandles, this.currentTfFactor);

    // Candles
    this.candleSeries.setData(
      display.map(c => ({ ...c, time: c.time as unknown as import("lightweight-charts").UTCTimestamp }))
    );
    // Volume
    this.volumeSeries.setData(
      display.map(c => ({
        time:  c.time as unknown as import("lightweight-charts").UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? "#3fb95040" : "#f8514940",
      }))
    );

    // Remove old indicator series
    this.indSeries.forEach(s => { try { this.chart.removeSeries(s); } catch {} });
    this.indSeries = [];

    // Add new indicators
    switch (this.currentIndicator) {
      case "sma20": {
        const s = this.chart.addSeries(LineSeries, { color: "#f7c948", lineWidth: 1, priceLineVisible: false });
        s.setData(calcSMA(display).map(p => ({ ...p, time: p.time as unknown as import("lightweight-charts").UTCTimestamp })));
        this.indSeries.push(s);
        break;
      }
      case "ema20": {
        const s = this.chart.addSeries(LineSeries, { color: "#58a6ff", lineWidth: 1, priceLineVisible: false });
        s.setData(calcEMA(display).map(p => ({ ...p, time: p.time as unknown as import("lightweight-charts").UTCTimestamp })));
        this.indSeries.push(s);
        break;
      }
      case "bb20": {
        const bb = calcBB(display);
        const su = this.chart.addSeries(LineSeries, { color: "#a5d6ff80", lineWidth: 1, priceLineVisible: false });
        const sl = this.chart.addSeries(LineSeries, { color: "#a5d6ff80", lineWidth: 1, priceLineVisible: false });
        su.setData(bb.upper.map(p => ({ ...p, time: p.time as unknown as import("lightweight-charts").UTCTimestamp })));
        sl.setData(bb.lower.map(p => ({ ...p, time: p.time as unknown as import("lightweight-charts").UTCTimestamp })));
        this.indSeries.push(su, sl);
        break;
      }
    }

    if (fitContent) this.chart.timeScale().fitContent();
  }

  private _pushLiveCandle(raw: OHLCVCandle) {
    // If TF factor is 1, stream directly. Otherwise re-aggregate last few candles.
    if (this.currentTfFactor === 1) {
      const c = { ...raw, time: raw.time as unknown as import("lightweight-charts").UTCTimestamp };
      this.candleSeries.update(c);
      this.volumeSeries.update({
        time: c.time, value: raw.volume,
        color: raw.close >= raw.open ? "#3fb95040" : "#f8514940",
      });
    } else {
      // Batch update: rebuild last aggregated candle
      const tail = this.rawCandles.slice(-this.currentTfFactor * 2);
      const agg  = aggregate(tail, this.currentTfFactor);
      if (agg.length > 0) {
        const last = agg[agg.length - 1];
        const t = last.time as unknown as import("lightweight-charts").UTCTimestamp;
        this.candleSeries.update({ ...last, time: t });
        this.volumeSeries.update({ time: t, value: last.volume, color: last.close >= last.open ? "#3fb95040" : "#f8514940" });
      }
    }
  }

  // ── Trade markers (Issue #32) ─────────────────────────────────────────────

  /**
   * Add a marker annotation for a trade using lightweight-charts v5's
   * createSeriesMarkers() plugin attached to the main candleSeries.
   * This is the correct v5 API — ISeriesApi no longer has setMarkers() directly.
   */
  private _addTradeMarker(trade: TradeEvent) {
    const isBuy = trade.direction === "buy";
    const color = isBuy ? "#3fb950" : "#f85149";
    const t = trade.blockNumber as unknown as import("lightweight-charts").UTCTimestamp;

    // Lazily create the markers plugin on first use
    if (!this.tradeMarkersPlugin) {
      this.tradeMarkersPlugin = createSeriesMarkers(this.candleSeries, []);
    }

    const current = this.tradeMarkersPlugin.markers();
    this.tradeMarkersPlugin.setMarkers([
      ...current,
      {
        time: t,
        position: "aboveBar",
        color,
        shape: isBuy ? "arrowUp" : "arrowDown",
        text: `${isBuy ? "B" : "S"} ${fmtAmount(trade.amountIn)}`,
      },
    ]);
  }

  /** Detach the trade markers plugin and release all marker annotations. */
  private _clearTradeMarkers() {
    if (this.tradeMarkersPlugin) {
      try { this.tradeMarkersPlugin.detach(); } catch {}
      this.tradeMarkersPlugin = null;
    }
  }

  /**
   * Re-render all trade markers for the current pair.
   * Called when setPair() switches the displayed pair or when reset() clears everything.
   */
  private _redrawTradeMarkers() {
    this._clearTradeMarkers();
    for (const t of this.trades) {
      if (t.pool === this.currentPair) {
        this._addTradeMarker(t);
      }
    }
  }

  /** Append a row to the collapsible trade log. */
  private _appendTradeLogRow(trade: TradeEvent) {
    const logBody = this.tradeLogEl.querySelector<HTMLElement>(".trade-log-body");
    if (!logBody) return;

    const isBuy = trade.direction === "buy";
    const row = document.createElement("div");
    row.className = `trade-log-row trade-log-${isBuy ? "buy" : "sell"}`;

    const shortHash = trade.txHash ? `${trade.txHash.slice(0, 8)}…` : "—";
    row.innerHTML = `
      <span class="tl-block">#${trade.blockNumber}</span>
      <span class="tl-dir">${isBuy ? "▲ BUY" : "▼ SELL"}</span>
      <span class="tl-pool">${trade.pool}</span>
      <span class="tl-amt">${fmtAmount(trade.amountIn)} → ${fmtAmount(trade.amountOut)}</span>
      <span class="tl-hash" title="${trade.txHash}">${shortHash}</span>
    `;
    logBody.appendChild(row);
    // Auto-scroll to latest
    logBody.scrollTop = logBody.scrollHeight;
  }
}
