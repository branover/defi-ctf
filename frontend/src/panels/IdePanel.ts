import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { javascript } from "@codemirror/lang-javascript";
import { solidity } from "@replit/codemirror-lang-solidity";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  defaultKeymap,
  indentWithTab,
  toggleComment,
  indentMore,
  indentLess,
  selectAll,
  undo,
  redo,
} from "@codemirror/commands";
import type { WSClient } from "../ws/WSClient.js";

// Fallback used when the engine is unreachable — matches the master solve/script/solve.js.
const DEFAULT_SCRIPT = `// ─────────────────────────────────────────────────────────────────────────────
// solve.js — defi-ctf player script
//
// Scripts run in a sandbox with the SDK injected as globals (no require/import).
// The script body runs ONCE on submit; use it to register triggers and set state.
// Triggers (onBlock, onPriceBelow, onPriceAbove) fire each block asynchronously.
// ─────────────────────────────────────────────────────────────────────────────

// ── Working example: buy-the-dip strategy ────────────────────────────────────

const POOL      = "weth-usdc-uniswap";
const BUY_BELOW  = 2800;   // buy WETH when price drops here
const SELL_ABOVE = 3200;   // sell WETH when price rises here

let bought = false;

const buyId = onPriceBelow(POOL, BUY_BELOW, async (ctx) => {
  if (bought) return;
  const usdc = await getBalance("USDC");
  if (usdc < parseUnits("100", 6)) { ctx.log("Not enough USDC"); return; }

  await swap(POOL, "USDC", usdc / 2n);
  bought = true;
  ctx.log(\`Bought WETH @ $\${ctx.price.toFixed(2)} (block \${ctx.blockNumber})\`);
}, "Buy the dip");

onPriceAbove(POOL, SELL_ABOVE, async (ctx) => {
  if (!bought) return;
  const weth = await getBalance("WETH");
  if (weth === 0n) return;

  await swap(POOL, "WETH", weth);
  bought = false;
  ctx.log(\`Sold WETH @ $\${ctx.price.toFixed(2)} (block \${ctx.blockNumber})\`);
  removeTrigger(buyId);
}, "Sell the rip");

// ─────────────────────────────────────────────────────────────────────────────
// SDK quick reference (uncomment to use)
// ─────────────────────────────────────────────────────────────────────────────

// Balances:   getBalance("ETH"|"WETH"|"USDC")  → bigint
// Prices:     getPrice("weth-usdc-uniswap")             → number (USDC per WETH)
// Reserves:   getReserves("weth-usdc-uniswap")          → { reserve0, reserve1 }
// Candles:    getPriceHistory("weth-usdc-uniswap", 20)  → Candle[]
// Quote:      quoteOut("weth-usdc-uniswap","WETH", amt) → bigint (no state change)
//
// Swap:       swap(poolId, tokenSymbol, amountIn, minOut?)  → bigint
// Wrap ETH:   wrapEth(parseEther("1"))
// Unwrap:     unwrapEth(await getBalance("WETH"))
// Liquidity:  addLiquidity / removeLiquidity / getLPBalance
// Approve:    approveToken("USDC", spenderAddr, amount)
//
// Contracts:  getContractAddress("vault")
//             readContract("vault", "owner")
//             execContract("vault", "drain", [], parseEther("1"))
//             callWithAbi(addr, ["function foo()"], "foo", [], 0n)
//
// Chain:      getBlockTransactions(1)  → useful for decoding init calldata
//             decodeCalldata(["string"], "0x...")
//
// Forge:      runForgeScript("script/Solve.s.sol")  → { success, exitCode, output }
//
// Utils:      parseEther / formatEther / parseUnits / formatUnits
//             getPlayerAddress()   log(...)   BigInt
`;

interface FileNode {
  name: string;
  path: string;
  /** Backend sends either isDir (old) or type:'file'|'dir' (new solve/ API) */
  isDir?: boolean;
  type?: "file" | "dir";
  readOnly?: boolean;
  children?: FileNode[];
}

interface OpenFile {
  path: string;
  savedContent: string;
  /** Which workspace this file belongs to */
  mode: "js" | "sol";
  readOnly?: boolean;
}

type WorkspaceMode = "js" | "sol" | "env";

export class IdePanel {
  private ws: WSClient;
  private challengeId = "";
  private view: EditorView | null = null;
  private openFiles = new Map<string, OpenFile>();
  // Tracks the current (possibly unsaved) editor content for each open file
  private contentCache = new Map<string, string>();
  private activeFilePath = "";
  // Suppresses dirty-check during programmatic content replacement
  private _switching = false;
  // Tracks whether the last-created editor was for a .sol file (for destroy/recreate on lang switch)
  private _lastEditorWasSol: boolean | null = null;
  // Tracks whether the last-created editor was read-only (for destroy/recreate on readOnly change)
  private _lastEditorReadOnly: boolean | null = null;
  private _mode: WorkspaceMode = "js";
  // Track whether a forge command is running
  private _forgeRunning = false;
  // Unsubscribe functions for WS listeners
  private _offForgeLog: (() => void) | null = null;
  private _offForgeDone: (() => void) | null = null;
  // Stored listener reference so it can be removed on destroy
  private _keydownListener: ((e: KeyboardEvent) => void) | null = null;

  // DOM refs
  private fileTreeEl!: HTMLElement;
  private tabBarEl!: HTMLElement;
  private editorWrapEl!: HTMLElement;
  private emptyStateEl!: HTMLElement;
  private saveBtnEl!: HTMLButtonElement;
  private popOutBtnEl!: HTMLButtonElement;
  private container!: HTMLElement;
  // New Solidity-mode DOM refs
  private modeJsBtnEl!: HTMLButtonElement;
  private modeSolBtnEl!: HTMLButtonElement;
  private modeEnvBtnEl!: HTMLButtonElement;
  private runScriptBtnEl!: HTMLButtonElement;
  private deployBtnEl!: HTMLButtonElement;
  private stopBtnEl!: HTMLButtonElement;
  private forgeLogEl!: HTMLElement;
  private forgeLogPanelEl!: HTMLElement;
  private ideBodyEl!: HTMLElement;
  // JS mode buttons
  private jsRunBtnEl!: HTMLButtonElement;
  private jsStopBtnEl!: HTMLButtonElement;
  // Tree label
  private treeLabelEl!: HTMLElement;
  // New-file button
  private newFileBtnEl!: HTMLButtonElement;
  // Environment mode refs
  private envPanelEl!: HTMLElement;
  private envContentEl!: HTMLElement;
  private envRefreshBtnEl!: HTMLButtonElement;
  // Shortcuts help
  private shortcutsBtnEl!: HTMLButtonElement;
  private shortcutsModalEl!: HTMLElement;

  constructor(container: HTMLElement, ws: WSClient) {
    this.ws = ws;
    this.container = container;
    this._buildDOM();
    this._subscribeForgeEvents();
    this._subscribeEnvEvents();
  }

  setChallenge(challengeId: string): void {
    if (this.challengeId === challengeId) return;
    this.challengeId = challengeId;
    this._resetJsState();
    // Always return to JS mode on challenge switch so the tab highlight and
    // displayed content are never out of sync (the user had Sol/Env active before).
    this._mode = "js";
    this._applyModeUI();
    this._loadFiles();
  }

  /**
   * Load a JS code snippet into the editor (switches to JS mode).
   * Called from main.ts after navigating from the tutorial.
   */
  loadJsSnippet(code: string): void {
    this._mode = "js";
    this._applyModeUI();
    // Put the code in a virtual open file so it appears immediately
    const fakePath = "__tutorial_snippet__.js";
    this.openFiles.set(fakePath, { path: fakePath, savedContent: code, mode: "js" });
    this.contentCache.set(fakePath, code);
    this.activeFilePath = fakePath;
    this._updateTabs();
    this._updateEditor();
    this._updateTreeActive();
  }

  /**
   * Load a Solidity snippet into the editor (switches to Solidity mode).
   * Creates/overwrites the file at filePath in the solve workspace and opens it.
   */
  async loadSolSnippet(filePath: string, code: string): Promise<void> {
    // Save to solve workspace (scoped to challenge)
    await fetch("/api/solve/file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challenge: this.challengeId, path: filePath, content: code }),
    });

    this._mode = "sol";
    this._applyModeUI();
    // Reload the file tree, then open the new file
    await this._loadSolFiles();
    // If the file is now in the tree, open it
    await this._openFile(filePath, "sol");
  }

  // ── DOM setup ───────────────────────────────────────────────────────────────

  private _buildDOM(): void {
    this.container.innerHTML = `
      <div class="ide-header">
        <span class="panel-title ide-title">SCRIPT IDE</span>
        <div class="ide-mode-switcher">
          <button id="ide-mode-js"  class="ide-mode-btn active">JS Scripts</button>
          <button id="ide-mode-sol" class="ide-mode-btn">Solidity</button>
          <button id="ide-mode-env" class="ide-mode-btn">Environment</button>
        </div>
        <div class="ide-actions">
          <button id="ide-save" class="btn ide-save-btn" title="Save (Ctrl+S)" disabled>💾 Save</button>
          <!-- JS mode buttons -->
          <button id="ide-run"  class="btn btn-primary ide-action-btn ide-js-btn">&#9654; Run</button>
          <button id="ide-stop" class="btn btn-danger  ide-action-btn ide-js-btn">&#9632; Stop</button>
          <!-- Solidity mode buttons (hidden initially) -->
          <button id="ide-run-script" class="btn btn-primary ide-action-btn ide-sol-btn" style="display:none">&#9654; Run Script</button>
          <button id="ide-deploy"     class="btn btn-primary ide-action-btn ide-sol-btn" style="display:none">&#8593; Deploy</button>
          <button id="ide-forge-stop" class="btn btn-danger  ide-action-btn ide-sol-btn" style="display:none" disabled>&#9632; Stop</button>
          <!-- Environment mode buttons (hidden initially) -->
          <button id="ide-env-refresh" class="btn btn-secondary ide-action-btn ide-env-btn" style="display:none" title="Re-run env.sh to refresh values">&#8635; Refresh</button>
          <button id="ide-popout" class="btn btn-secondary ide-action-btn" title="Open in new window">&#10562;</button>
          <button id="ide-shortcuts-btn" class="ide-icon-btn ide-shortcuts-icon-btn" title="Keyboard shortcuts">?</button>
        </div>
      </div>
      <!-- Keyboard shortcuts help modal -->
      <div id="ide-shortcuts-modal" class="ide-shortcuts-backdrop hidden" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <div class="ide-shortcuts-modal">
          <div class="ide-shortcuts-header">
            <span class="ide-shortcuts-title">Keyboard Shortcuts</span>
            <button id="ide-shortcuts-close" class="readme-close" title="Close">&times;</button>
          </div>
          <div class="ide-shortcuts-body">
            <table class="ide-shortcuts-table">
              <tbody>
                <tr class="ide-shortcuts-section-row"><td colspan="2" class="ide-shortcuts-section">Editing</td></tr>
                <tr>
                  <td class="ide-shortcuts-keys"><kbd>Ctrl</kbd>+<kbd>/</kbd> <span class="ide-shortcuts-mac">/ <kbd>Cmd</kbd>+<kbd>/</kbd></span></td>
                  <td class="ide-shortcuts-desc">Toggle line comment</td>
                </tr>
                <tr>
                  <td class="ide-shortcuts-keys"><kbd>Tab</kbd></td>
                  <td class="ide-shortcuts-desc">Indent line(s)</td>
                </tr>
                <tr>
                  <td class="ide-shortcuts-keys"><kbd>Shift</kbd>+<kbd>Tab</kbd></td>
                  <td class="ide-shortcuts-desc">Unindent line(s)</td>
                </tr>
                <tr>
                  <td class="ide-shortcuts-keys"><kbd>Ctrl</kbd>+<kbd>Z</kbd> <span class="ide-shortcuts-mac">/ <kbd>Cmd</kbd>+<kbd>Z</kbd></span></td>
                  <td class="ide-shortcuts-desc">Undo</td>
                </tr>
                <tr>
                  <td class="ide-shortcuts-keys"><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> <span class="ide-shortcuts-mac">/ <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd></span></td>
                  <td class="ide-shortcuts-desc">Redo</td>
                </tr>
                <tr>
                  <td class="ide-shortcuts-keys"><kbd>Ctrl</kbd>+<kbd>D</kbd> <span class="ide-shortcuts-mac">/ <kbd>Cmd</kbd>+<kbd>D</kbd></span></td>
                  <td class="ide-shortcuts-desc">Select next occurrence</td>
                </tr>
                <tr>
                  <td class="ide-shortcuts-keys"><kbd>Ctrl</kbd>+<kbd>]</kbd> <span class="ide-shortcuts-mac">/ <kbd>Cmd</kbd>+<kbd>]</kbd></span></td>
                  <td class="ide-shortcuts-desc">Indent selected lines</td>
                </tr>
                <tr>
                  <td class="ide-shortcuts-keys"><kbd>Ctrl</kbd>+<kbd>[</kbd> <span class="ide-shortcuts-mac">/ <kbd>Cmd</kbd>+<kbd>[</kbd></span></td>
                  <td class="ide-shortcuts-desc">Unindent selected lines</td>
                </tr>
                <tr class="ide-shortcuts-section-row"><td colspan="2" class="ide-shortcuts-section">Selection</td></tr>
                <tr>
                  <td class="ide-shortcuts-keys"><kbd>Ctrl</kbd>+<kbd>A</kbd> <span class="ide-shortcuts-mac">/ <kbd>Cmd</kbd>+<kbd>A</kbd></span></td>
                  <td class="ide-shortcuts-desc">Select all</td>
                </tr>
                <tr>
                  <td class="ide-shortcuts-keys"><kbd>Shift</kbd>+<kbd>&#8592;</kbd><kbd>&#8594;</kbd><kbd>&#8593;</kbd><kbd>&#8595;</kbd></td>
                  <td class="ide-shortcuts-desc">Extend selection</td>
                </tr>
                <tr>
                  <td class="ide-shortcuts-keys"><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>&#8592;</kbd><kbd>&#8594;</kbd></td>
                  <td class="ide-shortcuts-desc">Extend selection by word</td>
                </tr>
                <tr>
                  <td class="ide-shortcuts-keys"><kbd>Alt</kbd>+<kbd>&#8592;</kbd> / <kbd>&#8594;</kbd></td>
                  <td class="ide-shortcuts-desc">Move cursor by word</td>
                </tr>
                <tr class="ide-shortcuts-section-row"><td colspan="2" class="ide-shortcuts-section">Navigation</td></tr>
                <tr>
                  <td class="ide-shortcuts-keys"><kbd>Ctrl</kbd>+<kbd>Home</kbd> <span class="ide-shortcuts-mac">/ <kbd>Cmd</kbd>+<kbd>&#8593;</kbd></span></td>
                  <td class="ide-shortcuts-desc">Go to start of file</td>
                </tr>
                <tr>
                  <td class="ide-shortcuts-keys"><kbd>Ctrl</kbd>+<kbd>End</kbd> <span class="ide-shortcuts-mac">/ <kbd>Cmd</kbd>+<kbd>&#8595;</kbd></span></td>
                  <td class="ide-shortcuts-desc">Go to end of file</td>
                </tr>
                <tr>
                  <td class="ide-shortcuts-keys"><kbd>Home</kbd></td>
                  <td class="ide-shortcuts-desc">Go to line start</td>
                </tr>
                <tr>
                  <td class="ide-shortcuts-keys"><kbd>End</kbd></td>
                  <td class="ide-shortcuts-desc">Go to line end</td>
                </tr>
                <tr class="ide-shortcuts-section-row"><td colspan="2" class="ide-shortcuts-section">File</td></tr>
                <tr>
                  <td class="ide-shortcuts-keys"><kbd>Ctrl</kbd>+<kbd>S</kbd> <span class="ide-shortcuts-mac">/ <kbd>Cmd</kbd>+<kbd>S</kbd></span></td>
                  <td class="ide-shortcuts-desc">Save current file</td>
                </tr>
                <tr>
                  <td class="ide-shortcuts-keys"><kbd>Ctrl</kbd>+<kbd>N</kbd> <span class="ide-shortcuts-mac">/ <kbd>Cmd</kbd>+<kbd>N</kbd></span></td>
                  <td class="ide-shortcuts-desc">New file</td>
                </tr>
                <tr>
                  <td class="ide-shortcuts-keys"><kbd>Ctrl</kbd>+<kbd>W</kbd> <span class="ide-shortcuts-mac">/ <kbd>Cmd</kbd>+<kbd>W</kbd></span></td>
                  <td class="ide-shortcuts-desc">Close active tab</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div id="ide-body" class="ide-body">
        <div class="ide-tree-panel">
          <div class="ide-tree-header">
            <span id="ide-tree-label" class="ide-tree-label">SOLUTION</span>
            <button id="ide-new-file" class="ide-icon-btn" title="New file">+</button>
          </div>
          <div id="ide-file-tree" class="ide-file-tree"></div>
        </div>
        <div class="ide-editor-panel">
          <div id="ide-tab-bar" class="ide-tab-bar"></div>
          <div id="ide-editor-wrap" class="ide-editor-wrap" style="display:none"></div>
          <div id="ide-empty-state" class="ide-empty-state">
            <div class="ide-empty-msg">No file open</div>
            <div class="ide-empty-sub">Select a file from the tree, or click + to create one</div>
            <div class="ide-firsttime-hint" id="ide-firsttime-hint" style="display:none">
              <div class="ide-firsttime-inner">
                <span class="ide-firsttime-icon">&#128218;</span>
                <div>
                  <div class="ide-firsttime-title">First time here?</div>
                  <div class="ide-firsttime-body">
                    Check the <a href="?view=tutorial" class="ide-firsttime-link">Tutorial</a> for an interactive walkthrough,
                    or browse the <a href="https://github.com/branover/defi-ctf/blob/master/docs/examples.md" target="_blank" class="ide-firsttime-link">JS examples</a>
                    and <a href="https://github.com/branover/defi-ctf/blob/master/docs/script-sdk.md" target="_blank" class="ide-firsttime-link">SDK reference</a>.
                  </div>
                </div>
                <button class="ide-firsttime-dismiss" id="ide-firsttime-dismiss" title="Dismiss">&#10005;</button>
              </div>
            </div>
          </div>
          <!-- Forge log panel (always in DOM, shown in Solidity mode) -->
          <div id="ide-forge-log-panel" class="ide-forge-log-panel" style="display:none">
            <div class="ide-forge-log-header">
              <span class="ide-forge-log-title">FORGE OUTPUT</span>
              <button id="ide-forge-log-clear" class="ide-icon-btn" title="Clear output">Clear</button>
            </div>
            <div id="ide-forge-log" class="ide-forge-log"></div>
          </div>
          <!-- Environment panel (shown in Environment mode) -->
          <div id="ide-env-panel" class="ide-env-panel" style="display:none">
            <div class="ide-env-header">
              <span class="ide-env-title">ENVIRONMENT VARIABLES</span>
              <span class="ide-env-subtitle">Auto-generated by env.sh &mdash; use these in your Forge scripts</span>
            </div>
            <pre id="ide-env-content" class="ide-env-content">Loading...</pre>
          </div>
        </div>
      </div>
    `;

    this.fileTreeEl       = this.container.querySelector("#ide-file-tree")!;
    this.tabBarEl         = this.container.querySelector("#ide-tab-bar")!;
    this.editorWrapEl     = this.container.querySelector("#ide-editor-wrap")!;
    this.emptyStateEl     = this.container.querySelector("#ide-empty-state")!;
    this.saveBtnEl        = this.container.querySelector("#ide-save")!;
    this.popOutBtnEl      = this.container.querySelector("#ide-popout")!;
    this.ideBodyEl        = this.container.querySelector("#ide-body")!;
    this.modeJsBtnEl      = this.container.querySelector("#ide-mode-js")!;
    this.modeSolBtnEl     = this.container.querySelector("#ide-mode-sol")!;
    this.modeEnvBtnEl     = this.container.querySelector("#ide-mode-env")!;
    this.jsRunBtnEl       = this.container.querySelector("#ide-run")!;
    this.jsStopBtnEl      = this.container.querySelector("#ide-stop")!;
    this.runScriptBtnEl   = this.container.querySelector("#ide-run-script")!;
    this.deployBtnEl      = this.container.querySelector("#ide-deploy")!;
    this.stopBtnEl        = this.container.querySelector("#ide-forge-stop")!;
    this.forgeLogPanelEl  = this.container.querySelector("#ide-forge-log-panel")!;
    this.forgeLogEl       = this.container.querySelector("#ide-forge-log")!;
    this.treeLabelEl      = this.container.querySelector("#ide-tree-label")!;
    this.newFileBtnEl     = this.container.querySelector("#ide-new-file")!;
    this.envPanelEl       = this.container.querySelector("#ide-env-panel")!;
    this.envContentEl     = this.container.querySelector("#ide-env-content")!;
    this.envRefreshBtnEl  = this.container.querySelector("#ide-env-refresh")!;
    this.shortcutsBtnEl   = this.container.querySelector("#ide-shortcuts-btn")!;
    this.shortcutsModalEl = this.container.querySelector("#ide-shortcuts-modal")!;

    // Mode switcher
    this.modeJsBtnEl.addEventListener("click",  () => this._switchMode("js"));
    this.modeSolBtnEl.addEventListener("click", () => this._switchMode("sol"));
    this.modeEnvBtnEl.addEventListener("click", () => this._switchMode("env"));

    // Environment refresh button
    this.envRefreshBtnEl.addEventListener("click", () => this._loadEnvVars());

    // First-time hint: show once per browser, until dismissed
    const hintEl = this.container.querySelector<HTMLElement>("#ide-firsttime-hint");
    const dismissEl = this.container.querySelector<HTMLElement>("#ide-firsttime-dismiss");
    if (hintEl && !localStorage.getItem("ide_hint_dismissed")) {
      hintEl.style.display = "";
    }
    dismissEl?.addEventListener("click", () => {
      if (hintEl) hintEl.style.display = "none";
      localStorage.setItem("ide_hint_dismissed", "1");
    });

    // JS mode actions (unchanged)
    this.saveBtnEl.addEventListener("click", () => this._saveCurrentFile());
    this.jsRunBtnEl.addEventListener("click",  () => this._runScript());
    this.jsStopBtnEl.addEventListener("click", () => this.ws.send("script_stop", {}));

    // Solidity mode actions
    this.runScriptBtnEl.addEventListener("click", () => this._forgeRunScript());
    this.deployBtnEl.addEventListener("click",    () => this._forgeDeploy());
    this.stopBtnEl.addEventListener("click",      () => { /* no server stop for forge yet — just re-enable */ });

    // Pop-out
    this.popOutBtnEl.addEventListener("click", () => this._popOut());

    // New-file
    this.newFileBtnEl.addEventListener("click", () => this._promptNewFile(""));

    // Forge log clear
    this.container.querySelector("#ide-forge-log-clear")!.addEventListener("click", () => {
      this.forgeLogEl.innerHTML = "";
    });

    // Shortcuts help button
    this.shortcutsBtnEl.addEventListener("click", () => this._toggleShortcutsModal(true));
    this.shortcutsModalEl.addEventListener("click", (e) => {
      if (e.target === this.shortcutsModalEl) this._toggleShortcutsModal(false);
    });
    this.container.querySelector("#ide-shortcuts-close")!.addEventListener("click", () => {
      this._toggleShortcutsModal(false);
    });

    // Global keyboard shortcuts (panel-scoped).
    // Store the reference so destroy() can remove it and avoid leaks.
    this._keydownListener = (e: KeyboardEvent) => {
      const editorHasFocus = this.view?.hasFocus ?? false;
      const panelHasFocus  = this.container.contains(document.activeElement);
      const inIde          = editorHasFocus || panelHasFocus;

      // Escape: close shortcuts modal (global — works even when IDE doesn't have focus)
      if (e.key === "Escape" && !this.shortcutsModalEl.classList.contains("hidden")) {
        e.preventDefault();
        this._toggleShortcutsModal(false);
        return;
      }

      if (!inIde) return;

      // Ctrl/Cmd+S — save
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        this._saveCurrentFile();
        return;
      }

      // Ctrl/Cmd+N — new file (not available in Environment mode)
      if ((e.ctrlKey || e.metaKey) && e.key === "n") {
        e.preventDefault();
        if (this._mode !== "env") {
          this._promptNewFile("");
        }
        return;
      }

      // Ctrl/Cmd+W — close active tab (always preventDefault to prevent browser tab close)
      if ((e.ctrlKey || e.metaKey) && e.key === "w") {
        e.preventDefault();
        if (this.activeFilePath) {
          this._closeTab(this.activeFilePath);
        }
        return;
      }
    };
    document.addEventListener("keydown", this._keydownListener);
  }

  private _toggleShortcutsModal(show: boolean): void {
    this.shortcutsModalEl.classList.toggle("hidden", !show);
  }

  /** Clean up global event listeners and the CodeMirror editor instance. */
  destroy(): void {
    if (this._keydownListener) {
      document.removeEventListener("keydown", this._keydownListener);
      this._keydownListener = null;
    }
    if (this.view) {
      this.view.destroy();
      this.view = null;
    }
    this._offForgeLog?.();
    this._offForgeDone?.();
  }

  // ── WS subscriptions for forge events ───────────────────────────────────────

  private _subscribeForgeEvents(): void {
    this._offForgeLog = this.ws.on("forge_log", (raw) => {
      const p = raw as { stream: "stdout" | "stderr" | "info" | "error"; message: string };
      this._appendForgeLog(p.stream, p.message);
    });

    this._offForgeDone = this.ws.on("forge_done", (raw) => {
      const p = raw as { success: boolean; exitCode: number; contractAddress?: string };
      this._forgeRunning = false;
      this._updateSolButtons();

      const banner = document.createElement("div");
      banner.className = p.success ? "forge-log-banner forge-log-success" : "forge-log-banner forge-log-failure";
      banner.textContent = p.success
        ? `Success (exit ${p.exitCode})`
        : `Failed (exit ${p.exitCode})`;

      if (p.success && p.contractAddress) {
        const addr = document.createElement("div");
        addr.className = "forge-log-addr";
        addr.textContent = `Deployed to: ${p.contractAddress}`;
        this.forgeLogEl.appendChild(banner);
        this.forgeLogEl.appendChild(addr);
      } else {
        this.forgeLogEl.appendChild(banner);
      }

      this.forgeLogEl.scrollTop = this.forgeLogEl.scrollHeight;
    });
  }

  private _appendForgeLog(stream: "stdout" | "stderr" | "info" | "error", message: string): void {
    const line = document.createElement("div");
    line.className = `forge-log-line forge-log-${stream}`;
    line.textContent = message;
    this.forgeLogEl.appendChild(line);
    this.forgeLogEl.scrollTop = this.forgeLogEl.scrollHeight;
  }

  // ── Mode switching ───────────────────────────────────────────────────────────

  private _switchMode(mode: WorkspaceMode): void {
    if (this._mode === mode) return;

    // Snapshot current editor content before switching
    if (this.activeFilePath && this.view) {
      this.contentCache.set(this.activeFilePath, this.view.state.doc.toString());
    }

    this._mode = mode;
    this._applyModeUI();

    if (mode === "js") {
      // Restore JS state: clear active so we re-open from openFiles
      this.activeFilePath = "";
      this._loadFiles();
    } else if (mode === "sol") {
      // Switch to Solidity workspace
      this.activeFilePath = "";
      this._loadSolFiles();
    } else if (mode === "env") {
      // Switch to Environment viewer
      this._loadEnvVars();
    }
  }

  private _applyModeUI(): void {
    const isSol = this._mode === "sol";
    const isEnv = this._mode === "env";
    const isJs  = this._mode === "js";

    // Mode tab active state
    this.modeJsBtnEl.classList.toggle("active", isJs);
    this.modeSolBtnEl.classList.toggle("active", isSol);
    this.modeEnvBtnEl.classList.toggle("active", isEnv);

    // Show/hide button groups
    this.container.querySelectorAll<HTMLElement>(".ide-js-btn").forEach(el => {
      el.style.display = isJs ? "" : "none";
    });
    this.container.querySelectorAll<HTMLElement>(".ide-sol-btn").forEach(el => {
      el.style.display = isSol ? "" : "none";
    });
    this.container.querySelectorAll<HTMLElement>(".ide-env-btn").forEach(el => {
      el.style.display = isEnv ? "" : "none";
    });

    // Forge log panel — only in Solidity mode
    this.forgeLogPanelEl.style.display = isSol ? "" : "none";

    // Environment panel — only in Environment mode
    this.envPanelEl.style.display = isEnv ? "" : "none";

    // Editor/empty state — hidden in Environment mode (env panel takes the whole space)
    if (isEnv) {
      this.editorWrapEl.style.display = "none";
      this.emptyStateEl.style.display = "none";
      this.tabBarEl.innerHTML = "";
      // Tree panel not useful in env mode — show a placeholder
      this.fileTreeEl.innerHTML = `<div class="ide-empty-msg" style="padding:8px;font-size:11px;color:#6e7681">Environment variables</div>`;
      this.newFileBtnEl.style.display = "none";
    } else {
      this.newFileBtnEl.style.display = "";
    }

    // Save button not relevant in env mode
    this.saveBtnEl.style.display = isEnv ? "none" : "";

    // Tree label
    this.treeLabelEl.textContent = isSol ? "WORKSPACE" : isEnv ? "ENV" : "SOLUTION";

    // If switching to Solidity, update context-sensitive buttons
    if (isSol) this._updateSolButtons();
  }

  // ── Environment variable loading ──────────────────────────────────────────────

  /** Subscribe to WS env_updated events and refresh the display when the server signals new values. */
  private _subscribeEnvEvents(): void {
    this.ws.on("env_updated", () => {
      if (this._mode === "env") {
        this._loadEnvVars();
      }
      // Highlight the env tab briefly to signal an update even if not currently active
      this.modeEnvBtnEl.classList.add("ide-env-updated");
      setTimeout(() => this.modeEnvBtnEl.classList.remove("ide-env-updated"), 3000);
    });
  }

  /** Fetch env vars from /api/env and render them in the environment panel. */
  private async _loadEnvVars(): Promise<void> {
    this.envContentEl.textContent = "Loading...";
    try {
      const resp = await fetch("/api/env");
      if (!resp.ok) {
        this.envContentEl.textContent = "Failed to load environment variables.";
        return;
      }
      const data = await resp.json() as {
        ok: boolean;
        error?: string;
        raw: string;
        vars: Record<string, string>;
      };
      if (!data.ok || !data.raw) {
        const hint = data.error ?? "No challenge is currently running.";
        this.envContentEl.textContent =
          `# No environment available\n# ${hint}\n\n` +
          `# Start a challenge first, then come back here to see\n` +
          `# RPC_URL, PRIVATE_KEY, contract addresses, and more.`;
        return;
      }
      this.envContentEl.textContent = data.raw;
    } catch (e) {
      this.envContentEl.textContent = `Error: ${String(e)}`;
    }
  }

  /** Update Run Script / Deploy button visibility based on active file */
  private _updateSolButtons(): void {
    if (this._mode !== "sol") return;

    const path = this.activeFilePath;
    const isScriptSol = path.endsWith(".s.sol");
    const isSol       = path.endsWith(".sol");
    const isSolNotScript = isSol && !isScriptSol;
    const running = this._forgeRunning;

    this.runScriptBtnEl.style.display = isScriptSol ? "" : "none";
    this.deployBtnEl.style.display    = isSolNotScript ? "" : "none";
    this.stopBtnEl.style.display      = (isScriptSol || isSolNotScript) ? "" : "none";

    this.runScriptBtnEl.disabled = running;
    this.deployBtnEl.disabled    = running;
    this.stopBtnEl.disabled      = !running;
  }

  // ── State management ────────────────────────────────────────────────────────

  /** Reset open files and editor state on challenge switch. */
  private _resetJsState(): void {
    if (this.activeFilePath && this.view) {
      this.contentCache.set(this.activeFilePath, this.view.state.doc.toString());
    }
    // Clear all open files from both modes (challenge switch scopes both workspaces)
    this.openFiles.clear();
    this.contentCache.clear();
    this.activeFilePath = "";
    this.tabBarEl.innerHTML = "";
    this.fileTreeEl.innerHTML = "";
    this._showEmptyState();
    this.popOutBtnEl.disabled = false;
  }

  // ── File loading — JS mode ───────────────────────────────────────────────────

  private async _loadFiles(): Promise<void> {
    if (!this.challengeId) return;
    const resp = await fetch(`/api/challenge/${this.challengeId}/files`);
    if (!resp.ok) return;
    const tree: FileNode[] = await resp.json();
    this._renderFileTree(tree);

    if (!this.activeFilePath) {
      const first = this._findFirstFile(tree);
      if (first) {
        await this._openFile(first.path, "js");
      } else {
        // Empty solution folder — seed with the challenge-specific template if available,
        // falling back to the generic default script for non-tutorial challenges.
        const seedContent = await this._fetchChallengeTemplate() ?? DEFAULT_SCRIPT;
        await this._createFileJS("solution.js", seedContent);
        const r2 = await fetch(`/api/challenge/${this.challengeId}/files`);
        if (r2.ok) {
          const tree2: FileNode[] = await r2.json();
          this._renderFileTree(tree2);
          const f = this._findFirstFile(tree2);
          if (f) await this._openFile(f.path, "js");
        }
      }
    } else {
      // Re-open the previously active JS file
      const existing = this.openFiles.get(this.activeFilePath);
      if (existing) {
        this._updateTabs();
        this._updateEditor();
        this._updateTreeActive();
      }
    }
  }

  /** Fetch the challenge-specific JS template from the engine, if one exists. */
  private async _fetchChallengeTemplate(): Promise<string | null> {
    if (!this.challengeId) return null;
    try {
      const resp = await fetch(`/api/challenge/${this.challengeId}/template`);
      if (!resp.ok) return null;
      return await resp.text();
    } catch {
      return null;
    }
  }

  // ── File loading — Solidity mode ─────────────────────────────────────────────

  private async _loadSolFiles(): Promise<void> {
    if (!this.challengeId) {
      this.fileTreeEl.innerHTML = `<div class="ide-empty-msg" style="padding:8px;font-size:11px;color:#6e7681">No challenge selected</div>`;
      this._showEmptyState();
      return;
    }
    const resp = await fetch(`/api/solve/files?challenge=${encodeURIComponent(this.challengeId)}`);
    if (!resp.ok) {
      this.fileTreeEl.innerHTML = `<div class="ide-empty-msg" style="padding:8px;font-size:11px;color:#6e7681">Could not load workspace</div>`;
      this._showEmptyState();
      return;
    }
    const tree: FileNode[] = await resp.json();
    this._renderFileTree(tree);

    // Try to re-open the previously active sol file if any
    const existing = this.activeFilePath ? this.openFiles.get(this.activeFilePath) : null;
    if (existing?.mode === "sol") {
      this._updateTabs();
      this._updateEditor();
      this._updateTreeActive();
    } else {
      // Auto-open first .s.sol or first .sol (prefer non-lib files)
      const first = this._findFirstSolFile(tree) ?? this._findFirstNonReadOnlyFile(tree) ?? this._findFirstFile(tree);
      if (first) {
        await this._openFile(first.path, "sol", first.readOnly ?? false);
      } else {
        this._showEmptyState("No Solidity files yet — create one to get started");
        this._updateTabs();
      }
    }
  }

  private _findFirstFile(nodes: FileNode[]): FileNode | null {
    for (const n of nodes) {
      if (this._isDir(n)) {
        if (n.children) {
          const f = this._findFirstFile(n.children);
          if (f) return f;
        }
      } else {
        return n;
      }
    }
    return null;
  }

  private _findFirstNonReadOnlyFile(nodes: FileNode[]): FileNode | null {
    for (const n of nodes) {
      if (this._isDir(n)) {
        if (!n.readOnly && n.children) {
          const f = this._findFirstNonReadOnlyFile(n.children);
          if (f) return f;
        }
      } else if (!n.readOnly) {
        return n;
      }
    }
    return null;
  }

  private _findFirstSolFile(nodes: FileNode[]): FileNode | null {
    // Prefer script/ directory first (skip read-only lib/)
    for (const n of nodes) {
      if (this._isDir(n) && n.name === "script" && !n.readOnly && n.children) {
        const f = this._findFirstFile(n.children);
        if (f) return f;
      }
    }
    // Then src/
    for (const n of nodes) {
      if (this._isDir(n) && n.name === "src" && !n.readOnly && n.children) {
        const f = this._findFirstFile(n.children);
        if (f) return f;
      }
    }
    // Then any non-lib, non-readOnly top-level .sol file
    for (const n of nodes) {
      if (!this._isDir(n) && !n.readOnly) return n;
    }
    return null;
  }

  private _isDir(n: FileNode): boolean {
    // Support both API shapes
    return n.isDir === true || n.type === "dir";
  }

  // ── File tree rendering ─────────────────────────────────────────────────────

  private _renderFileTree(tree: FileNode[]): void {
    this.fileTreeEl.innerHTML = "";
    this._renderNodes(tree, this.fileTreeEl, 0);
  }

  private _renderNodes(nodes: FileNode[], parent: HTMLElement, depth: number): void {
    for (const node of nodes) {
      if (this._isDir(node)) {
        const wrap = document.createElement("div");
        wrap.className = "ide-tree-dir-wrap";

        const header = document.createElement("div");
        header.className = "ide-tree-item ide-tree-dir" + (node.readOnly ? " ide-tree-readonly" : "");
        header.style.paddingLeft = `${8 + depth * 14}px`;

        if (node.readOnly) {
          header.innerHTML = `
            <span class="ide-tree-icon">&#9662;</span>
            <span class="ide-tree-name">${this._esc(node.name)}</span>
            <span class="ide-tree-badge ide-readonly-badge" title="Read-only">&#128274;</span>
          `;
        } else {
          header.innerHTML = `
            <span class="ide-tree-icon">&#9662;</span>
            <span class="ide-tree-name">${this._esc(node.name)}</span>
            <span class="ide-tree-actions">
              <button class="ide-icon-btn" title="New file here">+</button>
              <button class="ide-icon-btn ide-del-btn" title="Delete folder">&times;</button>
            </span>
          `;
        }

        const children = document.createElement("div");
        children.className = "ide-tree-children";

        let collapsed = false;
        header.addEventListener("click", (e) => {
          if ((e.target as HTMLElement).closest(".ide-tree-actions")) return;
          collapsed = !collapsed;
          children.style.display = collapsed ? "none" : "";
          header.querySelector<HTMLElement>(".ide-tree-icon")!.textContent = collapsed ? "▸" : "▾";
        });

        if (!node.readOnly) {
          const [addBtn, delBtn] = header.querySelectorAll<HTMLButtonElement>(".ide-icon-btn");
          addBtn.addEventListener("click", (e) => { e.stopPropagation(); this._promptNewFile(node.path); });
          delBtn.addEventListener("click", (e) => { e.stopPropagation(); this._confirmDelete(node.path, true); });
        }

        if (node.children) this._renderNodes(node.children, children, depth + 1);

        wrap.appendChild(header);
        wrap.appendChild(children);
        parent.appendChild(wrap);
      } else {
        const item = document.createElement("div");
        item.className = "ide-tree-item ide-tree-file" +
          (node.path === this.activeFilePath ? " active" : "") +
          (node.readOnly ? " ide-file-readonly" : "");
        item.dataset.path = node.path;
        item.style.paddingLeft = `${8 + depth * 14}px`;

        if (node.readOnly) {
          item.innerHTML = `
            <span class="ide-tree-icon ide-file-icon">&#9702;</span>
            <span class="ide-tree-name">${this._esc(node.name)}</span>
            <span class="ide-tree-badge ide-readonly-badge" title="Read-only">&#128274;</span>
          `;
        } else {
          item.innerHTML = `
            <span class="ide-tree-icon ide-file-icon">&#9702;</span>
            <span class="ide-tree-name">${this._esc(node.name)}</span>
            <span class="ide-tree-actions">
              <button class="ide-icon-btn ide-del-btn" title="Delete file">&times;</button>
            </span>
          `;
        }

        item.addEventListener("click", (e) => {
          if ((e.target as HTMLElement).closest(".ide-tree-actions")) return;
          this._openFile(node.path, this._mode, node.readOnly ?? false);
        });

        if (!node.readOnly) {
          item.querySelector<HTMLButtonElement>(".ide-del-btn")!.addEventListener("click", (e) => {
            e.stopPropagation();
            this._confirmDelete(node.path, false);
          });
        }

        parent.appendChild(item);
      }
    }
  }

  private _updateTreeActive(): void {
    this.fileTreeEl.querySelectorAll<HTMLElement>(".ide-tree-file").forEach(el => {
      el.classList.toggle("active", el.dataset.path === this.activeFilePath);
    });
  }

  // ── File opening & editor ────────────────────────────────────────────────────

  private async _openFile(path: string, mode: WorkspaceMode, readOnly = false): Promise<void> {
    // Snapshot current editor content before switching away
    if (this.activeFilePath && this.view) {
      this.contentCache.set(this.activeFilePath, this.view.state.doc.toString());
    }

    // Fetch from backend if not already loaded
    if (!this.openFiles.has(path)) {
      let url: string;
      if (mode === "js") {
        url = `/api/challenge/${this.challengeId}/file?path=${encodeURIComponent(path)}`;
      } else {
        url = `/api/solve/file?challenge=${encodeURIComponent(this.challengeId)}&path=${encodeURIComponent(path)}`;
      }
      const resp = await fetch(url);
      if (!resp.ok) return;
      const content = await resp.text();
      this.openFiles.set(path, { path, savedContent: content, mode, readOnly });
      if (!this.contentCache.has(path)) this.contentCache.set(path, content);
    }

    this.activeFilePath = path;
    this._updateTabs();
    this._updateEditor();
    this._updateTreeActive();
    if (this._mode === "sol") this._updateSolButtons();
  }

  private _updateEditor(): void {
    const file = this.openFiles.get(this.activeFilePath);
    if (!file) { this._showEmptyState(); return; }

    const content = this.contentCache.get(this.activeFilePath) ?? file.savedContent;
    const isReadOnly = file.readOnly ?? false;

    this.emptyStateEl.style.display = "none";
    this.editorWrapEl.style.display = "";

    const extensions = this._editorExtensions(this.activeFilePath, isReadOnly);

    // Detect if language needs to change (JS ↔ Solidity) or readOnly state changed
    // — if so, destroy and recreate
    const prevIsSol = this._lastEditorWasSol ?? false;
    const nowIsSol  = this.activeFilePath.endsWith(".sol");
    const langChanged = prevIsSol !== nowIsSol;
    const prevReadOnly = this._lastEditorReadOnly ?? false;
    const readOnlyChanged = prevReadOnly !== isReadOnly;

    if (!this.view || langChanged || readOnlyChanged) {
      if (this.view) {
        this.view.destroy();
        this.view = null;
      }
      this._lastEditorWasSol = nowIsSol;
      this._lastEditorReadOnly = isReadOnly;
      const state = EditorState.create({ doc: content, extensions });
      this.view = new EditorView({ state, parent: this.editorWrapEl });
    } else {
      this._switching = true;
      this.view.dispatch({
        changes: { from: 0, to: this.view.state.doc.length, insert: content },
        selection: { anchor: 0 },
        scrollIntoView: true,
      });
      this._switching = false;
    }

    this._updateSaveBtn();
  }

  private _editorExtensions(path: string, readOnly = false) {
    const isSolFile = path.endsWith(".sol");
    const lang = isSolFile ? solidity : javascript();

    // Custom keymap — placed before defaultKeymap so our bindings take precedence
    const ideKeymap = keymap.of([
      // Toggle comment: Ctrl+/ (Win/Linux) or Cmd+/ (Mac)
      { key: "Ctrl-/",     run: toggleComment },
      { key: "Mod-/",      run: toggleComment },
      // Indent/unindent with Ctrl+] / Ctrl+[
      { key: "Ctrl-]",     run: indentMore },
      { key: "Mod-]",      run: indentMore },
      { key: "Ctrl-[",     run: indentLess },
      { key: "Mod-[",      run: indentLess },
      // Select all
      { key: "Ctrl-a",     run: selectAll },
      { key: "Mod-a",      run: selectAll },
      // Undo/redo
      { key: "Ctrl-z",     run: undo },
      { key: "Mod-z",      run: undo },
      { key: "Ctrl-Shift-z", run: redo },
      { key: "Mod-Shift-z",  run: redo },
    ]);

    const exts = [
      lineNumbers(),
      highlightActiveLine(),
      lang,
      // @replit/codemirror-lang-solidity doesn't register commentTokens, so
      // toggleComment has no prefix to use. Provide it explicitly for .sol files.
      ...(isSolFile ? [solidity.language.data.of({ commentTokens: { line: "//" } })] : []),
      oneDark,
      ideKeymap,
      // Tab key → indent; Shift+Tab → unindent
      keymap.of([indentWithTab]),
      keymap.of(defaultKeymap),
      EditorView.theme({
        "&": { height: "100%", fontSize: "13px", fontFamily: "monospace" },
        ".cm-scroller": { overflow: "auto" },
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !this._switching && this.activeFilePath) {
          const current = update.state.doc.toString();
          this.contentCache.set(this.activeFilePath, current);
          const file = this.openFiles.get(this.activeFilePath);
          const isDirty = file ? current !== file.savedContent : false;
          this._setTabDirty(this.activeFilePath, isDirty);
          this._updateSaveBtn();
        }
      }),
    ];

    if (readOnly) {
      exts.push(EditorState.readOnly.of(true));
    }

    return exts;
  }

  private _showEmptyState(message?: string): void {
    this.editorWrapEl.style.display = "none";
    this.emptyStateEl.style.display = "";
    if (message) {
      const sub = this.emptyStateEl.querySelector<HTMLElement>(".ide-empty-sub");
      if (sub) sub.textContent = message;
    } else {
      const sub = this.emptyStateEl.querySelector<HTMLElement>(".ide-empty-sub");
      if (sub) sub.textContent = "Select a file from the tree, or click + to create one";
    }
    this._updateSaveBtn();
    if (this._mode === "sol") this._updateSolButtons();
  }

  // ── Tabs ────────────────────────────────────────────────────────────────────

  private _updateTabs(): void {
    this.tabBarEl.innerHTML = "";
    for (const [path, file] of this.openFiles) {
      // Only show tabs for the current mode
      if (file.mode !== this._mode) continue;

      const current  = this.contentCache.get(path) ?? file.savedContent;
      const isDirty  = current !== file.savedContent;
      const name     = path.split("/").pop() ?? path;
      const isActive = path === this.activeFilePath;

      const tab = document.createElement("div");
      tab.className = "ide-tab" + (isActive ? " active" : "");
      tab.dataset.path = path;
      tab.innerHTML = `
        <span class="ide-tab-dirty" style="display:${isDirty ? "inline" : "none"}" title="Unsaved changes">&#9679;</span>
        <span class="ide-tab-name">${this._esc(name)}</span>
        <button class="ide-tab-close" title="Close tab">&times;</button>
      `;

      tab.querySelector(".ide-tab-close")!.addEventListener("click", (e) => {
        e.stopPropagation();
        this._closeTab(path);
      });
      tab.addEventListener("click", () => this._openFile(path, this._mode));
      this.tabBarEl.appendChild(tab);
    }
  }

  private _setTabDirty(path: string, isDirty: boolean): void {
    const tab = this.tabBarEl.querySelector<HTMLElement>(`[data-path="${path}"]`);
    if (!tab) return;
    const dot = tab.querySelector<HTMLElement>(".ide-tab-dirty");
    if (dot) dot.style.display = isDirty ? "inline" : "none";
  }

  private _closeTab(path: string): void {
    const file = this.openFiles.get(path);
    if (file) {
      const current = this.contentCache.get(path) ?? file.savedContent;
      if (current !== file.savedContent) {
        if (!confirm(`"${path.split("/").pop()}" has unsaved changes. Close anyway?`)) return;
      }
    }
    this.openFiles.delete(path);
    this.contentCache.delete(path);

    if (this.activeFilePath === path) {
      this.activeFilePath = "";
      const remaining = [...this.openFiles.entries()]
        .filter(([, f]) => f.mode === this._mode)
        .map(([p]) => p);
      if (remaining.length > 0) {
        this._openFile(remaining[remaining.length - 1], this._mode);
        return;
      }
      this._showEmptyState();
    }
    this._updateTabs();
  }

  // ── Save button ──────────────────────────────────────────────────────────────

  private _updateSaveBtn(): void {
    if (!this.activeFilePath) {
      this.saveBtnEl.disabled = true;
      this.saveBtnEl.classList.remove("ide-save-unsaved");
      this.saveBtnEl.textContent = "💾 Save";
      return;
    }
    const file = this.openFiles.get(this.activeFilePath);
    if (!file) { this.saveBtnEl.disabled = true; return; }
    if (file.readOnly) {
      this.saveBtnEl.disabled = true;
      this.saveBtnEl.classList.remove("ide-save-unsaved");
      this.saveBtnEl.textContent = "💾 Save";
      this.saveBtnEl.title = "Read-only file — cannot save";
      return;
    }
    const current  = this.contentCache.get(this.activeFilePath) ?? file.savedContent;
    const isDirty  = current !== file.savedContent;
    this.saveBtnEl.disabled = false;
    this.saveBtnEl.classList.toggle("ide-save-unsaved", isDirty);
    this.saveBtnEl.textContent = isDirty ? "💾 Save ●" : "💾 Save";
    this.saveBtnEl.title = isDirty ? "Unsaved changes — Save (Ctrl+S)" : "Save (Ctrl+S)";
  }

  // ── Actions ──────────────────────────────────────────────────────────────────

  private async _saveCurrentFile(): Promise<void> {
    if (!this.activeFilePath) return;
    const file = this.openFiles.get(this.activeFilePath);
    if (!file) return;

    if (file.readOnly) {
      // Show a brief notification instead of silently failing
      const origText = this.saveBtnEl.textContent;
      this.saveBtnEl.textContent = "Read-only";
      setTimeout(() => { this.saveBtnEl.textContent = origText; }, 1500);
      return;
    }

    const content = this.view
      ? this.view.state.doc.toString()
      : (this.contentCache.get(this.activeFilePath) ?? "");

    let url: string;
    let body: object;
    if (file.mode === "js") {
      if (!this.challengeId) return;
      url = `/api/challenge/${this.challengeId}/file`;
      body = { path: this.activeFilePath, content };
    } else {
      url = "/api/solve/file";
      body = { challenge: this.challengeId, path: this.activeFilePath, content };
    }

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (resp.ok) {
      file.savedContent = content;
      this._setTabDirty(this.activeFilePath, false);
      this._updateSaveBtn();
    }
  }

  // JS mode run (unchanged behavior)
  private async _runScript(): Promise<void> {
    await this._saveCurrentFile();
    const content = this.view
      ? this.view.state.doc.toString()
      : (this.contentCache.get(this.activeFilePath) ?? "");
    if (content) this.ws.send("script_run", { source: content });
  }

  // Solidity mode — run script
  private async _forgeRunScript(): Promise<void> {
    await this._saveCurrentFile();
    this.forgeLogEl.innerHTML = "";
    this._forgeRunning = true;
    this._updateSolButtons();
    // scriptPath is relative to the challenge's solve dir; include challengeId so the
    // WS server can prefix it to form "challenges/<id>/<path>" relative to SOLVE_DIR.
    this.ws.send("forge_script_run", {
      scriptPath: this.activeFilePath,
      challengeId: this.challengeId,
    });
  }

  // Solidity mode — deploy
  private async _forgeDeploy(): Promise<void> {
    await this._saveCurrentFile();
    const contractName = this.activeFilePath.split("/").pop()?.replace(/\.sol$/, "") ?? "";
    this.forgeLogEl.innerHTML = "";
    this._forgeRunning = true;
    this._updateSolButtons();
    // contractPath is relative to the challenge's solve dir; include challengeId so the
    // WS server can prefix it to form "challenges/<id>/<path>" relative to SOLVE_DIR.
    this.ws.send("forge_deploy", {
      contractPath: this.activeFilePath,
      contractName,
      challengeId: this.challengeId,
    });
  }

  private _popOut(): void {
    if (!this.challengeId) return;
    const url = `${location.origin}/?view=ide&challenge=${encodeURIComponent(this.challengeId)}`;
    window.open(url, `ide-${this.challengeId}`, "width=1100,height=750,menubar=no,toolbar=no,status=no");
  }

  // ── File CRUD ────────────────────────────────────────────────────────────────

  private async _promptNewFile(dirPath: string): Promise<void> {
    const label = dirPath ? `New file in "${dirPath.split("/").pop()}":` : "New file name:";
    const defaultName = this._mode === "sol" ? "MyContract.sol" : "solution.js";
    const name = prompt(label, defaultName);
    if (!name?.trim()) return;
    const fullPath = dirPath ? `${dirPath}/${name.trim()}` : name.trim();
    await this._createFile(fullPath, "");

    if (this._mode === "js") {
      const resp = await fetch(`/api/challenge/${this.challengeId}/files`);
      if (resp.ok) this._renderFileTree(await resp.json());
    } else {
      const resp = await fetch(`/api/solve/files?challenge=${encodeURIComponent(this.challengeId)}`);
      if (resp.ok) this._renderFileTree(await resp.json());
    }
    await this._openFile(fullPath, this._mode);
  }

  private async _createFile(path: string, content: string): Promise<void> {
    if (this._mode === "js") {
      await this._createFileJS(path, content);
    } else {
      await fetch("/api/solve/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge: this.challengeId, path, content }),
      });
    }
  }

  private async _createFileJS(path: string, content: string): Promise<void> {
    await fetch(`/api/challenge/${this.challengeId}/file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    });
  }

  private async _confirmDelete(path: string, isDir: boolean): Promise<void> {
    const name = path.split("/").pop();
    const msg  = isDir
      ? `Delete folder "${name}" and all its contents?`
      : `Delete "${name}"?`;
    if (!confirm(msg)) return;

    if (this._mode === "js") {
      await fetch(`/api/challenge/${this.challengeId}/file?path=${encodeURIComponent(path)}`, {
        method: "DELETE",
      });
    } else {
      await fetch(`/api/solve/file?challenge=${encodeURIComponent(this.challengeId)}&path=${encodeURIComponent(path)}`, {
        method: "DELETE",
      });
    }

    // Close any open tab for this path (or paths inside this dir)
    for (const p of [...this.openFiles.keys()]) {
      if (p === path || p.startsWith(path + "/")) {
        this.openFiles.delete(p);
        this.contentCache.delete(p);
        if (this.activeFilePath === p) {
          this.activeFilePath = "";
        }
      }
    }

    const modeFiles = [...this.openFiles.entries()].filter(([, f]) => f.mode === this._mode);
    if (!this.activeFilePath && modeFiles.length > 0) {
      await this._openFile(modeFiles[modeFiles.length - 1][0], this._mode);
    } else if (!this.activeFilePath) {
      this._showEmptyState();
    }
    this._updateTabs();

    if (this._mode === "js") {
      const resp = await fetch(`/api/challenge/${this.challengeId}/files`);
      if (resp.ok) this._renderFileTree(await resp.json());
    } else {
      const resp = await fetch(`/api/solve/files?challenge=${encodeURIComponent(this.challengeId)}`);
      if (resp.ok) this._renderFileTree(await resp.json());
    }
  }

  // ── Utilities ────────────────────────────────────────────────────────────────

  private _esc(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}
