import "./styles.css";
import { WSClient } from "./ws/WSClient.js";
import { ChartGrid } from "./panels/ChartGrid.js";
import { ControlPanel } from "./panels/ControlPanel.js";
import { ProgressPanel } from "./panels/ProgressPanel.js";
import { PoolDepthPanel } from "./panels/PoolDepthPanel.js";
import { TriggerPanel } from "./panels/TriggerPanel.js";
import { IdePanel } from "./panels/IdePanel.js";
import { NFTPanel } from "./panels/NFTPanel.js";
import { ManualTradePanel } from "./panels/ManualTradePanel.js";
import { BlockExplorerPanel } from "./panels/BlockExplorerPanel.js";
import { LandingPage } from "./panels/LandingPage.js";
import { TutorialPanel } from "./panels/TutorialPanel.js";
import { TutorialOverlay } from "./panels/TutorialOverlay.js";
import { DocsPanel } from "./panels/DocsPanel.js";
import { markSolved } from "./lib/progress.js";

const WS_URL = `ws://${location.host}/ws`;
const app    = document.getElementById("app")!;
const _params = new URLSearchParams(location.search);
const _ideMode = _params.get("view") === "ide";
const _tutorialMode = _params.get("view") === "tutorial";

// ── IDE popup-window mode ─────────────────────────────────────────────────────
// Opened via the ⤢ button: /?view=ide&challenge=<id>
// Renders only the IDE panel in full-screen with its own WS connection.

if (_ideMode) {
  const ws    = new WSClient(WS_URL);
  const view  = document.createElement("div");
  view.id     = "ide-view";
  app.appendChild(view);
  const panel = document.createElement("div");
  panel.className = "panel script-panel";
  view.appendChild(panel);
  const ide   = new IdePanel(panel, ws);
  const ch    = _params.get("challenge") ?? "";
  if (ch) ide.setChallenge(ch);
  document.title = `defi-ctf IDE${ch ? ` — ${ch}` : ""}`;
}

// ── Normal game mode ──────────────────────────────────────────────────────────

if (!_ideMode) {

const ws = new WSClient(WS_URL);

// ── Build the game (CTF) view ─────────────────────────────────────────────────

const gameEl = document.createElement("div");
gameEl.id = "game-view";
gameEl.innerHTML = `
  <div class="layout">
    <header class="topbar">
      <button class="home-btn" id="home-btn" title="Back to challenges">⛓ defi-ctf</button>
      <nav class="game-tabs" id="game-tabs">
        <button class="game-tab active" data-tab="trading">Trading</button>
        <button class="game-tab" data-tab="explorer">Explorer</button>
        <button class="game-tab" data-tab="nft" id="nft-tab-btn" style="display:none">NFT</button>
        <button class="game-tab" data-tab="docs">Docs</button>
      </nav>
      <div class="topbar-right" id="trading-topbar-controls">
        <span class="ctrl-label" style="color:#6e7681;font-size:11px;">SPLIT</span>
        <button class="chart-btn split-btn active" data-split="1">1×</button>
        <button class="chart-btn split-btn" data-split="2">2×</button>
        <button class="chart-btn split-btn" data-split="4">4×</button>
        <div id="conn-status" class="conn-badge conn-connecting">connecting…</div>
      </div>
      <div id="conn-status-explorer" class="conn-badge conn-connecting be-conn-badge" style="display:none">connecting…</div>
    </header>
    <div class="tab-content" id="tab-trading">
      <div class="main">
        <aside class="sidebar left-sidebar">
          <div id="control-panel" class="panel"></div>
          <div id="progress-panel" class="panel"></div>
          <div id="depth-panel" class="panel"></div>
          <div id="manual-trade-panel" class="panel"></div>
        </aside>
        <section class="chart-area">
          <div id="chart-grid"></div>
        </section>
        <div class="resize-handle" id="sidebar-resize" title="Drag to resize"></div>
        <aside class="sidebar right-sidebar" id="right-sidebar">
          <div id="trigger-panel" class="panel trigger-panel"></div>
          <div id="script-panel" class="panel script-panel"></div>
        </aside>
      </div>
    </div>
    <div class="tab-content tab-content-hidden" id="tab-explorer">
      <div id="explorer-panel" class="be-full-panel"></div>
    </div>
    <div class="tab-content tab-content-hidden" id="tab-nft">
      <div id="nft-panel" class="nft-tab-container"></div>
    </div>
    <div class="tab-content tab-content-hidden" id="tab-docs">
      <div id="docs-panel" class="docs-tab-container"></div>
    </div>
  </div>
`;
// Result overlay (win / lose) — injected into gameEl so it's scoped to the game view
gameEl.insertAdjacentHTML("beforeend", `
  <div id="result-overlay" class="result-overlay hidden">
    <div id="result-card" class="result-card">
      <div id="result-icon"  class="result-icon"></div>
      <div id="result-title" class="result-title"></div>
      <div id="result-stats" class="result-stats"></div>
      <button id="result-dismiss" class="btn btn-secondary result-dismiss-btn">Dismiss</button>
    </div>
  </div>
`);
app.appendChild(gameEl);

// ── Build the landing view ────────────────────────────────────────────────────

const landingEl = document.createElement("div");
landingEl.id = "landing-view";
app.appendChild(landingEl);

// ── Build the tutorial view ───────────────────────────────────────────────────

const tutorialEl = document.createElement("div");
tutorialEl.id = "tutorial-view";
app.appendChild(tutorialEl);

let selectedChallengeId = "";
let knownPairs: string[] = [];
// Track the last-seen challenge status so the `challenge` WS handler only
// performs destructive resets on genuine state *transitions*, not on every
// per-block broadcast that happens while a challenge is already running.
let _lastChallengeStatus = "";
let _lastChallengeId     = "";
let challengesCache: Array<{
  id:           string;
  name:         string;
  description:  string;
  category:     string | null;
  difficulty:   string | null;
  tags:         string[];
  hasNft:       boolean;
  blockCount:   number;
  metric:       string;
  target:       string;
  startingValue: string;
  pools: Array<{ id: string; tokenA: string; tokenB: string; exchange: string; displayName: string }>;
}> = [];

// ── View switching ────────────────────────────────────────────────────────────

function showGame(challengeId?: string) {
  landingEl.style.display  = "none";
  tutorialEl.style.display = "none";
  gameEl.style.display     = "flex";
  if (challengeId) {
    const isNewChallenge = challengeId !== selectedChallengeId;
    selectedChallengeId = challengeId;
    controlPanel.setSelectedChallenge(challengeId);
    const pairs = _pairOptionsForChallenge(challengeId);
    chartGrid.updatePairs(pairs);
    manualTradePanel.updatePools(_poolOptionsForChallenge(challengeId));
    idePanel.setChallenge(challengeId);

    // If a different challenge is currently running, stop it so the engine
    // resets cleanly. The user will see the new challenge's view in its idle /
    // ready state and can manually click Start when they are ready.
    const currentlyActive =
      _lastChallengeStatus === "running" ||
      _lastChallengeStatus === "paused"  ||
      _lastChallengeStatus === "fast_forward";

    if (currentlyActive && _lastChallengeId !== challengeId) {
      // Stop the currently-running challenge. No auto-start is queued; the
      // user will initiate the new challenge themselves via the Start button.
      ws.send("challenge_stop", {});
    }
    // If the same challenge is already running, just switch to game view — no restart.

    // Notify the engine that a new challenge has been selected so it can clear
    // stale triggers from the previous challenge. We only do this when the
    // challenge actually changes — not on every re-render of the same one.
    if (isNewChallenge) {
      ws.send("challenge_select", { challengeId });
    }

    // Notify the tutorial overlay so it can show/hide its bubbles
    tutorialOverlay.setChallenge(challengeId);
  }
  // Apply any tutorial snippet waiting in localStorage
  _applyTutorialSnippet();
}

function showLanding() {
  gameEl.style.display     = "none";
  tutorialEl.style.display = "none";
  landingEl.style.display  = "block";
  tutorialOverlay.destroy();
  // Reflect the current engine state in the challenge list: if a challenge is
  // still running/paused, its card should show "Resume" instead of "Play".
  const isActive =
    _lastChallengeStatus === "running" ||
    _lastChallengeStatus === "paused"  ||
    _lastChallengeStatus === "fast_forward";
  landingPage.setActiveChallenge(isActive ? _lastChallengeId : "");
}

function showTutorial() {
  gameEl.style.display     = "none";
  landingEl.style.display  = "none";
  tutorialEl.style.display = "block";
  // Re-mount tutorial panel each time (lightweight)
  new TutorialPanel(
    tutorialEl,
    /* onBack */ () => showLanding(),
    /* onGoGame */ (snippet) => {
      // snippet already stored in localStorage by TutorialPanel; navigate to game
      showGame();
    },
  );
}

/** Check localStorage for a tutorial code snippet and load it into the IDE. */
function _applyTutorialSnippet(): void {
  const raw = localStorage.getItem("tutorial_snippet");
  if (!raw) return;
  try {
    const { code, mode, filePath } = JSON.parse(raw) as {
      code: string; mode: "js" | "sol"; filePath?: string;
    };
    localStorage.removeItem("tutorial_snippet");
    if (mode === "js") {
      idePanel.loadJsSnippet(code);
    } else if (mode === "sol" && filePath) {
      idePanel.loadSolSnippet(filePath, code).catch(console.error);
    }
  } catch {
    localStorage.removeItem("tutorial_snippet");
  }
}

// ── Tab switching ─────────────────────────────────────────────────────────────

const tabTrading  = gameEl.querySelector<HTMLElement>("#tab-trading")!;
const tabExplorer = gameEl.querySelector<HTMLElement>("#tab-explorer")!;
const tabNft      = gameEl.querySelector<HTMLElement>("#tab-nft")!;
const tabDocs     = gameEl.querySelector<HTMLElement>("#tab-docs")!;
const tradingTopbarControls = gameEl.querySelector<HTMLElement>("#trading-topbar-controls")!;
const connStatusExplorer    = gameEl.querySelector<HTMLElement>("#conn-status-explorer")!;

gameEl.querySelectorAll<HTMLButtonElement>(".game-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    gameEl.querySelectorAll(".game-tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    tabTrading.classList.add("tab-content-hidden");
    tabExplorer.classList.add("tab-content-hidden");
    tabNft.classList.add("tab-content-hidden");
    tabDocs.classList.add("tab-content-hidden");
    tradingTopbarControls.style.display = "none";
    connStatusExplorer.style.display = "none";
    if (tab === "trading") {
      tabTrading.classList.remove("tab-content-hidden");
      tradingTopbarControls.style.display = "";
    } else if (tab === "explorer") {
      tabExplorer.classList.remove("tab-content-hidden");
      connStatusExplorer.style.display = "";
    } else if (tab === "nft") {
      tabNft.classList.remove("tab-content-hidden");
    } else if (tab === "docs") {
      tabDocs.classList.remove("tab-content-hidden");
    }
  });
});

// ── Initialise game panels (done once, since game DOM never re-creates) ───────

const chartGrid = new ChartGrid(gameEl.querySelector("#chart-grid")!, ws);

const controlPanel = new ControlPanel(gameEl.querySelector("#control-panel")!, ws, showLanding);
new ProgressPanel(gameEl.querySelector("#progress-panel")!, ws);
new PoolDepthPanel(gameEl.querySelector("#depth-panel")!, ws);
new TriggerPanel(gameEl.querySelector("#trigger-panel")!, ws);
const idePanel  = new IdePanel(gameEl.querySelector("#script-panel")!, ws);
const manualTradePanel = new ManualTradePanel(gameEl.querySelector("#manual-trade-panel")!, ws);
const nftPanelEl = gameEl.querySelector<HTMLElement>("#nft-panel")!;
const nftPanel   = new NFTPanel(nftPanelEl, ws);
const nftTabBtn  = gameEl.querySelector<HTMLButtonElement>("#nft-tab-btn")!;
const explorerPanel = new BlockExplorerPanel(gameEl.querySelector("#explorer-panel")!, ws);
new DocsPanel(gameEl.querySelector("#docs-panel")!);
const tutorialOverlay = new TutorialOverlay();

nftPanel.setOpenExplorerTx((txHash) => {
  gameEl.querySelector<HTMLButtonElement>(".game-tab[data-tab=\"explorer\"]")?.click();
  explorerPanel.highlightTx(txHash);
});

// ── Initialise landing page ───────────────────────────────────────────────────

const landingPage = new LandingPage(
  landingEl,
  (challengeId) => showGame(challengeId),
  () => showTutorial(),
);

// Initial route: full landing, or game shell only (no auto-start). `#game` is used by tests and deep-links.
if (_tutorialMode) {
  showTutorial();
} else if (location.hash === "#game") {
  showGame();
} else {
  showLanding();
}

// ── Home button ───────────────────────────────────────────────────────────────

gameEl.querySelector("#home-btn")!.addEventListener("click", showLanding);

// ── Split view buttons ────────────────────────────────────────────────────────

gameEl.querySelectorAll<HTMLButtonElement>(".split-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    gameEl.querySelectorAll(".split-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const n = parseInt(btn.dataset.split!) as 1 | 2 | 4;
    chartGrid.setLayout(n);
  });
});

// ── Connection status ─────────────────────────────────────────────────────────

ws.on("__connected", () => {
  const el = gameEl.querySelector<HTMLElement>("#conn-status")!;
  el.textContent = "connected";
  el.className = "conn-badge conn-ok";
  connStatusExplorer.textContent = "connected";
  connStatusExplorer.className = "conn-badge conn-ok be-conn-badge";
  ws.send("get_challenges", {});
});
ws.on("__disconnected", () => {
  const el = gameEl.querySelector<HTMLElement>("#conn-status")!;
  el.textContent = "disconnected";
  el.className = "conn-badge conn-error";
  connStatusExplorer.textContent = "disconnected";
  connStatusExplorer.className = "conn-badge conn-error be-conn-badge";
});

// ── Pool metadata (exchange info) ─────────────────────────────────────────────

interface PoolMeta { exchange: string; displayName: string; tokenA: string; tokenB: string; }
const poolMeta = new Map<string, PoolMeta>();

ws.on("challenges", (raw) => {
  const list = (Array.isArray(raw) ? raw : (raw as any).challenges ?? []) as Array<{
    id:           string;
    name:         string;
    description:  string;
    category:     string | null;
    difficulty:   string | null;
    tags:         string[];
    hasNft:       boolean;
    blockCount:   number;
    metric:       string;
    target:       string;
    startingValue: string;
    pools: Array<{ id: string; tokenA: string; tokenB: string; exchange: string; displayName: string }>;
  }>;
  challengesCache = list;
  if (!selectedChallengeId && list.length > 0) {
    selectedChallengeId = list[0].id;
    controlPanel.setSelectedChallenge(selectedChallengeId);
    idePanel.setChallenge(selectedChallengeId);
  }
  for (const c of list) {
    for (const p of c.pools ?? []) {
      poolMeta.set(p.id, {
        exchange:    p.exchange    ?? "unknown",
        displayName: p.displayName ?? "DEX",
        tokenA:      p.tokenA,
        tokenB:      p.tokenB,
      });
    }
  }
  if (selectedChallengeId) {
    chartGrid.updatePairs(_pairOptionsForChallenge(selectedChallengeId));
    manualTradePanel.updatePools(_poolOptionsForChallenge(selectedChallengeId));
  }

  // If a challenge is already running (connected mid-session), re-evaluate NFT panel
  // now that the cache is populated with hasNft flags.
  if (_lastChallengeStatus === "running" && _lastChallengeId) {
    _updateNftPanel(_lastChallengeId, true);
  }
});

// ── Pair management for chart dropdowns ───────────────────────────────────────

ws.on("price", (raw) => {
  const p = raw as { pair: string; price: number };
  if (!knownPairs.includes(p.pair)) {
    knownPairs.push(p.pair);
    chartGrid.updatePairs(_pairOptionsForKnownPairs());
  }
});

ws.on("challenge", (raw) => {
  const s = raw as { id?: string; status: string };

  // Detect genuine state transitions. The engine broadcasts `challenge` every
  // block while a challenge is running, so we must gate destructive side-effects
  // (chart reset, knownPairs flush) on status *changes*, not every message.
  const statusChanged    = s.status !== _lastChallengeStatus;
  const challengeChanged = !!s.id && s.id !== _lastChallengeId;
  _lastChallengeStatus   = s.status;
  if (s.id) _lastChallengeId = s.id;

  if (s.status === "running" && (statusChanged || challengeChanged)) {
    if (s.id) selectedChallengeId = s.id;
    knownPairs = [];
    // Reset chart panels so old challenge data doesn't bleed into the new one (Issue #26).
    // Guard: only on genuine start transition — not on the per-block re-broadcast —
    // to prevent the chart from flashing and dropdowns from resetting every tick.
    chartGrid.resetForNewChallenge(_pairOptionsForChallenge(selectedChallengeId));
    // Refresh manual trade pool list for the newly started challenge
    manualTradePanel.updatePools(_poolOptionsForChallenge(selectedChallengeId));
    // Show NFT panel if this challenge has an NFT marketplace
    _updateNftPanel(selectedChallengeId, true);
  }
  if (s.status === "idle" && statusChanged) {
    knownPairs = [];
    chartGrid.updatePairs(_pairOptionsForChallenge(selectedChallengeId));
    manualTradePanel.updatePools(_poolOptionsForChallenge(selectedChallengeId));
    _updateNftPanel(selectedChallengeId, false);
  }
  if (s.status === "won" && s.id) {
    markSolved(s.id);
    landingPage.refresh();
  }

  // Keep the landing page Resume/Play button in sync with the live engine state.
  // Only updates the card label — no full re-render unless status actually changed.
  if (statusChanged || challengeChanged) {
    const isActive =
      s.status === "running" ||
      s.status === "paused"  ||
      s.status === "fast_forward";
    landingPage.setActiveChallenge(isActive ? _lastChallengeId : "");
  }
});

/** Show/hide the NFT tab button and initialize the NFT panel. */
function _updateNftPanel(challengeId: string, running: boolean): void {
  const c = challengesCache.find(x => x.id === challengeId);
  // Detect NFT challenges via the explicit hasNft flag (set when the manifest has
  // nftMints or an NFTMarketplace contract), falling back to category "nft" for
  // backwards compatibility with any older manifests.
  const isNft = running && !!(c?.hasNft || c?.category === "nft");

  // Show / hide the NFT tab button
  nftTabBtn.style.display = isNft ? "" : "none";

  if (isNft) {
    // contractId for the marketplace is "marketplace" by convention in our manifests
    nftPanel.initForContract("marketplace");
  } else {
    // If the NFT tab was active when challenge ended, switch back to trading
    const activeTab = gameEl.querySelector<HTMLButtonElement>(".game-tab.active");
    if (activeTab?.dataset.tab === "nft") {
      gameEl.querySelector<HTMLButtonElement>(".game-tab[data-tab='trading']")?.click();
    }
  }
}

function _pairLabel(pair: string): string {
  const meta = poolMeta.get(pair);
  return meta ? `${meta.tokenA}/${meta.tokenB}` : pair.toUpperCase();
}

function _pairOptionsForKnownPairs() {
  return knownPairs.map((pair) => {
    const meta = poolMeta.get(pair);
    return {
      id: pair,
      label: _pairLabel(pair),
      exchangeId: meta?.exchange ?? "unknown",
      exchangeName: meta?.displayName ?? "DEX",
    };
  });
}

function _pairOptionsForChallenge(challengeId: string) {
  if (!challengeId) return [];
  const c = challengesCache.find(x => x.id === challengeId);
  if (!c?.pools?.length) return [];
  return c.pools.map((p) => {
    const meta = poolMeta.get(p.id);
    return {
      id: p.id,
      label: _pairLabel(p.id),
      exchangeId: meta?.exchange ?? "unknown",
      exchangeName: meta?.displayName ?? "DEX",
    };
  });
}

function _poolOptionsForChallenge(challengeId: string) {
  if (!challengeId) return [];
  const c = challengesCache.find(x => x.id === challengeId);
  if (!c?.pools?.length) return [];
  return c.pools.map((p) => {
    const meta = poolMeta.get(p.id);
    const label = _pairLabel(p.id);
    return {
      id:     p.id,
      label,
      tokenA: meta?.tokenA ?? p.tokenA,
      tokenB: meta?.tokenB ?? p.tokenB,
    };
  });
}

// ── Win / lose overlay ────────────────────────────────────────────────────────

const resultOverlay  = gameEl.querySelector<HTMLElement>("#result-overlay")!;
const resultCard     = gameEl.querySelector<HTMLElement>("#result-card")!;
const resultIcon     = gameEl.querySelector<HTMLElement>("#result-icon")!;
const resultTitle    = gameEl.querySelector<HTMLElement>("#result-title")!;
const resultStats    = gameEl.querySelector<HTMLElement>("#result-stats")!;
const resultDismiss  = gameEl.querySelector<HTMLButtonElement>("#result-dismiss")!;

resultDismiss.addEventListener("click", () => resultOverlay.classList.add("hidden"));
resultOverlay.addEventListener("click", (e) => {
  if (e.target === resultOverlay) resultOverlay.classList.add("hidden");
});

ws.on("win", (raw) => {
  const w = raw as { won: boolean; current: string; target: string; metric?: string; id?: string; blocksUsed?: number };
  resultCard.className = `result-card ${w.won ? "result-won" : "result-lost"}`;
  resultIcon.textContent  = w.won ? "✔" : "✘";
  resultTitle.textContent = w.won ? "CHALLENGE WON" : "CHALLENGE FAILED";
  const unit  = w.metric === "usdBalance" ? "USDC" : "ETH";
  const decimals = w.metric === "usdBalance" ? 2 : 4;
  const final = parseFloat(w.current).toFixed(decimals);
  const tgt   = parseFloat(w.target).toFixed(decimals);
  const blks  = w.blocksUsed ? `  •  ${w.blocksUsed} blocks used` : "";
  resultStats.textContent = `Final: ${final} ${unit}  •  Target: ${tgt} ${unit}${blks}`;
  resultOverlay.classList.remove("hidden");

  // Mark solved in local storage and refresh the landing page immediately so
  // the solved badge and "X/N solved" counter update without a page reload.
  if (w.won) {
    const solvedId = w.id ?? selectedChallengeId;
    if (solvedId) {
      markSolved(solvedId);
      landingPage.refresh();
    }
  }
});

// ── Resizable right sidebar ───────────────────────────────────────────────────

const resizeHandle = gameEl.querySelector<HTMLElement>("#sidebar-resize")!;
const rightSidebar = gameEl.querySelector<HTMLElement>("#right-sidebar")!;
let _resizing = false, _startX = 0, _startW = 0;

resizeHandle.addEventListener("mousedown", (e: MouseEvent) => {
  _resizing = true; _startX = e.clientX; _startW = rightSidebar.offsetWidth;
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  e.preventDefault();
});
document.addEventListener("mousemove", (e: MouseEvent) => {
  if (!_resizing) return;
  const delta = _startX - e.clientX;
  rightSidebar.style.width = `${Math.max(200, Math.min(window.innerWidth - 300, _startW + delta))}px`;
});
document.addEventListener("mouseup", () => {
  if (!_resizing) return;
  _resizing = false;
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
});

} // end !_ideMode
