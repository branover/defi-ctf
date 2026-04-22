import { ChartPanel, type OHLCVCandle, type PairOption } from "./ChartPanel.js";

function loadHistory(pair: string): Promise<OHLCVCandle[]> {
  return fetch(`/api/history/${pair}?lastN=300`)
    .then(r => (r.ok ? r.json() : Promise.resolve([])))
    .catch(() => [] as OHLCVCandle[]);
}
import type { WSClient } from "../ws/WSClient.js";

type Layout = 1 | 2 | 4;

export class ChartGrid {
  private container: HTMLElement;
  private ws: WSClient;
  private panels: ChartPanel[] = [];
  private layout: Layout = 1;
  private knownPairs: PairOption[] = [];

  constructor(container: HTMLElement, ws: WSClient) {
    this.container = container;
    this.ws = ws;
    this._applyLayout(1);
  }

  /** Called when new pairs become known (from price messages) */
  updatePairs(pairs: PairOption[]) {
    this.knownPairs = pairs;
    this.panels.forEach(p => p.updatePairOptions(pairs));
  }

  /**
   * Reset all panels when a new challenge starts (Issue #26).
   * Clears candle data, trade markers, and trade logs across all panels.
   * After reset, pair options are updated so dropdowns reflect the new challenge's pools.
   */
  resetForNewChallenge(pairs: PairOption[]) {
    this.knownPairs = pairs;
    this.panels.forEach(p => {
      p.reset();
      p.updatePairOptions(pairs);
    });
  }

  /** Load history into the first panel that is showing this pair, or first empty panel */
  setPair(pair: string, history: OHLCVCandle[]) {
    // First: find any panel already on this pair
    let target = this.panels.find(p => p.getCurrentPair() === pair);
    // Second: find first panel with no pair
    if (!target) target = this.panels.find(p => !p.getCurrentPair());
    // Fall back to first panel
    if (!target) target = this.panels[0];
    target?.setPair(pair, history);
  }

  setLayout(n: Layout) {
    if (n === this.layout) return;
    this.layout = n;
    const activePairs = this.panels.map(p => p.getCurrentPair()).filter(Boolean) as string[];
    this._applyLayout(n);
    activePairs.forEach((pair, i) => {
      const panel = this.panels[i];
      if (!panel || !pair) return;
      panel.updatePairOptions(this.knownPairs);
      loadHistory(pair).then((candles) => panel.setPair(pair, candles));
    });
  }

  private _applyLayout(n: Layout) {
    this.panels = [];
    this.container.innerHTML = "";
    this.container.className = `chart-grid chart-grid-${n}`;

    for (let i = 0; i < n; i++) {
      const wrapper = document.createElement("div");
      wrapper.className = "chart-cell";
      this.container.appendChild(wrapper);

      const panel = new ChartPanel(wrapper, this.ws, [...this.knownPairs]);
      panel.onPairChange = (pair) => this._onPanelPairChange(panel, pair);
      this.panels.push(panel);
    }
  }

  private _onPanelPairChange(panel: ChartPanel, pair: string) {
    loadHistory(pair).then((candles) => panel.setPair(pair, candles));
  }
}
