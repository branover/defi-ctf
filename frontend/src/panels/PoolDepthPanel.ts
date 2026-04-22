import type { WSClient } from "../ws/WSClient.js";
import {
  askDepth,
  bidDepth,
  fmtToken,
  fmtUSD,
  maxTradeForImpact,
} from "../lib/poolDepthMath.js";

// ── Pool metadata stored from price messages ───────────────────────────────────

interface PoolState {
  pair:      string;
  symbol0:   string;
  symbol1:   string;
  decimals0: number;
  decimals1: number;
  r0:        number;   // token0 in human units
  r1:        number;   // token1 in human units
  price:     number;   // token1 per token0
  exchange?: string;
  displayName?: string;
}

export class PoolDepthPanel {
  private container: HTMLElement;
  private pools = new Map<string, PoolState>();
  private exchangeMeta = new Map<string, { exchange: string; displayName: string }>();

  constructor(container: HTMLElement, ws: WSClient) {
    this.container = container;
    container.innerHTML = `
      <div class="panel-title">POOL DEPTH</div>
      <div id="depth-pools" class="depth-pools-list">
        <div class="empty-state">Start a challenge to see pool depth</div>
      </div>
    `;

    // Capture exchange info from challenges message
    ws.on("challenges", (raw) => {
      const list = (Array.isArray(raw) ? raw : (raw as any).challenges ?? []) as Array<{
        pools?: Array<{ id: string; exchange?: string; displayName?: string }>;
      }>;
      for (const c of list) {
        for (const p of c.pools ?? []) {
          this.exchangeMeta.set(p.id, {
            exchange:    p.exchange    ?? "dex",
            displayName: p.displayName ?? "DEX",
          });
        }
      }
    });

    // Update pool data from each price broadcast
    ws.on("price", (raw) => {
      const p = raw as {
        pair: string; price: number;
        reserve0: string; reserve1: string;
        symbol0?: string; symbol1?: string;
        decimals0?: number; decimals1?: number;
      };
      // Only update if we have the decimals (sent since engine update)
      if (p.decimals0 === undefined) return;

      const r0 = Number(BigInt(p.reserve0)) / 10 ** p.decimals0!;
      const r1 = Number(BigInt(p.reserve1)) / 10 ** p.decimals1!;
      const meta = this.exchangeMeta.get(p.pair);
      this.pools.set(p.pair, {
        pair:      p.pair,
        symbol0:   p.symbol0 ?? "TOKEN0",
        symbol1:   p.symbol1 ?? "TOKEN1",
        decimals0: p.decimals0!,
        decimals1: p.decimals1!,
        r0, r1,
        price: p.price,
        exchange:    meta?.exchange,
        displayName: meta?.displayName,
      });
      this._render();
    });

    // Clear on challenge stop/idle
    ws.on("challenge", (raw) => {
      const s = raw as { status: string };
      if (s.status === "idle") {
        this.pools.clear();
        this._render();
      }
    });
  }

  private _render() {
    const list = this.container.querySelector("#depth-pools")!;

    if (this.pools.size === 0) {
      list.innerHTML = `<div class="empty-state">Start a challenge to see pool depth</div>`;
      return;
    }

    list.innerHTML = [...this.pools.values()].map(pool => {
      const { symbol0, symbol1, r0, r1, price, displayName } = pool;
      const tvl = 2 * r1;  // ≈ 2 × USDC reserves

      // Impact table: max trade for 1%, 2%, 5% slippage
      const impactRows = [
        { pct: 1,  label: "1% slippage" },
        { pct: 2,  label: "2% slippage" },
        { pct: 5,  label: "5% slippage" },
        { pct: 10, label: "10% slippage" },
      ].map(({ pct, label }) => {
        const maxTok0 = maxTradeForImpact(pct, r0);
        const maxUSD  = maxTok0 * price;
        return `<div class="depth-impact-row">
          <span class="depth-impact-label">${label}</span>
          <span class="depth-impact-value">${fmtToken(maxTok0, 4)} ${symbol0} (${fmtUSD(maxUSD)})</span>
        </div>`;
      }).join("");

      // Depth bars: ±1%, ±5%, ±10%
      const bands = [
        { pct: 1,  label: "±1%" },
        { pct: 5,  label: "±5%" },
        { pct: 10, label: "±10%" },
      ];
      const maxDepthUSD = askDepth(10, r0) * price; // normalise bar width against ±10%

      const bandRows = bands.map(({ pct, label }) => {
        const ask = askDepth(pct, r0);
        const bid = bidDepth(pct, r0);
        const askUSD = ask * price;
        const bidUSD = bid * price;
        const askPct = maxDepthUSD > 0 ? Math.min(100, (askUSD / maxDepthUSD) * 100) : 0;
        const bidPct = maxDepthUSD > 0 ? Math.min(100, (bidUSD / maxDepthUSD) * 100) : 0;
        return `<div class="depth-band-row">
          <span class="depth-band-label">${label}</span>
          <div class="depth-band-bars">
            <div class="depth-bar-bid" style="width:${bidPct.toFixed(1)}%"></div>
            <div class="depth-bar-ask" style="width:${askPct.toFixed(1)}%"></div>
          </div>
          <span class="depth-band-vals">${fmtUSD(bidUSD)} / ${fmtUSD(askUSD)}</span>
        </div>`;
      }).join("");

      return `
        <div class="depth-pool-section">
          <div class="depth-pool-header">
            <span class="depth-pool-name">${displayName ?? "DEX"} · ${symbol0}/${symbol1}</span>
            <span class="depth-pool-price">$${price.toFixed(2)}</span>
          </div>
          <div class="depth-tvl">TVL ≈ ${fmtUSD(tvl)} · ${fmtToken(r0, 2)} ${symbol0} / ${fmtToken(r1, 0)} ${symbol1}</div>
          <div class="depth-impact-table">${impactRows}</div>
          <div class="depth-bands-title">Depth bands (bid / ask USD)</div>
          ${bandRows}
        </div>
      `;
    }).join("");
  }
}
