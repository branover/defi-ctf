import type { WSClient } from "../ws/WSClient.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ExplorerTx {
  hash:        string;
  from:        string;
  to:          string | null;
  value:       string;   // wei as string
  input:       string;   // hex calldata
  gasUsed:     string;
  blockNumber: number;
  /** Decoded human-readable label, if available */
  decoded?:    string;
}

export interface ExplorerBlock {
  number:       number;
  timestamp:    number;
  hash:         string;
  transactions: ExplorerTx[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Compute the display label for a block given a challenge start block.
 *  - If challengeStartBlock is not set (-1): show the raw number.
 *  - If blockNumber < challengeStartBlock: label as "Setup".
 *  - Otherwise: show relative number (1-based) from challenge start.
 */
function blockDisplayLabel(blockNumber: number, challengeStartBlock: number): string {
  if (challengeStartBlock < 0) return `#${blockNumber}`;
  if (blockNumber < challengeStartBlock) return "Setup";
  return `#${blockNumber - challengeStartBlock + 1}`;
}

/** Full title/tooltip text for a block. */
function blockTitleLabel(blockNumber: number, challengeStartBlock: number): string {
  if (challengeStartBlock < 0) return `Block #${blockNumber}`;
  if (blockNumber < challengeStartBlock) return `Setup Block #${blockNumber}`;
  const rel = blockNumber - challengeStartBlock + 1;
  return `Challenge Block #${rel} (chain: ${blockNumber})`;
}

/** Truncate a hex string (hash / address) to 0x1234…abcd format. */
function truncate(hex: string, leadChars = 6, trailChars = 4): string {
  if (!hex || hex.length <= leadChars + trailChars + 2) return hex;
  return `${hex.slice(0, leadChars + 2)}…${hex.slice(-trailChars)}`;
}

/** Format wei to human-readable ETH string (4–6 decimal places). */
function fmtEth(wei: string): string {
  try {
    const n = parseFloat(wei);
    if (isNaN(n)) return "0 ETH";
    const eth = n / 1e18;
    if (eth === 0) return "0 ETH";
    if (eth >= 1000) return `${eth.toFixed(0)} ETH`;
    if (eth >= 1)    return `${eth.toFixed(4)} ETH`;
    if (eth >= 0.001) return `${eth.toFixed(6)} ETH`;
    return `${eth.toExponential(3)} ETH`;
  } catch {
    return "? ETH";
  }
}

/** Format a unix timestamp as a short local time string. */
function fmtTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Sum gas used across all txs in a block. */
function totalGas(block: ExplorerBlock): number {
  return block.transactions.reduce((acc, t) => acc + Number(t.gasUsed), 0);
}

/** Escape HTML to safely insert user data into innerHTML. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── BlockExplorerPanel ─────────────────────────────────────────────────────────

/**
 * BlockExplorerPanel — full-tab blockchain explorer.
 *
 * Three-pane layout:
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  [search/filter bar]                              [my txs ⬛] │
 *   ├────────────────┬─────────────────────────────────────────────┤
 *   │  Block list    │  Tx list for selected block                  │
 *   │  (30%)         ├─────────────────────────────────────────────┤
 *   │                │  Tx detail for selected tx                   │
 *   └────────────────┴─────────────────────────────────────────────┘
 *
 * WS protocol:
 *   send:    { type: "get_blocks", payload: { from, limit } }
 *   receive: { type: "blocks_result", payload: { blocks: ExplorerBlock[] } }
 *   receive: { type: "block", payload: { blockNumber, timestamp, ... } }
 *            → triggers incremental fetch of that single block
 */
export class BlockExplorerPanel {
  private container: HTMLElement;
  private ws: WSClient;

  /** All blocks received since last challenge start, newest-first. */
  private blocks: ExplorerBlock[] = [];
  /** Player address (set from challenge / connection state). */
  private playerAddress = "";
  /** Whether "my transactions only" filter is active. */
  private filterMine = false;
  /** Currently selected block number (-1 = none). */
  private selectedBlock = -1;
  /** Currently selected tx hash. */
  private selectedTxHash = "";
  /** Search text for address / method filter. */
  private searchText = "";
  /** Pending single-block fetches to avoid duplicate requests. */
  private _pendingFetch = new Set<number>();
  /** Block numbers already present as DOM rows (used for incremental rendering). */
  private _renderedBlockNumbers = new Set<number>();
  /** ID of the currently-running challenge — used to detect a new challenge vs. a periodic status update. */
  private _activeChallengeId = "";
  /** Address book: lowercase address → human-readable name. */
  private addressBook = new Map<string, string>();
  /** First block number of the challenge mining phase (-1 = not set). */
  private challengeStartBlock = -1;
  /** Value of challengeStartBlock used when block rows were last rendered (for label refresh). */
  private _renderedChallengeStartBlock = -1;

  // DOM refs
  private filterMineBtn!:   HTMLButtonElement;
  private searchInput!:     HTMLInputElement;
  private blockListEl!:     HTMLElement;
  private txListEl!:        HTMLElement;
  private txDetailEl!:      HTMLElement;
  private blockEmptyEl!:    HTMLElement;
  private txEmptyEl!:       HTMLElement;
  private pauseBtn!:        HTMLButtonElement;
  private _paused = false;

  constructor(container: HTMLElement, ws: WSClient) {
    this.container = container;
    this.ws = ws;
    this._render();
    this._bindWS();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Called when a challenge starts/stops — resets state and optionally fetches history. */
  reset(playerAddress?: string) {
    this.blocks = [];
    this.selectedBlock = -1;
    this.selectedTxHash = "";
    this.searchText = "";
    this.filterMine = false;
    this._pendingFetch.clear();
    this._renderedBlockNumbers.clear();
    this.addressBook.clear();
    this.challengeStartBlock = -1;
    this._renderedChallengeStartBlock = -1;
    this._activeChallengeId = "";
    this._paused = false;
    if (playerAddress) this.playerAddress = playerAddress;
    // Sync UI controls
    this.searchInput.value = "";
    this.filterMineBtn.classList.remove("be-mine-active");
    this.pauseBtn.style.display = "none";
    this.pauseBtn.textContent = "⏸ Pause";
    this.pauseBtn.classList.remove("be-pause-active");
    // Remove stale block rows so the list is clean for the next challenge
    this.blockListEl.querySelectorAll(".be-brow, [data-challenge-sep]").forEach(el => el.remove());
    this._renderBlockList();
    this._renderTxList();
    this._renderTxDetail(null);
  }

  /** Highlight a specific transaction (e.g. from ManualTradePanel click). */
  highlightTx(txHash: string) {
    this.selectedTxHash = txHash;
    for (const block of this.blocks) {
      const tx = block.transactions.find(t => t.hash.toLowerCase() === txHash.toLowerCase());
      if (tx) {
        this.selectedBlock = block.number;
        this._renderBlockList();
        this._renderTxList();
        this._renderTxDetail(tx);
        return;
      }
    }
    this._renderTxDetail(null);
  }

  // ── Private — render ───────────────────────────────────────────────────────

  private _render() {
    this.container.innerHTML = `
      <div class="be-tab-layout">
        <div class="be-toolbar">
          <span class="be-toolbar-title">BLOCK EXPLORER</span>
          <div class="be-search-wrap">
            <input
              class="be-search-input"
              type="text"
              placeholder="Filter by address or method…"
              id="be-search"
              autocomplete="off"
              spellcheck="false"
            />
          </div>
          <button class="be-mine-toggle chart-btn" id="be-mine-toggle" title="Show only my transactions">
            ★ My Txs
          </button>
          <button class="be-refresh-btn chart-btn" id="be-refresh" title="Reload blocks from chain">↻</button>
          <button class="be-pause-btn chart-btn" id="be-pause-btn" title="Pause/resume mining" style="display:none">⏸ Pause</button>
        </div>
        <div class="be-three-pane">
          <div class="be-block-col">
            <div class="be-col-header">
              <span>Blocks</span>
            </div>
            <div class="be-block-list" id="be-block-list">
              <div class="be-empty" id="be-block-empty">Start a challenge to see blocks</div>
            </div>
          </div>
          <div class="be-right-col">
            <div class="be-tx-col">
              <div class="be-col-header" id="be-tx-col-header">
                <span>Transactions</span>
              </div>
              <div class="be-tx-list-pane" id="be-tx-list">
                <div class="be-empty" id="be-tx-empty">Select a block to view transactions</div>
              </div>
            </div>
            <div class="be-detail-col">
              <div class="be-col-header">
                <span>Transaction Detail</span>
                <button class="be-close-btn chart-btn" id="be-detail-close" style="display:none" title="Close">✕</button>
              </div>
              <div class="be-tx-detail-pane" id="be-tx-detail">
                <div class="be-empty">Select a transaction to view details</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.blockListEl   = this.container.querySelector<HTMLElement>("#be-block-list")!;
    this.txListEl      = this.container.querySelector<HTMLElement>("#be-tx-list")!;
    this.txDetailEl    = this.container.querySelector<HTMLElement>("#be-tx-detail")!;
    this.blockEmptyEl  = this.container.querySelector<HTMLElement>("#be-block-empty")!;
    this.txEmptyEl     = this.container.querySelector<HTMLElement>("#be-tx-empty")!;
    this.filterMineBtn = this.container.querySelector<HTMLButtonElement>("#be-mine-toggle")!;
    this.searchInput   = this.container.querySelector<HTMLInputElement>("#be-search")!;

    this.filterMineBtn.addEventListener("click", () => {
      this.filterMine = !this.filterMine;
      this.filterMineBtn.classList.toggle("be-mine-active", this.filterMine);
      this._renderBlockList();
      this._renderTxList();
    });

    this.searchInput.addEventListener("input", () => {
      this.searchText = this.searchInput.value.trim().toLowerCase();
      this._renderBlockList();
      this._renderTxList();
    });

    this.container.querySelector<HTMLButtonElement>("#be-refresh")!.addEventListener("click", () => {
      this._fetchAllBlocks();
    });

    this.pauseBtn = this.container.querySelector<HTMLButtonElement>("#be-pause-btn")!;
    this.pauseBtn.addEventListener("click", () => {
      this._paused = !this._paused;
      this.ws.send("control", { action: this._paused ? "pause" : "resume" });
      this.pauseBtn.textContent = this._paused ? "▶ Resume" : "⏸ Pause";
      this.pauseBtn.classList.toggle("be-pause-active", this._paused);
    });

    this.container.querySelector<HTMLButtonElement>("#be-detail-close")!.addEventListener("click", () => {
      this.selectedTxHash = "";
      this._renderTxDetail(null);
    });
  }

  // ── Filtering ───────────────────────────────────────────────────────────────

  private _txMatchesFilter(tx: ExplorerTx): boolean {
    if (this.filterMine && !this._isMine(tx)) return false;
    if (this.searchText) {
      const s = this.searchText;
      const fromName    = this.addressBook.get(tx.from.toLowerCase()) ?? "";
      const toName      = this.addressBook.get((tx.to ?? "").toLowerCase()) ?? "";
      const matchFrom   = tx.from.toLowerCase().includes(s) || fromName.toLowerCase().includes(s);
      const matchTo     = (tx.to ?? "").toLowerCase().includes(s) || toName.toLowerCase().includes(s);
      const matchHash   = tx.hash.toLowerCase().includes(s);
      const matchMethod = (tx.decoded ?? "").toLowerCase().includes(s);
      if (!matchFrom && !matchTo && !matchHash && !matchMethod) return false;
    }
    return true;
  }

  private _blockPassesFilter(block: ExplorerBlock): boolean {
    if (!this.filterMine && !this.searchText) return true;
    return block.transactions.some(t => this._txMatchesFilter(t));
  }

  private _visibleBlocks(): ExplorerBlock[] {
    return this.blocks.filter(b => this._blockPassesFilter(b));
  }

  // ── Block list ──────────────────────────────────────────────────────────────

  private _renderBlockList() {
    const filterActive = this.filterMine || !!this.searchText;

    if (filterActive) {
      // Filter is active (user-triggered): full clear+rebuild is acceptable — no automatic flash concern
      this.blockListEl.querySelectorAll(".be-brow").forEach(el => el.remove());
      this.blockListEl.querySelectorAll("[data-challenge-sep]").forEach(el => el.remove());
      this._renderedBlockNumbers.clear();

      const visible = this._visibleBlocks();
      if (visible.length === 0) {
        this.blockEmptyEl.style.display = "block";
        return;
      }
      this.blockEmptyEl.style.display = "none";

      for (const block of visible) {
        const row = this._buildBlockRow(block);
        this.blockListEl.appendChild(row);
        this._renderedBlockNumbers.add(block.number);
      }
      this._renderedChallengeStartBlock = this.challengeStartBlock;
      this._syncChallengeSep();
      return;
    }

    // No filter: incremental update — only add rows for blocks not yet rendered
    const visible = this._visibleBlocks();
    if (visible.length === 0) {
      this.blockEmptyEl.style.display = "block";
      return;
    }
    this.blockEmptyEl.style.display = "none";

    // If challengeStartBlock changed since the last render pass, refresh labels on
    // all existing rendered rows so "Setup" vs "#N" labels stay correct (#131).
    const startBlockChanged = this.challengeStartBlock !== this._renderedChallengeStartBlock;

    // Separate already-rendered blocks (selection update only) from new ones
    const newBlocks: ExplorerBlock[] = [];
    for (const block of visible) {
      if (this._renderedBlockNumbers.has(block.number)) {
        // Already in DOM — update selection class without recreating the row
        const existingRow = this.blockListEl.querySelector<HTMLElement>(`.be-brow[data-block-number="${block.number}"]`);
        if (existingRow) {
          existingRow.classList.toggle("be-brow-selected", block.number === this.selectedBlock);
          // Refresh display label if challengeStartBlock changed
          if (startBlockChanged) {
            const numEl = existingRow.querySelector<HTMLElement>(".be-brow-num");
            if (numEl) numEl.textContent = blockDisplayLabel(block.number, this.challengeStartBlock);
            const titleLabel = blockTitleLabel(block.number, this.challengeStartBlock);
            existingRow.setAttribute("title", `${titleLabel} — hash: ${block.hash}`);
          }
        }
      } else {
        newBlocks.push(block);
      }
    }

    // Insert new blocks in oldest-first order so that each prepend correctly
    // places newer blocks above older ones (visible is newest-first, so we reverse).
    for (const block of newBlocks.slice().reverse()) {
      const row = this._buildBlockRow(block);
      const first = this.blockListEl.querySelector(".be-brow");
      this.blockListEl.insertBefore(row, first ?? this.blockEmptyEl.nextSibling ?? null);
      this._renderedBlockNumbers.add(block.number);
    }

    this._renderedChallengeStartBlock = this.challengeStartBlock;
    this._syncChallengeSep();
  }

  /** Create the challenge-start separator element. */
  private _buildChallengeSep(): HTMLElement {
    const sep = document.createElement("div");
    sep.className = "be-challenge-start-sep";
    sep.dataset.challengeSep = "1";
    sep.textContent = "Challenge starts here";
    return sep;
  }

  /** Insert (or move) the challenge-start separator after the row for challengeStartBlock.
   *  In a newest-first list this places the separator between block #1 and the setup blocks,
   *  so challenge blocks appear above the divider and setup blocks appear below it. */
  private _syncChallengeSep() {
    if (this.challengeStartBlock < 0) {
      this.blockListEl.querySelectorAll("[data-challenge-sep]").forEach(el => el.remove());
      return;
    }
    // Remove any existing separator
    this.blockListEl.querySelectorAll("[data-challenge-sep]").forEach(el => el.remove());
    // Find the row for the challenge start block (displayed as #1)
    const targetRow = this.blockListEl.querySelector<HTMLElement>(`.be-brow[data-block-number="${this.challengeStartBlock}"]`);
    if (targetRow) {
      const sep = this._buildChallengeSep();
      targetRow.after(sep);
    }
  }

  private _buildBlockRow(block: ExplorerBlock): HTMLElement {
    const txCount   = block.transactions.length;
    const myTxCount = block.transactions.filter(t => this._isMine(t)).length;
    const gas       = totalGas(block).toLocaleString();
    const isSelected = block.number === this.selectedBlock;
    const hasMine   = myTxCount > 0;
    const displayLabel = blockDisplayLabel(block.number, this.challengeStartBlock);
    const titleLabel   = blockTitleLabel(block.number, this.challengeStartBlock);

    const row = document.createElement("div");
    row.className = `be-brow${isSelected ? " be-brow-selected" : ""}${hasMine ? " be-brow-has-mine" : ""}`;
    row.dataset.blockNumber = String(block.number);
    row.setAttribute("title", `${titleLabel} — hash: ${block.hash}`);

    row.innerHTML = `
      <div class="be-brow-top">
        <span class="be-brow-num">${esc(displayLabel)}</span>
        <span class="be-brow-time">${fmtTime(block.timestamp)}</span>
        ${hasMine ? `<span class="be-brow-mine-star" title="Contains your transactions">★</span>` : ""}
      </div>
      <div class="be-brow-bottom">
        <span class="be-brow-txcount">${txCount} tx${txCount !== 1 ? "s" : ""}</span>
        <span class="be-brow-gas">⛽ ${gas}</span>
      </div>
    `;

    row.addEventListener("click", () => {
      this.selectedBlock = block.number;
      this.selectedTxHash = "";
      this.blockListEl.querySelectorAll(".be-brow").forEach(r => r.classList.remove("be-brow-selected"));
      row.classList.add("be-brow-selected");
      this._renderTxList();
      // Auto-select the first visible transaction in this block (#129)
      this._autoSelectFirstTx();
    });

    return row;
  }

  /** Auto-select the first transaction row in the tx list pane, if any.
   *  Clears the detail pane if the block has no visible transactions. */
  private _autoSelectFirstTx() {
    const firstRow = this.txListEl.querySelector<HTMLElement>(".be-txrow");
    if (firstRow) {
      firstRow.click();
    } else {
      // Empty block (or all txs filtered out) — clear the detail pane
      this._renderTxDetail(null);
    }
  }

  /**
   * Update a block row's mutable content in-place without replacing the element.
   * This prevents any DOM flash while still reflecting updated tx counts / gas (#130).
   */
  private _updateBlockRowInPlace(row: HTMLElement, block: ExplorerBlock) {
    const txCount   = block.transactions.length;
    const myTxCount = block.transactions.filter(t => this._isMine(t)).length;
    const gas       = totalGas(block).toLocaleString();
    const hasMine   = myTxCount > 0;
    const displayLabel = blockDisplayLabel(block.number, this.challengeStartBlock);
    const titleLabel   = blockTitleLabel(block.number, this.challengeStartBlock);

    // Toggle class without touching other classes
    row.classList.toggle("be-brow-has-mine", hasMine);
    row.setAttribute("title", `${titleLabel} — hash: ${block.hash}`);

    // Update block number label (may have changed if challengeStartBlock became known)
    const numEl = row.querySelector<HTMLElement>(".be-brow-num");
    if (numEl) numEl.textContent = displayLabel;

    // Update tx count
    const txCountEl = row.querySelector<HTMLElement>(".be-brow-txcount");
    if (txCountEl) txCountEl.textContent = `${txCount} tx${txCount !== 1 ? "s" : ""}`;

    // Update gas
    const gasEl = row.querySelector<HTMLElement>(".be-brow-gas");
    if (gasEl) gasEl.textContent = `⛽ ${gas}`;

    // Update mine star (add/remove as needed)
    const topEl = row.querySelector<HTMLElement>(".be-brow-top");
    if (topEl) {
      const existing = topEl.querySelector<HTMLElement>(".be-brow-mine-star");
      if (hasMine && !existing) {
        const star = document.createElement("span");
        star.className = "be-brow-mine-star";
        star.title = "Contains your transactions";
        star.textContent = "★";
        topEl.appendChild(star);
      } else if (!hasMine && existing) {
        existing.remove();
      }
    }
  }

  // ── Tx list ─────────────────────────────────────────────────────────────────

  private _renderTxList() {
    this.txListEl.querySelectorAll(".be-txrow").forEach(el => el.remove());

    const hdr = this.container.querySelector<HTMLElement>("#be-tx-col-header span")!;
    if (this.selectedBlock < 0) {
      this.txEmptyEl.textContent = "Select a block to view transactions";
      this.txEmptyEl.style.display = "block";
      hdr.textContent = "Transactions";
      return;
    }

    const block = this.blocks.find(b => b.number === this.selectedBlock);
    if (!block) {
      this.txEmptyEl.textContent = "Block not loaded";
      this.txEmptyEl.style.display = "block";
      hdr.textContent = "Transactions";
      return;
    }

    const txs = block.transactions.filter(t => this._txMatchesFilter(t));
    hdr.textContent = `Transactions — ${blockDisplayLabel(block.number, this.challengeStartBlock)} (${txs.length})`;

    if (txs.length === 0) {
      this.txEmptyEl.textContent = this.filterMine || this.searchText
        ? "No transactions match the current filter"
        : "No transactions in this block";
      this.txEmptyEl.style.display = "block";
      return;
    }

    this.txEmptyEl.style.display = "none";

    for (const tx of txs) {
      const row = this._buildTxRow(tx);
      this.txListEl.appendChild(row);
    }
  }

  private _buildTxRow(tx: ExplorerTx): HTMLElement {
    const isMine    = this._isMine(tx);
    const isSelected = tx.hash.toLowerCase() === this.selectedTxHash.toLowerCase();
    // Use decoded name, 4-byte selector, or generic "call"
    const methodFull   = tx.decoded
      || (tx.input && tx.input.length >= 10 ? tx.input.slice(0, 10) : null)
      || (tx.input === "0x" || !tx.input ? "transfer" : "call");
    // Truncate long decoded strings (with args) to fit in the tag; show full in title
    const METHOD_DISPLAY_LIMIT = 40;
    const methodDisplay = methodFull.length > METHOD_DISPLAY_LIMIT
      ? methodFull.slice(0, METHOD_DISPLAY_LIMIT - 1) + "\u2026"
      : methodFull;
    const fromResolved = this._resolveName(tx.from);
    const toResolved   = this._resolveName(tx.to);
    const ethVal       = fmtEth(tx.value);

    const row = document.createElement("div");
    row.className = `be-txrow${isMine ? " be-txrow-mine" : ""}${isSelected ? " be-txrow-selected" : ""}`;
    row.dataset.txHash = tx.hash;

    row.innerHTML = `
      <div class="be-txrow-top">
        <span class="be-txrow-hash be-mono" title="${esc(tx.hash)}">${truncate(tx.hash, 8, 6)}</span>
        <span class="be-txrow-method be-tag" title="${esc(methodFull)}">${esc(methodDisplay)}</span>
        <span class="be-txrow-val">${esc(ethVal)}</span>
      </div>
      <div class="be-txrow-bottom">
        <span class="be-txrow-addr${isMine ? " be-mine-addr" : ""}" title="${esc(tx.from)}">${esc(fromResolved.display)}</span>
        <span class="be-txrow-arrow">→</span>
        <span class="be-txrow-addr" title="${esc(tx.to ?? "(contract creation)")}">${esc(toResolved.display)}</span>
        <span class="be-txrow-gas">⛽ ${Number(tx.gasUsed).toLocaleString()}</span>
      </div>
    `;

    row.addEventListener("click", () => {
      this.selectedTxHash = tx.hash;
      this.txListEl.querySelectorAll(".be-txrow").forEach(r => r.classList.remove("be-txrow-selected"));
      row.classList.add("be-txrow-selected");
      this._renderTxDetail(tx);
    });

    return row;
  }

  // ── Tx detail ───────────────────────────────────────────────────────────────

  private _renderTxDetail(tx: ExplorerTx | null) {
    const closeBtn = this.container.querySelector<HTMLButtonElement>("#be-detail-close")!;

    if (!tx) {
      closeBtn.style.display = "none";
      this.txDetailEl.innerHTML = `<div class="be-empty">Select a transaction to view details</div>`;
      return;
    }

    closeBtn.style.display = "";
    const isMine       = this._isMine(tx);
    const fromResolved = this._resolveName(tx.from);
    const toResolved   = this._resolveName(tx.to);

    const decodedRow = tx.decoded
      ? `<div class="be-drow"><span class="be-dkey">method</span><span class="be-dval"><span class="be-tag">${esc(tx.decoded)}</span></span></div>`
      : "";

    const calldataContent = (tx.input && tx.input !== "0x")
      ? `<details class="be-calldata">
           <summary>calldata (${Math.floor((tx.input.length - 2) / 2)} bytes)</summary>
           <pre class="be-calldata-pre">${esc(tx.input)}</pre>
         </details>`
      : `<div class="be-drow"><span class="be-dkey">calldata</span><span class="be-dval be-muted">(empty)</span></div>`;

    this.txDetailEl.innerHTML = `
      <div class="be-detail-inner">
        <div class="be-drow">
          <span class="be-dkey">hash</span>
          <span class="be-dval be-mono be-copyable" data-copy="${esc(tx.hash)}" title="Click to copy">${esc(tx.hash)}</span>
        </div>
        <div class="be-drow">
          <span class="be-dkey">block</span>
          <span class="be-dval" title="${blockTitleLabel(tx.blockNumber, this.challengeStartBlock)}">${blockDisplayLabel(tx.blockNumber, this.challengeStartBlock)}</span>
        </div>
        <div class="be-drow">
          <span class="be-dkey">from</span>
          <span class="be-dval be-mono be-copyable${isMine ? " be-mine-addr" : ""}" data-copy="${esc(tx.from)}" title="${esc(tx.from)}">${esc(fromResolved.display)}</span>
        </div>
        <div class="be-drow">
          <span class="be-dkey">to</span>
          <span class="be-dval be-mono be-copyable" data-copy="${esc(tx.to ?? "")}" title="${esc(tx.to ?? "(contract creation)")}">${esc(toResolved.display)}</span>
        </div>
        <div class="be-drow">
          <span class="be-dkey">value</span>
          <span class="be-dval">${esc(fmtEth(tx.value))}</span>
        </div>
        <div class="be-drow">
          <span class="be-dkey">gas used</span>
          <span class="be-dval">${Number(tx.gasUsed).toLocaleString()}</span>
        </div>
        ${decodedRow}
        ${calldataContent}
      </div>
    `;

    // Wire up copy-on-click for addresses and hashes
    this.txDetailEl.querySelectorAll<HTMLElement>(".be-copyable").forEach(el => {
      el.style.cursor = "pointer";
      el.addEventListener("click", () => {
        const val = el.dataset.copy ?? el.textContent ?? "";
        navigator.clipboard.writeText(val).then(() => {
          const orig = el.textContent ?? "";
          el.textContent = "copied!";
          setTimeout(() => { el.textContent = orig; }, 800);
        }).catch(() => {});
      });
    });
  }

  // ── Private — data ─────────────────────────────────────────────────────────

  private _isMine(tx: ExplorerTx): boolean {
    if (!this.playerAddress) return false;
    return tx.from.toLowerCase() === this.playerAddress.toLowerCase();
  }

  private _resolveName(addr: string | null): { display: string; full: string } {
    if (!addr) return { display: "(deploy)", full: "" };
    const name = this.addressBook.get(addr.toLowerCase());
    if (name) {
      return { display: `${name} (${truncate(addr)})`, full: addr };
    }
    return { display: truncate(addr), full: addr };
  }

  /** Prepend a newly-arrived block to the list (newest-first). */
  private _prependBlock(block: ExplorerBlock) {
    const idx = this.blocks.findIndex(b => b.number === block.number);
    if (idx >= 0) {
      this.blocks[idx] = block;
      // Update the existing row in-place to avoid a DOM flash (#130).
      // Only mutate the fields that can change (tx count, gas, mine star, title).
      const existingRow = this.blockListEl.querySelector<HTMLElement>(`.be-brow[data-block-number="${block.number}"]`);
      if (existingRow) {
        this._updateBlockRowInPlace(existingRow, block);
      }
      // Refresh tx list if this block is selected
      if (this.selectedBlock === block.number) {
        this._renderTxList();
        // Re-render detail if tx is already selected
        if (this.selectedTxHash) {
          const tx = block.transactions.find(t => t.hash.toLowerCase() === this.selectedTxHash.toLowerCase());
          if (tx) this._renderTxDetail(tx);
        }
      }
      return;
    }

    this.blocks.unshift(block);
    this.blockEmptyEl.style.display = "none";

    if (this._blockPassesFilter(block)) {
      const row = this._buildBlockRow(block);
      const first = this.blockListEl.querySelector(".be-brow");
      this.blockListEl.insertBefore(row, first);
      this._renderedBlockNumbers.add(block.number);
      // Re-sync separator — the new block may be the challenge start block
      this._syncChallengeSep();
    }

    // If no block is selected yet and this block has player txs, auto-select it
    if (this.selectedBlock < 0 && block.transactions.some(t => this._isMine(t))) {
      this.selectedBlock = block.number;
      this.blockListEl.querySelectorAll(".be-brow").forEach(r => r.classList.remove("be-brow-selected"));
      const row = this.blockListEl.querySelector<HTMLElement>(`.be-brow[data-block-number="${block.number}"]`);
      row?.classList.add("be-brow-selected");

      // Auto-select player's tx or pre-set tx
      const preSelected = this.selectedTxHash
        ? block.transactions.find(t => t.hash.toLowerCase() === this.selectedTxHash.toLowerCase())
        : null;
      const myTx = block.transactions.find(t => this._isMine(t));
      const toShow = preSelected ?? myTx ?? null;
      if (toShow) {
        this.selectedTxHash = toShow.hash;
      }
      // Single render pass — tx list needs selectedTxHash set before rendering to mark correct row
      this._renderTxList();
      if (toShow) {
        this._renderTxDetail(toShow);
      }
    }
  }

  // ── Private — WS ──────────────────────────────────────────────────────────

  private _bindWS() {
    // Incremental: each new block event → fetch that block's full data
    this.ws.on("block", (raw) => {
      const b = raw as { blockNumber: number; timestamp: number };
      if (this._pendingFetch.has(b.blockNumber)) return;
      this._pendingFetch.add(b.blockNumber);
      this.ws.send("get_blocks", { from: b.blockNumber, limit: 1 });
    });

    // Batch results from get_blocks request
    this.ws.on("blocks_result", (raw) => {
      const { blocks } = raw as { blocks: ExplorerBlock[] };
      for (const block of blocks) {
        this._pendingFetch.delete(block.number);
        this._prependBlock(block);
      }
    });

    // Challenge start → reset explorer and fetch setup blocks
    this.ws.on("challenge", (raw) => {
      const s = raw as { status: string; id?: string; currentBlock?: number; addressBook?: Record<string, string>; challengeStartBlock?: number };
      // Update addressBook whenever we receive a challenge event with one
      if (s.addressBook) {
        this.addressBook.clear();
        for (const [addr, name] of Object.entries(s.addressBook)) {
          this.addressBook.set(addr.toLowerCase(), name);
        }
      }
      // Track the challenge start block for the boundary separator
      if (typeof s.challengeStartBlock === "number") {
        this.challengeStartBlock = s.challengeStartBlock;
      }
      if (s.status === "running") {
        // The engine broadcasts a "challenge" status update on every block (#137).
        // Only do a full reset + re-fetch when this is a *new* challenge (id changed),
        // not on every periodic status ping for the already-running challenge.
        const incomingId = s.id ?? "";
        const isNewChallenge = incomingId !== this._activeChallengeId;
        this._activeChallengeId = incomingId;

        if (isNewChallenge) {
          this.blocks = [];
          this.selectedBlock = -1;
          this.selectedTxHash = "";
          this.searchText = "";
          this.filterMine = false;
          this._pendingFetch.clear();
          this._renderedBlockNumbers.clear();
          this.challengeStartBlock = typeof s.challengeStartBlock === "number" ? s.challengeStartBlock : -1;
          this._renderedChallengeStartBlock = -1;
          this.searchInput.value = "";
          this.filterMineBtn.classList.remove("be-mine-active");
          this._paused = false;
          this.pauseBtn.style.display = "";
          this.pauseBtn.textContent = "⏸ Pause";
          this.pauseBtn.classList.remove("be-pause-active");
          // Remove stale block rows from the previous challenge before re-rendering
          this.blockListEl.querySelectorAll(".be-brow, [data-challenge-sep]").forEach(el => el.remove());
          this._renderBlockList();
          this._renderTxList();
          this._renderTxDetail(null);
          this._fetchAllBlocks();
        } else {
          // Existing challenge — just update the pause button visibility in case
          // the connection was re-established
          this.pauseBtn.style.display = "";
        }
      }
      if (s.status === "idle" || s.status === "won") {
        // Hide the pause button — mining has stopped.
        // Do NOT wipe the block list: the player should be able to review all
        // transactions including the winning one after the challenge ends (#217).
        // The explorer will be fully reset when the next challenge starts
        // (handled above via the isNewChallenge path in the "running" branch).
        this._paused = false;
        this.pauseBtn.style.display = "none";
        this.pauseBtn.textContent = "⏸ Pause";
        this.pauseBtn.classList.remove("be-pause-active");
        // Clear the active challenge ID so that if the player restarts the *same*
        // challenge (same manifest slug), the "running" handler will see it as a
        // new challenge and perform a full reset (#217).
        this._activeChallengeId = "";
        // If a client reconnects while the challenge is in "won" state (e.g. after a
        // page refresh), populate the explorer with the completed challenge's blocks so
        // the player can still inspect the winning transaction.
        if (s.status === "won" && this.blocks.length === 0) {
          const incomingId = s.id ?? "";
          if (incomingId) this._activeChallengeId = incomingId;
          this._fetchAllBlocks();
        }
      }
    });

    // Trade events → store hash for auto-select when block arrives
    this.ws.on("trade", (raw) => {
      const t = raw as { txHash: string; blockNumber: number };
      if (t.txHash && !this.selectedTxHash) {
        this.selectedTxHash = t.txHash;
      }
    });

    // Connection info (player address)
    this.ws.on("__connected", () => {
      this._fetchConnectionInfo();
    });
  }

  /** Fetch player address from the HTTP connection_info endpoint. */
  private _fetchConnectionInfo() {
    fetch("/api/connection_info")
      .then(r => r.ok ? r.json() : null)
      .then((info: { player?: { address: string } } | null) => {
        if (info?.player?.address) {
          this.playerAddress = info.player.address;
        }
      })
      .catch(() => {});
  }

  /** Request all recent blocks from the engine. */
  private _fetchAllBlocks() {
    this.ws.send("get_blocks", { from: 0, limit: 100 });
  }
}
