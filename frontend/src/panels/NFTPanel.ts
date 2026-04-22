import type { WSClient } from "../ws/WSClient.js";

// ── Interfaces ────────────────────────────────────────────────────────────────

interface NftListing {
  tokenId:     string;
  seller:      string;
  price:       string;
  rarityScore: number;
}

interface OwnedNft {
  tokenId:     string;
  rarityScore: number;
}

interface SaleRecord {
  tokenId:       string;
  price:         string;
  seller:        string;
  buyer:         string;
  sellerLabel?:  string;
  buyerLabel?:   string;
  txHash:        string;
  blockNumber:   number;
  timestamp:     number;
}

interface ChallengePayload {
  id?:      string;
  status:   string;
  category?: string;
  contracts?: Array<{ id: string; type: string }>;
}

// ── Rarity helpers ────────────────────────────────────────────────────────────

function rarityTier(score: number): { label: string; cls: string } {
  if (score >= 81) return { label: "Legendary", cls: "rarity-legendary" };
  if (score >= 61) return { label: "Epic",      cls: "rarity-epic"      };
  if (score >= 41) return { label: "Rare",      cls: "rarity-rare"      };
  if (score >= 21) return { label: "Uncommon",  cls: "rarity-uncommon"  };
  if (score >= 1)  return { label: "Common",    cls: "rarity-common"    };
  return { label: "Hidden", cls: "rarity-unknown" };
}

// ── Procedural SVG avatar ─────────────────────────────────────────────────────

/**
 * Generate a deterministic corgi-face SVG avatar for an NFT based on tokenId and rarityScore.
 * - Background hue: (tokenId * 37 + rarityScore * 13) % 360
 * - Fur color: picked from a corgi-inspired palette (golden, orange, sable, cream, black+tan, red)
 * - Common (1-20):    plain corgi face
 * - Uncommon (21-40): + collar/bandana at bottom
 * - Rare (41-60):     + sparkle stars around the face
 * - Epic (61-80):     + sunglasses or small hat
 * - Legendary (81-100): + crown + glow filter + patterned background
 */
function generateNftSvg(tokenId: string | number, rarityScore: number, size = 80): string {
  const tid   = typeof tokenId === "string" ? parseInt(tokenId, 10) : tokenId;
  const score = rarityScore || 0;
  const tier  = score >= 81 ? 5 : score >= 61 ? 4 : score >= 41 ? 3 : score >= 21 ? 2 : 1;

  // Background palette (dark, slightly tinted)
  const bgHue  = (tid * 37 + score * 13) % 360;

  // Corgi fur palette — 6 classic corgi colors
  const furPalette = [
    { main: "hsl(33,85%,58%)",  shadow: "hsl(33,75%,42%)"  }, // golden orange
    { main: "hsl(22,80%,52%)",  shadow: "hsl(22,70%,38%)"  }, // red-brown / pembroke
    { main: "hsl(38,60%,48%)",  shadow: "hsl(38,55%,35%)"  }, // sable
    { main: "hsl(45,55%,78%)",  shadow: "hsl(45,45%,60%)"  }, // cream
    { main: "hsl(25,10%,20%)",  shadow: "hsl(25,10%,12%)"  }, // black+tan (dark base)
    { main: "hsl(15,75%,50%)",  shadow: "hsl(15,65%,36%)"  }, // red
  ];
  const fur = furPalette[tid % furPalette.length];

  // Snout / inner ear are cream-white regardless of fur
  const snoutColor = "hsl(45,60%,90%)";
  const earInner   = "hsl(10,60%,75%)";

  // Eye/pupil variation
  const eyeOffX = 3 + (tid % 3);            // slight eye-spacing variation
  const eyeSize = 3.5 + ((tid * 3) % 2);    // 3.5 or 4.5

  // Coordinate system centred on the face circle
  const cx = size / 2;
  const cy = size / 2 + 3;   // shift face slightly down to leave ear room
  const fr = size * 0.28;    // face radius (wide corgi ellipse, so rx/ry differ)
  const frx = fr * 1.20;     // face ellipse rx (wide)
  const fry = fr * 0.95;     // face ellipse ry

  let defs = "";
  let inner = "";

  // ── Defs (glow for legendary) ─────────────────────────────────────────────
  if (tier === 5) {
    defs = `<defs>`
      + `<filter id="glow${tid}" x="-30%" y="-30%" width="160%" height="160%">`
      + `<feGaussianBlur stdDeviation="2.5" result="blur"/>`
      + `<feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>`
      + `</filter>`
      + `<radialGradient id="lgbg${tid}" cx="50%" cy="50%" r="50%">`
      + `<stop offset="0%" stop-color="hsl(${bgHue},40%,22%)"/>`
      + `<stop offset="100%" stop-color="hsl(${bgHue},20%,8%)"/>`
      + `</radialGradient>`
      + `</defs>`;
  }

  // ── Background ────────────────────────────────────────────────────────────
  const bgFill = tier === 5
    ? `url(#lgbg${tid})`
    : `hsl(${bgHue},20%,10%)`;
  inner += `<rect width="${size}" height="${size}" fill="${bgFill}" rx="6"/>`;

  // Legendary: small diamond/star pattern overlay
  if (tier === 5) {
    for (let i = 0; i < 5; i++) {
      const px = 8 + ((tid * 7 + i * 17) % (size - 16));
      const py = 8 + ((tid * 11 + i * 23) % (size - 16));
      inner += `<circle cx="${px}" cy="${py}" r="1" fill="hsl(${bgHue},60%,50%)" opacity="0.35"/>`;
    }
  }

  // ── Ears (drawn first, behind head) ──────────────────────────────────────
  // Corgi ears: tall, pointed, alert — represented as triangles with rounded inner fill
  const earW = frx * 0.55;
  const earH = fry * 1.0;
  const earTopY = cy - fry * 0.85;

  // Left ear
  const lEx = cx - frx * 0.65;
  inner += `<polygon points="${lEx - earW * 0.5},${earTopY + earH} ${lEx},${earTopY - earH * 0.5} ${lEx + earW * 0.5},${earTopY + earH}" fill="${fur.shadow}"/>`;
  inner += `<polygon points="${lEx - earW * 0.28},${earTopY + earH} ${lEx},${earTopY - earH * 0.2} ${lEx + earW * 0.28},${earTopY + earH}" fill="${earInner}" opacity="0.7"/>`;

  // Right ear
  const rEx = cx + frx * 0.65;
  inner += `<polygon points="${rEx - earW * 0.5},${earTopY + earH} ${rEx},${earTopY - earH * 0.5} ${rEx + earW * 0.5},${earTopY + earH}" fill="${fur.shadow}"/>`;
  inner += `<polygon points="${rEx - earW * 0.28},${earTopY + earH} ${rEx},${earTopY - earH * 0.2} ${rEx + earW * 0.28},${earTopY + earH}" fill="${earInner}" opacity="0.7"/>`;

  // ── Head / face ───────────────────────────────────────────────────────────
  const glowAttr = tier === 5 ? ` filter="url(#glow${tid})"` : "";
  inner += `<ellipse cx="${cx}" cy="${cy}" rx="${frx}" ry="${fry}" fill="${fur.main}"${glowAttr}/>`;

  // ── Snout area ────────────────────────────────────────────────────────────
  const snoutCy = cy + fry * 0.30;
  const snoutRx = frx * 0.52;
  const snoutRy = fry * 0.32;
  inner += `<ellipse cx="${cx}" cy="${snoutCy}" rx="${snoutRx}" ry="${snoutRy}" fill="${snoutColor}"/>`;

  // ── Nose ──────────────────────────────────────────────────────────────────
  inner += `<ellipse cx="${cx}" cy="${snoutCy - snoutRy * 0.25}" rx="${snoutRx * 0.28}" ry="${snoutRy * 0.38}" fill="#1a1a1a"/>`;

  // ── Mouth ─────────────────────────────────────────────────────────────────
  const mouthY = snoutCy + snoutRy * 0.55;
  inner += `<path d="M${cx - snoutRx * 0.22} ${mouthY} Q${cx} ${mouthY + snoutRy * 0.45} ${cx + snoutRx * 0.22} ${mouthY}" fill="none" stroke="#1a1a1a" stroke-width="1.2" stroke-linecap="round"/>`;

  // ── Eyes ──────────────────────────────────────────────────────────────────
  const eyeY  = cy - fry * 0.18;
  const lEyeX = cx - eyeOffX * 2.2;
  const rEyeX = cx + eyeOffX * 2.2;

  // White sclera
  inner += `<circle cx="${lEyeX}" cy="${eyeY}" r="${eyeSize + 1.2}" fill="white"/>`;
  inner += `<circle cx="${rEyeX}" cy="${eyeY}" r="${eyeSize + 1.2}" fill="white"/>`;
  // Dark iris+pupil
  inner += `<circle cx="${lEyeX}" cy="${eyeY}" r="${eyeSize}" fill="#1a1a1a"/>`;
  inner += `<circle cx="${rEyeX}" cy="${eyeY}" r="${eyeSize}" fill="#1a1a1a"/>`;
  // White specular highlight
  inner += `<circle cx="${lEyeX + eyeSize * 0.35}" cy="${eyeY - eyeSize * 0.35}" r="${eyeSize * 0.30}" fill="white"/>`;
  inner += `<circle cx="${rEyeX + eyeSize * 0.35}" cy="${eyeY - eyeSize * 0.35}" r="${eyeSize * 0.30}" fill="white"/>`;

  // ── Uncommon: collar / bandana ────────────────────────────────────────────
  if (tier >= 2) {
    const collarY = cy + fry * 0.82;
    const collarHue = (bgHue + 180) % 360;
    inner += `<ellipse cx="${cx}" cy="${collarY}" rx="${frx * 0.75}" ry="${fry * 0.18}" fill="hsl(${collarHue},75%,45%)"/>`;
    // Bandana dot pattern
    for (let d = 0; d < 4; d++) {
      const dx = cx - frx * 0.5 + d * frx * 0.33;
      inner += `<circle cx="${dx}" cy="${collarY}" r="1.5" fill="hsl(${collarHue},60%,80%)" opacity="0.7"/>`;
    }
  }

  // ── Rare: sparkle stars ───────────────────────────────────────────────────
  if (tier >= 3) {
    const starPositions = [
      { x: cx - frx * 1.25, y: cy - fry * 0.8  },
      { x: cx + frx * 1.25, y: cy - fry * 0.8  },
      { x: cx - frx * 1.4,  y: cy + fry * 0.2  },
      { x: cx + frx * 1.4,  y: cy + fry * 0.2  },
    ];
    for (const sp of starPositions) {
      const sr = 2.5 + ((tid * 3 + sp.x) % 2);
      inner += `<line x1="${sp.x - sr}" y1="${sp.y}" x2="${sp.x + sr}" y2="${sp.y}" stroke="hsl(50,100%,75%)" stroke-width="1.2"/>`;
      inner += `<line x1="${sp.x}" y1="${sp.y - sr}" x2="${sp.x}" y2="${sp.y + sr}" stroke="hsl(50,100%,75%)" stroke-width="1.2"/>`;
      inner += `<line x1="${sp.x - sr * 0.7}" y1="${sp.y - sr * 0.7}" x2="${sp.x + sr * 0.7}" y2="${sp.y + sr * 0.7}" stroke="hsl(50,100%,75%)" stroke-width="0.8"/>`;
      inner += `<line x1="${sp.x + sr * 0.7}" y1="${sp.y - sr * 0.7}" x2="${sp.x - sr * 0.7}" y2="${sp.y + sr * 0.7}" stroke="hsl(50,100%,75%)" stroke-width="0.8"/>`;
    }
  }

  // ── Epic: sunglasses or hat (alternates by tokenId) ───────────────────────
  if (tier >= 4) {
    if (tid % 2 === 0) {
      // Sunglasses
      const sgY = eyeY + eyeSize * 0.1;
      const sgR = eyeSize + 2.2;
      inner += `<rect x="${lEyeX - sgR}" y="${sgY - sgR}" width="${sgR * 2}" height="${sgR * 2}" rx="${sgR * 0.45}" fill="hsl(${bgHue},60%,25%)" opacity="0.9"/>`;
      inner += `<rect x="${rEyeX - sgR}" y="${sgY - sgR}" width="${sgR * 2}" height="${sgR * 2}" rx="${sgR * 0.45}" fill="hsl(${bgHue},60%,25%)" opacity="0.9"/>`;
      // Bridge
      inner += `<line x1="${lEyeX + sgR}" y1="${sgY}" x2="${rEyeX - sgR}" y2="${sgY}" stroke="hsl(${bgHue},40%,35%)" stroke-width="1.2"/>`;
      // Lens shine
      inner += `<line x1="${lEyeX - sgR * 0.4}" y1="${sgY - sgR * 0.4}" x2="${lEyeX - sgR * 0.1}" y2="${sgY - sgR * 0.55}" stroke="white" stroke-width="0.9" opacity="0.5"/>`;
      inner += `<line x1="${rEyeX - sgR * 0.4}" y1="${sgY - sgR * 0.4}" x2="${rEyeX - sgR * 0.1}" y2="${sgY - sgR * 0.55}" stroke="white" stroke-width="0.9" opacity="0.5"/>`;
    } else {
      // Small party hat on top of head
      const hatBX = cx - frx * 0.35;
      const hatBW = frx * 0.70;
      const hatTX = cx;
      const hatTY = cy - fry - earH * 0.4;
      const hatBY = cy - fry * 0.4;
      inner += `<polygon points="${hatBX},${hatBY} ${hatBX + hatBW},${hatBY} ${hatTX},${hatTY}" fill="hsl(${(bgHue + 60) % 360},80%,55%)"/>`;
      // Hat stripe
      inner += `<line x1="${hatBX + hatBW * 0.3}" y1="${hatBY - (hatBY - hatTY) * 0.35}" x2="${hatBX + hatBW * 0.7}" y2="${hatBY - (hatBY - hatTY) * 0.35}" stroke="white" stroke-width="1" opacity="0.6"/>`;
      // Pompom
      inner += `<circle cx="${hatTX}" cy="${hatTY}" r="2.8" fill="hsl(50,100%,80%)"/>`;
    }
  }

  // ── Legendary: crown ─────────────────────────────────────────────────────
  if (tier === 5) {
    const crownBaseY = cy - fry * 0.90;
    const crownW     = frx * 1.0;
    const crownH     = fry * 0.55;
    const cBL = cx - crownW * 0.5;
    const cBR = cx + crownW * 0.5;
    // Crown body
    inner += `<polygon points="${cBL},${crownBaseY} ${cBL},${crownBaseY - crownH * 0.55} ${cx - crownW * 0.22},${crownBaseY - crownH * 0.9} ${cx},${crownBaseY - crownH * 0.55} ${cx + crownW * 0.22},${crownBaseY - crownH * 0.9} ${cBR},${crownBaseY - crownH * 0.55} ${cBR},${crownBaseY}" fill="hsl(45,95%,52%)"/>`;
    // Crown jewels
    inner += `<circle cx="${cx}" cy="${crownBaseY - crownH * 0.38}" r="2.2" fill="hsl(355,90%,55%)"/>`;
    inner += `<circle cx="${cx - crownW * 0.28}" cy="${crownBaseY - crownH * 0.22}" r="1.5" fill="hsl(210,90%,60%)"/>`;
    inner += `<circle cx="${cx + crownW * 0.28}" cy="${crownBaseY - crownH * 0.22}" r="1.5" fill="hsl(130,70%,50%)"/>`;
    // Crown outline
    inner += `<polygon points="${cBL},${crownBaseY} ${cBL},${crownBaseY - crownH * 0.55} ${cx - crownW * 0.22},${crownBaseY - crownH * 0.9} ${cx},${crownBaseY - crownH * 0.55} ${cx + crownW * 0.22},${crownBaseY - crownH * 0.9} ${cBR},${crownBaseY - crownH * 0.55} ${cBR},${crownBaseY}" fill="none" stroke="hsl(40,80%,38%)" stroke-width="0.8"/>`;
  }

  // ── Token ID label ────────────────────────────────────────────────────────
  inner += `<text x="${cx}" y="${size - 3}" text-anchor="middle" font-size="6.5" fill="hsl(${bgHue},30%,65%)" font-family="monospace">#${tid}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${defs}${inner}</svg>`;
}

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

// ── NFTPanel ──────────────────────────────────────────────────────────────────

export class NFTPanel {
  private container:      HTMLElement;
  private ws:             WSClient;
  private contractId:     string | null = null;
  private pollTimer:      ReturnType<typeof setInterval> | null = null;
  private playerAddress:  string | null = null;
  private sales:          SaleRecord[] = [];
  private collectionName: string = "NFT Collection";
  /** When set, clicking a sale tx opens the block explorer to that transaction. */
  private onOpenExplorerTx: ((txHash: string) => void) | null = null;

  // Sub-panels
  private gridEl:   HTMLElement;
  private ownedEl:  HTMLElement;
  private salesEl:  HTMLElement;
  private detailEl: HTMLElement;

  // Selected token for detail view
  private selectedTokenId: string | null = null;

  /** Token ids the user clicked Buy on; flushed as one `nft_buy` batch after debounce. */
  private _buyQueued = new Set<number>();
  private _buyDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  /** True after a batch is sent until `nft_buy_ok` or `NFT_ERROR`. */
  private _purchaseInFlight = false;
  private _buyStatusEl!: HTMLElement;
  private readonly _buyDebounceMs = 200;

  constructor(container: HTMLElement, ws: WSClient) {
    this.container = container;
    this.ws        = ws;

    container.className = "nft-tab-panel";
    container.innerHTML = `
      <div class="nft-mp-topbar">
        <span class="nft-stat-item">
          <span class="nft-stat-label">COLLECTION</span>
          <span class="nft-stat-val" id="nft-stat-name">—</span>
        </span>
        <span class="nft-stat-item">
          <span class="nft-stat-label">FLOOR</span>
          <span class="nft-stat-val" id="nft-stat-floor">—</span>
        </span>
        <span class="nft-stat-item">
          <span class="nft-stat-label">LISTED</span>
          <span class="nft-stat-val" id="nft-stat-listed">—</span>
        </span>
        <span class="nft-stat-item">
          <span class="nft-stat-label">VOLUME</span>
          <span class="nft-stat-val" id="nft-stat-volume">—</span>
        </span>
      </div>
      <div class="nft-buy-status" id="nft-buy-status" role="status" aria-live="polite"></div>
      <div class="nft-mp-body">
        <div class="nft-mp-main">
          <div class="nft-mp-section-title">MARKETPLACE</div>
          <div class="nft-grid" id="nft-grid">
            <div class="nft-empty">No active challenge</div>
          </div>
          <div class="nft-mp-section-title" style="margin-top:16px">YOUR NFTs</div>
          <div class="nft-owned-grid" id="nft-owned-grid">
            <div class="nft-empty">—</div>
          </div>
          <div class="nft-mp-section-title" style="margin-top:16px">RECENT SALES</div>
          <div class="nft-sales-table" id="nft-sales-table">
            <div class="nft-empty">No sales yet</div>
          </div>
        </div>
        <div class="nft-mp-detail" id="nft-detail" style="display:none">
          <button class="nft-detail-close" id="nft-detail-close">✕</button>
          <div class="nft-detail-content" id="nft-detail-content"></div>
        </div>
      </div>
    `;

    this.gridEl       = container.querySelector("#nft-grid")!;
    this.ownedEl      = container.querySelector("#nft-owned-grid")!;
    this.salesEl      = container.querySelector("#nft-sales-table")!;
    this.detailEl     = container.querySelector("#nft-detail")!;
    this._buyStatusEl = container.querySelector("#nft-buy-status")!;

    container.querySelector("#nft-detail-close")!.addEventListener("click", () => {
      this.selectedTokenId = null;
      this.detailEl.style.display = "none";
    });

    // Fetch player address
    fetch("/api/connection_info")
      .then(r => r.json())
      .then((info: { player?: { address: string } }) => {
        if (info?.player?.address) this.playerAddress = info.player.address;
      })
      .catch(() => {});

    // WS events
    ws.on("challenge", (raw) => {
      const s = raw as ChallengePayload;
      if (s.status === "idle") {
        this._stopPolling();
        this.contractId = null;  // clear after stopping so in-flight fetches bail out
        this._resetBuyUiState();
        this._clearPanel();
        this.sales = [];
      }
    });

    ws.on("nft_update", (raw) => {
      const p = raw as { contractId: string; listings: NftListing[] };
      if (p.contractId === this.contractId) {
        this._renderGrid(p.listings);
        this._fetchOwned();
        this._updateStats(p.listings);
      }
    });

    ws.on("nft_buy_ok", () => {
      this._onNftBuyFinished();
      void this._fetchSalesFromApi();
      // Refresh owned NFTs immediately so the newly-purchased token appears
      void this._fetchOwned();
    });

    ws.on("error", (raw) => {
      const p = raw as { code?: string; message?: string };
      if (p?.code === "NFT_ERROR" && this._purchaseInFlight) {
        this._onNftBuyFailed(p.message);
      }
    });

    ws.on("nft_panel_init", (raw) => {
      const p = raw as { contractId: string };
      this._initForContract(p.contractId);
    });
  }

  /** Called by main.ts when the challenge has an NFT marketplace. */
  initForContract(contractId: string): void {
    this.sales = [];
    this._initForContract(contractId);
  }

  /** Wire the Block explorer tab so sale rows can jump to a transaction. */
  setOpenExplorerTx(handler: (txHash: string) => void): void {
    this.onOpenExplorerTx = handler;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _initForContract(contractId: string): void {
    this._resetBuyUiState();
    this.contractId = contractId;
    this._stopPolling();
    const initCid = contractId;
    void (async () => {
      // Owned NFTs query needs the player address.  connection_info is also
      // fetched in the constructor, but that race often loses to the first
      // _fetchOwned() here — leaving YOUR NFTs empty until the next poll.
      if (this.contractId !== initCid) return;
      if (!this.playerAddress) {
        try {
          const r = await fetch("/api/connection_info");
          if (r.ok) {
            const info = await r.json() as { player?: { address: string } };
            if (info?.player?.address) this.playerAddress = info.player.address;
          }
        } catch { /* ignore */ }
      }
      if (this.contractId !== initCid) return;
      await this._fetchAll();
      await this._fetchSalesFromApi();
      if (this.contractId !== initCid) return;
      if (this.pollTimer !== null) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
      this.pollTimer = setInterval(() => {
        if (this.contractId !== initCid) return;
        void this._fetchAll();
        void this._fetchSalesFromApi();
      }, 4000);
    })();
  }

  private _queueBuy(tokenId: number): void {
    if (!this.contractId) return;
    if (this._purchaseInFlight) {
      this._buyStatusEl.textContent = "Purchase still confirming — please wait…";
      return;
    }
    this._buyQueued.add(tokenId);
    const n = this._buyQueued.size;
    this._buyStatusEl.textContent =
      n === 1
        ? "Queued 1 NFT — preparing purchase (WETH wrap, approve, buy). Sending shortly…"
        : `Queued ${n} NFTs — batching your purchases. Sending shortly…`;
    if (this._buyDebounceTimer !== null) clearTimeout(this._buyDebounceTimer);
    this._buyDebounceTimer = setTimeout(() => this._flushBuyBatch(), this._buyDebounceMs);
  }

  private _flushBuyBatch(): void {
    this._buyDebounceTimer = null;
    if (!this.contractId || this._buyQueued.size === 0) return;
    if (this._purchaseInFlight) return;
    const ids = [...this._buyQueued];
    this._buyQueued.clear();
    this._purchaseInFlight = true;
    this._syncBuyButtonsDisabled();
    const n = ids.length;
    this._buyStatusEl.textContent =
      n === 1
        ? "Buying 1 NFT on-chain — this can take several seconds…"
        : `Buying ${n} NFTs on-chain (wrap / approve / ${n} buys) — please wait…`;
    this.ws.send("nft_buy", { contractId: this.contractId, tokenIds: ids });
  }

  private _onNftBuyFinished(): void {
    this._purchaseInFlight = false;
    this._buyQueued.clear();
    this._buyStatusEl.textContent = "";
    this._syncBuyButtonsDisabled();
  }

  private _onNftBuyFailed(message?: string): void {
    this._purchaseInFlight = false;
    this._buyQueued.clear();
    const m = message?.trim() || "Unknown error";
    this._buyStatusEl.textContent = `Purchase failed: ${m}`;
    this._syncBuyButtonsDisabled();
    window.setTimeout(() => {
      if (!this._purchaseInFlight && this._buyQueued.size === 0) {
        this._buyStatusEl.textContent = "";
      }
    }, 8000);
  }

  private _syncBuyButtonsDisabled(): void {
    const dis = this._purchaseInFlight;
    this.container.querySelectorAll<HTMLButtonElement>(".btn-nft-buy").forEach((b) => {
      b.disabled = dis;
    });
  }

  private _resetBuyUiState(): void {
    if (this._buyDebounceTimer !== null) {
      clearTimeout(this._buyDebounceTimer);
      this._buyDebounceTimer = null;
    }
    this._buyQueued.clear();
    this._purchaseInFlight = false;
    if (this._buyStatusEl) this._buyStatusEl.textContent = "";
    this._syncBuyButtonsDisabled();
  }

  private _stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    // NOTE: do NOT null contractId here — _initForContract sets contractId before
    // calling _stopPolling (to cancel a previous interval), and nulling it here
    // would wipe the newly-assigned value, causing _fetchAll / _fetchListings to
    // bail out immediately with no data loaded.
  }

  private _clearPanel(): void {
    this.gridEl.innerHTML  = '<div class="nft-empty">No active challenge</div>';
    this.ownedEl.innerHTML = '<div class="nft-empty">—</div>';
    this.salesEl.innerHTML = '<div class="nft-empty">No sales yet</div>';
    const floorEl = this.container.querySelector<HTMLElement>("#nft-stat-floor");
    if (floorEl) floorEl.textContent = "—";
    const listEl = this.container.querySelector<HTMLElement>("#nft-stat-listed");
    if (listEl) listEl.textContent = "—";
    const volEl = this.container.querySelector<HTMLElement>("#nft-stat-volume");
    if (volEl) volEl.textContent = "—";
    const nameEl = this.container.querySelector<HTMLElement>("#nft-stat-name");
    if (nameEl) nameEl.textContent = "—";
    this.selectedTokenId = null;
    this.detailEl.style.display = "none";
  }

  private async _fetchAll(): Promise<void> {
    await Promise.all([this._fetchListings(), this._fetchOwned()]);
  }

  private async _fetchSalesFromApi(): Promise<void> {
    if (!this.contractId) return;
    try {
      const res = await fetch(`/api/nft/${this.contractId}/sales`);
      if (res.ok) {
        const data = await res.json() as SaleRecord[];
        this.sales = Array.isArray(data) ? data : [];
        this._renderSales();
      }
    } catch { /* silent */ }
  }

  private async _fetchListings(): Promise<void> {
    if (!this.contractId) return;
    try {
      const [listingsRes, floorRes] = await Promise.all([
        fetch(`/api/nft/${this.contractId}/listings`),
        fetch(`/api/nft/${this.contractId}/floor`),
      ]);
      const listings: NftListing[] = await listingsRes.json();
      const floor: { floorPrice: string; tokenId: string } | null = await floorRes.json();

      const floorEl = this.container.querySelector<HTMLElement>("#nft-stat-floor");
      if (floorEl) {
        floorEl.textContent = floor
          ? `${parseFloat(floor.floorPrice).toFixed(4)} Ξ`
          : "no listings";
      }

      this._updateStats(listings);
      this._renderGrid(listings);
    } catch { /* silent */ }
  }

  private async _fetchOwned(): Promise<void> {
    if (!this.contractId || !this.playerAddress) return;
    try {
      const res = await fetch(`/api/nft/${this.contractId}/owned?address=${this.playerAddress}`);
      const owned: OwnedNft[] = await res.json();
      this._renderOwnedGrid(owned);
    } catch { /* silent */ }
  }

  private _updateStats(listings: NftListing[]): void {
    const listEl = this.container.querySelector<HTMLElement>("#nft-stat-listed");
    const volEl  = this.container.querySelector<HTMLElement>("#nft-stat-volume");
    const nameEl = this.container.querySelector<HTMLElement>("#nft-stat-name");

    if (listEl) listEl.textContent = String(listings.length);

    const vol = this.sales.reduce((sum, s) => sum + parseFloat(s.price || "0"), 0);
    if (volEl) volEl.textContent = vol > 0 ? `${vol.toFixed(3)} Ξ` : "0 Ξ";

    if (nameEl) nameEl.textContent = this.collectionName;
  }

  // ── Render: marketplace grid ───────────────────────────────────────────────

  private _renderGrid(listings: NftListing[]): void {
    if (listings.length === 0) {
      this.gridEl.innerHTML = '<div class="nft-empty">No active listings</div>';
      return;
    }

    const sorted = listings.slice().sort((a, b) => parseFloat(a.price) - parseFloat(b.price));

    this.gridEl.innerHTML = sorted.map(l => {
      const tier = rarityTier(l.rarityScore);
      const svg  = generateNftSvg(l.tokenId, l.rarityScore);
      const img  = svgToDataUrl(svg);
      const isSel = this.selectedTokenId === l.tokenId;
      return `
        <div class="nft-card${isSel ? " nft-card-selected" : ""}" data-token="${l.tokenId}">
          <img class="nft-card-img" src="${img}" alt="NFT #${l.tokenId}" width="80" height="80">
          <div class="nft-card-body">
            <div class="nft-card-id">#${l.tokenId}</div>
            <div class="nft-card-badge ${tier.cls}">${tier.label}</div>
            <div class="nft-card-price">${parseFloat(l.price).toFixed(4)} Ξ</div>
            <button class="btn-nft-buy" data-token="${l.tokenId}">Buy</button>
          </div>
        </div>
      `;
    }).join("");

    // Card click — open detail sidebar
    this.gridEl.querySelectorAll<HTMLElement>(".nft-card").forEach(card => {
      card.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest(".btn-nft-buy")) return;
        const tokenId = card.dataset.token!;
        const listing = listings.find(l => l.tokenId === tokenId);
        if (listing) this._showDetail(listing, null);
      });
    });

    // Buy button — debounced batch (see _queueBuy)
    this.gridEl.querySelectorAll<HTMLButtonElement>(".btn-nft-buy").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!this.contractId) return;
        const tokenId = parseInt(btn.dataset.token!, 10);
        if (Number.isNaN(tokenId)) return;
        this._queueBuy(tokenId);
      });
    });
    this._syncBuyButtonsDisabled();
  }

  // ── Render: owned grid ─────────────────────────────────────────────────────

  private _renderOwnedGrid(owned: OwnedNft[]): void {
    if (owned.length === 0) {
      this.ownedEl.innerHTML = '<div class="nft-empty">You own no NFTs</div>';
      return;
    }

    this.ownedEl.innerHTML = owned.map(n => {
      const tier = rarityTier(n.rarityScore);
      const svg  = generateNftSvg(n.tokenId, n.rarityScore, 64);
      const img  = svgToDataUrl(svg);
      return `
        <div class="nft-card nft-card-owned" data-token="${n.tokenId}">
          <img class="nft-card-img" src="${img}" alt="NFT #${n.tokenId}" width="64" height="64">
          <div class="nft-card-body">
            <div class="nft-card-id">#${n.tokenId}</div>
            <div class="nft-card-badge ${tier.cls}">${tier.label}</div>
            <button class="btn-nft-list" data-token="${n.tokenId}">List</button>
          </div>
        </div>
      `;
    }).join("");

    this.ownedEl.querySelectorAll<HTMLElement>(".nft-card-owned").forEach(card => {
      card.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest(".btn-nft-list")) return;
        const tokenId = card.dataset.token!;
        const nft = owned.find(n => n.tokenId === tokenId);
        if (nft) this._showDetail(null, nft);
      });
    });

    this.ownedEl.querySelectorAll<HTMLButtonElement>(".btn-nft-list").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this._showListForm(btn.dataset.token!, btn);
      });
    });
  }

  // ── Render: sales table ────────────────────────────────────────────────────

  private _renderSales(): void {
    if (this.sales.length === 0) {
      this.salesEl.innerHTML = '<div class="nft-empty">No sales yet</div>';
      return;
    }

    this.salesEl.innerHTML = `
      <div class="nft-sales-scroll">
        <div class="nft-sales-header">
          <span>NFT</span>
          <span>Amount</span>
          <span>From → To</span>
          <span>Block</span>
          <span>Tx</span>
        </div>
        ${this.sales.map(s => {
          const ago = this._timeAgo(s.timestamp);
          const fromL = s.sellerLabel ?? s.seller;
          const toL   = s.buyerLabel ?? s.buyer;
          const tx    = s.txHash || "";
          const txShort = tx.length > 14 ? `${tx.slice(0, 8)}\u2026${tx.slice(-6)}` : (tx || "—");
          const blk   = s.blockNumber != null ? String(s.blockNumber) : "—";
          return `
          <div class="nft-sales-row" data-tx-hash="${tx}">
            <span class="nft-sales-id" title="Token #${s.tokenId}">#${s.tokenId}</span>
            <span class="nft-sales-price">${parseFloat(s.price || "0").toFixed(4)} Ξ</span>
            <span class="nft-sales-parties" title="${s.seller} → ${s.buyer}">${fromL} → ${toL}</span>
            <span class="nft-sales-block">${blk}</span>
            <span class="nft-sales-txcell">
              ${tx
          ? `<button type="button" class="nft-sales-txlink" data-tx="${tx}" title="${tx}">${txShort}</button>`
          : `<span class="nft-sales-time">${ago}</span>`}
            </span>
          </div>`;
        }).join("")}
      </div>
    `;

    this.salesEl.querySelectorAll<HTMLButtonElement>(".nft-sales-txlink").forEach(btn => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        const h = btn.dataset.tx;
        if (h && this.onOpenExplorerTx) this.onOpenExplorerTx(h);
      });
    });
  }

  // ── Detail sidebar ─────────────────────────────────────────────────────────

  private _showDetail(listing: NftListing | null, owned: OwnedNft | null): void {
    const nft = listing ?? owned!;
    this.selectedTokenId = nft.tokenId;

    const tier = rarityTier(nft.rarityScore);
    const svg  = generateNftSvg(nft.tokenId, nft.rarityScore, 120);
    const img  = svgToDataUrl(svg);
    const tokenSales = this.sales.filter(s => s.tokenId === nft.tokenId);

    const content = this.container.querySelector<HTMLElement>("#nft-detail-content")!;
    content.innerHTML = `
      <img src="${img}" alt="NFT #${nft.tokenId}" class="nft-detail-img">
      <div class="nft-detail-id">NFT #${nft.tokenId}</div>
      <div class="nft-detail-badge ${tier.cls}">${tier.label}</div>
      <div class="nft-detail-score">Rarity: <strong>${nft.rarityScore || "Hidden"}</strong> / 100</div>
      ${listing ? `
        <div class="nft-detail-price">Price: <strong>${parseFloat(listing.price).toFixed(4)} Ξ</strong></div>
        <div class="nft-detail-seller">Seller: <span class="nft-addr">${listing.seller.slice(0, 8)}\u2026${listing.seller.slice(-6)}</span></div>
        <button class="btn-nft-buy nft-detail-buy" data-token="${listing.tokenId}">
          Buy ${parseFloat(listing.price).toFixed(4)} Ξ
        </button>
      ` : ""}
      ${owned ? `
        <div class="nft-detail-price">You own this NFT</div>
        <button class="btn-nft-list nft-detail-list" data-token="${owned.tokenId}">List for Sale</button>
      ` : ""}
      <div class="nft-detail-history-title">Sale History</div>
      ${tokenSales.length > 0
        ? tokenSales.slice(0, 5).map(s => `
            <div class="nft-detail-sale-row">
              <span>${parseFloat(s.price).toFixed(4)} Ξ</span>
              <span class="nft-sales-time">${this._timeAgo(s.timestamp)}</span>
            </div>
          `).join("")
        : '<div class="nft-empty" style="margin:4px 0">No sales</div>'
      }
    `;

    this.detailEl.style.display = "flex";

    const buyBtn = content.querySelector<HTMLButtonElement>(".nft-detail-buy");
    if (buyBtn) {
      buyBtn.addEventListener("click", () => {
        if (!this.contractId) return;
        const tokenId = parseInt(buyBtn.dataset.token!, 10);
        if (Number.isNaN(tokenId)) return;
        this._queueBuy(tokenId);
      });
    }
    this._syncBuyButtonsDisabled();

    const listBtn = content.querySelector<HTMLButtonElement>(".nft-detail-list");
    if (listBtn) {
      this._showListForm(listBtn.dataset.token!, listBtn);
    }
  }

  // ── List form ──────────────────────────────────────────────────────────────

  private _showListForm(tokenId: string, anchorBtn: HTMLElement): void {
    // Remove any existing form
    const existing = this.container.querySelector<HTMLElement>(".nft-list-form");
    if (existing) existing.remove();

    const form = document.createElement("div");
    form.className = "nft-list-form";
    form.innerHTML = `
      <input type="number" class="nft-price-input" placeholder="Price in WETH" step="0.01" min="0.001" />
      <button class="btn-nft-confirm">List</button>
      <button class="btn-nft-cancel">&#x2715;</button>
    `;
    anchorBtn.parentElement!.insertAdjacentElement("afterend", form);

    form.querySelector<HTMLButtonElement>(".btn-nft-confirm")!.addEventListener("click", () => {
      const input = form.querySelector<HTMLInputElement>(".nft-price-input")!;
      const price = parseFloat(input.value);
      if (!price || price <= 0) { input.focus(); return; }
      if (!this.contractId) return;
      this.ws.send("nft_list", {
        contractId: this.contractId,
        tokenId:    parseInt(tokenId),
        price:      price.toString(),
      });
      form.remove();
    });

    form.querySelector<HTMLButtonElement>(".btn-nft-cancel")!.addEventListener("click", () => {
      form.remove();
    });

    form.querySelector<HTMLInputElement>(".nft-price-input")?.focus();
  }

  // ── Utilities ──────────────────────────────────────────────────────────────

  private _timeAgo(ts: number): string {
    const seconds = Math.floor((Date.now() - ts) / 1000);
    if (seconds < 60)  return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60)  return `${minutes}m ago`;
    return `${Math.floor(minutes / 60)}h ago`;
  }
}
