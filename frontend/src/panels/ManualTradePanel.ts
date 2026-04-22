import type { WSClient } from "../ws/WSClient.js";

interface PoolOption {
  id: string;
  label: string;
  tokenA: string;
  tokenB: string;
}

interface ManualTradeResult {
  amountOut?:         string;
  amountOutDecimals?: number;
  amountOutSymbol?:   string;
  txHash?:            string;
  error?:             string;
}

/**
 * ManualTradePanel — lets players place a one-off swap without writing a script.
 *
 * WS protocol (swap):
 *   send:    { type: "manual_trade", payload: { pool, tokenIn, amountIn } }
 *             amountIn is sent as a human-readable decimal string (e.g. "1.5");
 *             the engine converts it to wei.
 *   receive: { type: "manual_trade_result", payload: { amountOut, txHash, error? } }
 *
 * WS protocol (wrap/unwrap, Issue #46):
 *   send:    { type: "wrap_eth",   payload: { amount: string } }  ETH → WETH
 *   receive: { type: "wrap_result",   payload: { wethBalance?, txHash?, error? } }
 *   send:    { type: "unwrap_eth", payload: { amount: string } }  WETH → ETH
 *   receive: { type: "unwrap_result", payload: { ethBalance?,  txHash?, error? } }
 */
export class ManualTradePanel {
  private container: HTMLElement;
  private ws: WSClient;

  private poolSel!:           HTMLSelectElement;
  private tokenSel!:          HTMLSelectElement;
  private amountIn!:          HTMLInputElement;
  private tradeBtn!:          HTMLButtonElement;
  private notifications!:     HTMLElement;

  // Wrap / Unwrap elements (Issue #46)
  private wrapAmtIn!:         HTMLInputElement;
  private wrapBtn!:           HTMLButtonElement;
  private wrapMaxBtn!:        HTMLButtonElement;
  private unwrapAmtIn!:       HTMLInputElement;
  private unwrapBtn!:         HTMLButtonElement;
  private unwrapMaxBtn!:      HTMLButtonElement;
  private wrapNotifications!: HTMLElement;

  // Pool metadata populated from connection_info / challenges WS event
  private pools: PoolOption[] = [];
  private _busy = false;
  private _wrapBusy = false;

  constructor(container: HTMLElement, ws: WSClient) {
    this.container = container;
    this.ws = ws;
    this._render();
    this._bindWS();
  }

  /** Replace the pool list (called from main.ts when challenge metadata arrives). */
  updatePools(pools: PoolOption[]) {
    this.pools = pools;
    this._refreshPoolSelect();
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private _render() {
    this.container.innerHTML = `
      <div class="panel-title">MANUAL TRADE</div>
      <div class="trade-form">
        <select id="mt-pool"   class="select-input" title="Pool"></select>
        <select id="mt-token"  class="select-input" title="Token to sell"></select>
        <div class="trade-amount-row">
          <input  id="mt-amount" class="num-input trade-amount-input" type="text"
                  placeholder="amount" title="Amount to sell (human units, e.g. 1.5)" />
          <button id="mt-max"   class="btn btn-secondary" style="padding:5px 8px;">MAX</button>
        </div>
        <button id="mt-trade" class="btn btn-primary" style="width:100%;margin-top:6px;">Trade</button>
        <div id="mt-notifications" class="trade-notifications"></div>
      </div>

      <div class="panel-title" style="margin-top:10px;">WRAP / UNWRAP</div>
      <div class="trade-form">
        <div class="trade-amount-row" style="margin-bottom:4px;">
          <input id="mt-wrap-amt" class="num-input trade-amount-input" type="text"
                 placeholder="ETH amount" title="ETH to wrap into WETH" />
          <button id="mt-wrap-max" class="btn btn-secondary" style="padding:5px 8px;">MAX</button>
          <button id="mt-wrap-btn" class="btn btn-secondary" style="padding:5px 8px;white-space:nowrap;">ETH→WETH</button>
        </div>
        <div class="trade-amount-row">
          <input id="mt-unwrap-amt" class="num-input trade-amount-input" type="text"
                 placeholder="WETH amount" title="WETH to unwrap into ETH" />
          <button id="mt-unwrap-max" class="btn btn-secondary" style="padding:5px 8px;">MAX</button>
          <button id="mt-unwrap-btn" class="btn btn-secondary" style="padding:5px 8px;white-space:nowrap;">WETH→ETH</button>
        </div>
        <div id="mt-wrap-notifications" class="trade-notifications"></div>
      </div>
    `;

    this.poolSel           = this.container.querySelector<HTMLSelectElement>("#mt-pool")!;
    this.tokenSel          = this.container.querySelector<HTMLSelectElement>("#mt-token")!;
    this.amountIn          = this.container.querySelector<HTMLInputElement>("#mt-amount")!;
    this.tradeBtn          = this.container.querySelector<HTMLButtonElement>("#mt-trade")!;
    this.notifications     = this.container.querySelector<HTMLElement>("#mt-notifications")!;

    this.wrapAmtIn         = this.container.querySelector<HTMLInputElement>("#mt-wrap-amt")!;
    this.wrapBtn           = this.container.querySelector<HTMLButtonElement>("#mt-wrap-btn")!;
    this.wrapMaxBtn        = this.container.querySelector<HTMLButtonElement>("#mt-wrap-max")!;
    this.unwrapAmtIn       = this.container.querySelector<HTMLInputElement>("#mt-unwrap-amt")!;
    this.unwrapBtn         = this.container.querySelector<HTMLButtonElement>("#mt-unwrap-btn")!;
    this.unwrapMaxBtn      = this.container.querySelector<HTMLButtonElement>("#mt-unwrap-max")!;
    this.wrapNotifications = this.container.querySelector<HTMLElement>("#mt-wrap-notifications")!;

    this.poolSel.addEventListener("change", () => this._refreshTokenSelect());
    this.tradeBtn.addEventListener("click", () => this._submit());
    this.container.querySelector<HTMLButtonElement>("#mt-max")!
      .addEventListener("click", () => this._fillMax());
    this.wrapBtn.addEventListener("click", () => this._wrap());
    this.unwrapBtn.addEventListener("click", () => this._unwrap());
    // Issue #81: Max buttons for wrap/unwrap
    this.wrapMaxBtn.addEventListener("click", () => this._fillMaxWrap());
    this.unwrapMaxBtn.addEventListener("click", () => this._fillMaxUnwrap());

    this._refreshPoolSelect();
  }

  private _refreshPoolSelect() {
    const prev = this.poolSel.value;
    // Issue #44: only touch the DOM when the option list actually changes so the
    // browser doesn't reset the selected state on every tick-triggered updatePools call.
    const newHtml = this.pools.length
      ? this.pools.map(p => `<option value="${p.id}">${p.label}</option>`).join("")
      : `<option value="">— no pools —</option>`;
    if (this.poolSel.innerHTML !== newHtml) this.poolSel.innerHTML = newHtml;
    if (prev && this.pools.some(p => p.id === prev)) this.poolSel.value = prev;
    this._refreshTokenSelect();
  }

  private _refreshTokenSelect() {
    const pool = this._selectedPool();
    if (!pool) {
      this.tokenSel.innerHTML = `<option value="">—</option>`;
      return;
    }
    // Issue #44: save and restore the selected token so switching pools (or a tick-
    // triggered updatePools call) doesn't snap back to the first option.
    const prev = this.tokenSel.value;
    // Issue #82: show directionality ("Convert A → B") instead of the generic "Sell X" label
    this.tokenSel.innerHTML = `
      <option value="${pool.tokenA}">Convert ${pool.tokenA} → ${pool.tokenB}</option>
      <option value="${pool.tokenB}">Convert ${pool.tokenB} → ${pool.tokenA}</option>
    `;
    if (prev === pool.tokenA || prev === pool.tokenB) {
      this.tokenSel.value = prev;
    }
  }

  private _selectedPool(): PoolOption | undefined {
    return this.pools.find(p => p.id === this.poolSel.value);
  }

  private async _fillMax() {
    const pool = this._selectedPool();
    if (!pool) return;
    const tokenIn = this.tokenSel.value;
    if (!tokenIn) return;

    // Ask the engine for the balance via get_balance WS request
    const sym = pool.tokenA === tokenIn ? pool.tokenA : pool.tokenB;

    this._appendNotification("info", "Fetching balance…");

    // Use a one-shot listener so we don't leave dangling handlers
    const cancel = this.ws.on("balance_result", (raw) => {
      cancel();
      const r = raw as { symbol: string; balance: string; error?: string };
      if (r.error) {
        this._appendNotification("error", r.error);
        return;
      }
      this.amountIn.value = r.balance;
    });

    this.ws.send("get_balance", { symbol: sym });

    // Timeout fallback — if engine doesn't respond within 3 s, cancel listener
    setTimeout(() => cancel(), 3000);
  }

  private _submit() {
    if (this._busy) return;

    const pool = this._selectedPool();
    if (!pool) { this._appendNotification("error", "Select a pool."); return; }

    const tokenIn = this.tokenSel.value;
    if (!tokenIn) { this._appendNotification("error", "Select a token."); return; }

    const raw = this.amountIn.value.trim();
    if (!raw || isNaN(parseFloat(raw)) || parseFloat(raw) <= 0) {
      this._appendNotification("error", "Enter a valid amount.");
      return;
    }

    this._busy = true;
    this.tradeBtn.disabled = true;
    this.tradeBtn.textContent = "Trading…";
    this._appendNotification("info", "Sending trade…");

    this.ws.send("manual_trade", {
      pool:    pool.id,
      tokenIn,
      amountIn: raw,   // human-readable; engine converts to wei
    });
  }

  // ── Wrap / Unwrap (Issue #46) ──────────────────────────────────────────────

  // Issue #81: Max buttons for wrap/unwrap
  private _fillMaxWrap() {
    this._appendWrapNotification("info", "Fetching ETH balance…");
    const cancel = this.ws.on("balance_result", (raw) => {
      cancel();
      const r = raw as { symbol: string; balance: string; error?: string };
      if (r.error) {
        this._appendWrapNotification("error", r.error);
        return;
      }
      // Leave ~0.01 ETH as a gas buffer so the wrap tx doesn't fail
      const GAS_BUFFER = 0.01;
      const bal = parseFloat(r.balance);
      if (isNaN(bal) || bal <= GAS_BUFFER) {
        this._appendWrapNotification("error", `ETH balance too low to wrap (need > ${GAS_BUFFER} ETH for gas).`);
        return;
      }
      const safeAmt = (bal - GAS_BUFFER).toFixed(6).replace(/\.?0+$/, "");
      this.wrapAmtIn.value = safeAmt;
    });
    this.ws.send("get_balance", { symbol: "ETH" });
    setTimeout(() => cancel(), 3000);
  }

  private _fillMaxUnwrap() {
    this._appendWrapNotification("info", "Fetching WETH balance…");
    const cancel = this.ws.on("balance_result", (raw) => {
      cancel();
      const r = raw as { symbol: string; balance: string; error?: string };
      if (r.error) {
        this._appendWrapNotification("error", r.error);
        return;
      }
      this.unwrapAmtIn.value = r.balance;
    });
    this.ws.send("get_balance", { symbol: "WETH" });
    setTimeout(() => cancel(), 3000);
  }

  private _wrap() {
    if (this._wrapBusy) return;
    const raw = this.wrapAmtIn.value.trim();
    if (!raw || isNaN(parseFloat(raw)) || parseFloat(raw) <= 0) {
      this._appendWrapNotification("error", "Enter a valid ETH amount.");
      return;
    }
    this._wrapBusy = true;
    // Disable all wrap/unwrap buttons so none can be triggered during the operation
    this.wrapBtn.disabled = true;
    this.unwrapBtn.disabled = true;
    this.wrapMaxBtn.disabled = true;
    this.unwrapMaxBtn.disabled = true;
    this.wrapBtn.textContent = "Wrapping…";
    this._appendWrapNotification("info", "Wrapping ETH…");
    this.ws.send("wrap_eth", { amount: raw });
  }

  private _unwrap() {
    if (this._wrapBusy) return;
    const raw = this.unwrapAmtIn.value.trim();
    if (!raw || isNaN(parseFloat(raw)) || parseFloat(raw) <= 0) {
      this._appendWrapNotification("error", "Enter a valid WETH amount.");
      return;
    }
    this._wrapBusy = true;
    // Disable all wrap/unwrap buttons so none can be triggered during the operation
    this.wrapBtn.disabled = true;
    this.unwrapBtn.disabled = true;
    this.wrapMaxBtn.disabled = true;
    this.unwrapMaxBtn.disabled = true;
    this.unwrapBtn.textContent = "Unwrapping…";
    this._appendWrapNotification("info", "Unwrapping WETH…");
    this.ws.send("unwrap_eth", { amount: raw });
  }

  private _bindWS() {
    // Reset busy state if the WS connection drops while a trade is in flight
    this.ws.on("__disconnected", () => {
      if (this._busy) {
        this._busy = false;
        this.tradeBtn.disabled = false;
        this.tradeBtn.textContent = "Trade";
        this._appendNotification("error", "Disconnected — trade may not have executed.");
      }
      if (this._wrapBusy) {
        this._wrapBusy = false;
        this.wrapBtn.disabled = false;
        this.unwrapBtn.disabled = false;
        this.wrapMaxBtn.disabled = false;
        this.unwrapMaxBtn.disabled = false;
        this.wrapBtn.textContent = "ETH→WETH";
        this.unwrapBtn.textContent = "WETH→ETH";
        this._appendWrapNotification("error", "Disconnected — operation may not have completed.");
      }
    });

    this.ws.on("manual_trade_result", (raw) => {
      this._busy = false;
      this.tradeBtn.disabled = false;
      this.tradeBtn.textContent = "Trade";

      const r = raw as ManualTradeResult;
      if (r.error) {
        this._appendNotification("error", r.error);
        return;
      }

      const decimals  = r.amountOutDecimals ?? 18;
      const symbol    = r.amountOutSymbol   ?? "";
      const outHuman  = r.amountOut ? _fmtUnits(r.amountOut, decimals) : "?";
      const shortHash = r.txHash ? `${r.txHash.slice(0, 10)}…` : "";
      this._appendNotification(
        "success",
        `Received ${outHuman}${symbol ? ` ${symbol}` : ""}${shortHash ? `  tx: ${shortHash}` : ""}`,
      );

      // Clear amount so the next trade starts fresh
      this.amountIn.value = "";
    });

    this.ws.on("wrap_result", (raw) => {
      this._wrapBusy = false;
      this.wrapBtn.disabled = false;
      this.unwrapBtn.disabled = false;
      this.wrapMaxBtn.disabled = false;
      this.unwrapMaxBtn.disabled = false;
      this.wrapBtn.textContent = "ETH→WETH";

      const r = raw as { wethBalance?: string; txHash?: string; error?: string };
      if (r.error) {
        this._appendWrapNotification("error", r.error);
        return;
      }
      const shortHash = r.txHash ? `${r.txHash.slice(0, 10)}…` : "";
      this._appendWrapNotification(
        "success",
        `Wrapped. WETH balance: ${r.wethBalance ?? "?"}${shortHash ? `  tx: ${shortHash}` : ""}`,
      );
      this.wrapAmtIn.value = "";
    });

    this.ws.on("unwrap_result", (raw) => {
      this._wrapBusy = false;
      this.wrapBtn.disabled = false;
      this.unwrapBtn.disabled = false;
      this.wrapMaxBtn.disabled = false;
      this.unwrapMaxBtn.disabled = false;
      this.unwrapBtn.textContent = "WETH→ETH";

      const r = raw as { ethBalance?: string; txHash?: string; error?: string };
      if (r.error) {
        this._appendWrapNotification("error", r.error);
        return;
      }
      const shortHash = r.txHash ? `${r.txHash.slice(0, 10)}…` : "";
      this._appendWrapNotification(
        "success",
        `Unwrapped. ETH balance: ${r.ethBalance ?? "?"}${shortHash ? `  tx: ${shortHash}` : ""}`,
      );
      this.unwrapAmtIn.value = "";
    });
  }

  /** Append a stacked notification to the trade notifications area. Auto-dismisses after 8 s. */
  private _appendNotification(state: "info" | "success" | "error", msg: string) {
    _addNotification(this.notifications, state, msg);
  }

  /** Append a stacked notification to the wrap/unwrap notifications area. Auto-dismisses after 8 s. */
  private _appendWrapNotification(state: "info" | "success" | "error", msg: string) {
    _addNotification(this.wrapNotifications, state, msg);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format a token amount from its smallest unit using the token's decimals. */
function _fmtUnits(raw: string, decimals: number): string {
  try {
    const n   = parseFloat(raw);
    if (isNaN(n)) return raw;
    const div = Math.pow(10, decimals);
    const val = n / div;
    if (val >= 1000)   return val.toFixed(2);
    if (val >= 1)      return val.toFixed(4);
    if (val >= 0.0001) return val.toFixed(6);
    return val.toExponential(4);
  } catch {
    return raw;
  }
}

const NOTIFICATION_LIFETIME_MS = 8000;
const NOTIFICATION_FADE_MS     = 400;

/**
 * Append a self-dismissing notification pill to `container`.
 * Notifications stack (oldest on top) and each has an × dismiss button.
 * After NOTIFICATION_LIFETIME_MS the pill fades out and removes itself.
 */
function _addNotification(
  container: HTMLElement,
  state: "info" | "success" | "error",
  msg: string,
): void {
  const pill = document.createElement("div");
  pill.className = `trade-notification trade-notification-${state}`;

  const text = document.createElement("span");
  text.className = "trade-notification-text";
  text.textContent = msg;

  const dismiss = document.createElement("button");
  dismiss.className = "trade-notification-dismiss";
  dismiss.setAttribute("aria-label", "Dismiss");
  dismiss.textContent = "×";

  pill.appendChild(text);
  pill.appendChild(dismiss);
  container.appendChild(pill);

  let dismissed = false;
  const remove = () => {
    if (dismissed) return;
    dismissed = true;
    pill.classList.add("trade-notification-fade");
    setTimeout(() => pill.remove(), NOTIFICATION_FADE_MS);
  };

  dismiss.addEventListener("click", remove);
  setTimeout(remove, NOTIFICATION_LIFETIME_MS);
}
