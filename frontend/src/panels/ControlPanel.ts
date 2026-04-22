import type { WSClient } from "../ws/WSClient.js";
import { escHtml, renderMarkdown } from "../lib/landingMarkdown.js";

interface ChallengeInfo {
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
  targetToken:  string;
  startingValue: string;
  pools: Array<{
    id:          string;
    tokenA:      string;
    tokenB:      string;
    exchange:    string;
    displayName: string;
  }>;
}

interface ChallengeState {
  id:            string;
  status:        string;
  currentBlock:  number;
  totalBlocks:   number;
  playerBalance: string;
  targetBalance: string;
  metric:        string;
}

export class ControlPanel {
  private container: HTMLElement;
  private ws: WSClient;
  private blockEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private challengeNameEl!: HTMLElement;
  private challengeMetaEl!: HTMLElement;
  private btnBack!: HTMLButtonElement;
  private btnStart!: HTMLButtonElement;
  private btnStop!: HTMLButtonElement;
  private btnPause!: HTMLButtonElement;
  private btnResume!: HTMLButtonElement;
  private speedSlider!: HTMLInputElement;
  private speedCurrent!: HTMLElement;
  private _status = "idle";
  private _pending = false;
  private _selectedChallengeId = "";
  private _challenges = new Map<string, ChallengeInfo>();
  private _docsBackdrop: HTMLElement | null = null;
  private _escHandler: ((e: KeyboardEvent) => void) | null = null;
  private _docsAbort: AbortController | null = null;

  constructor(container: HTMLElement, ws: WSClient, onBackToLanding: () => void) {
    this.container = container;
    this.ws = ws;

    container.innerHTML = `
      <div class="panel-section">
        <div class="panel-title">CHALLENGE</div>
        <div class="challenge-name-row">
          <div id="selected-challenge-name" class="stat-value" style="flex:1;min-width:0;">No challenge selected</div>
          <button id="btn-challenge-docs" class="btn-challenge-docs" title="View challenge documentation" style="display:none">Docs</button>
        </div>
        <div id="selected-challenge-meta" style="color:#8b949e;font-size:12px;margin-top:4px;">Pick a challenge from the main screen.</div>
        <div class="btn-row">
          <button id="btn-start" class="btn btn-primary" style="flex:1">Start</button>
          <button id="btn-stop"  class="btn btn-danger"  style="flex:1">Stop</button>
        </div>
        <button id="btn-back-challenges" class="btn btn-secondary" style="width:100%;margin-top:8px">Back to challenges</button>
      </div>
      <div class="panel-section">
        <div class="panel-title">CONTROL</div>
        <div class="btn-row" style="margin-bottom:8px">
          <button id="btn-pause"  class="btn btn-secondary" style="flex:1">Pause</button>
          <button id="btn-resume" class="btn btn-secondary" style="flex:1">Resume</button>
        </div>
        <div class="speed-row">
          <span class="speed-end-label">1×</span>
          <input id="speed-slider" type="range" min="1" max="10" step="1" value="1" class="speed-slider" />
          <span class="speed-end-label">10×</span>
          <span id="speed-current" class="speed-current">1×</span>
        </div>
      </div>
      <div class="panel-section">
        <div class="panel-title">CHAIN</div>
        <div class="stat-row"><span>Status</span><span id="status-el" class="badge badge-idle">idle</span></div>
        <div class="stat-row"><span>Block</span><span id="block-el">–</span></div>
      </div>
    `;

    this.challengeNameEl  = container.querySelector("#selected-challenge-name")!;
    this.challengeMetaEl  = container.querySelector("#selected-challenge-meta")!;
    this.btnBack          = container.querySelector("#btn-back-challenges")!;
    this.blockEl         = container.querySelector("#block-el")!;
    this.statusEl        = container.querySelector("#status-el")!;
    this.btnStart        = container.querySelector("#btn-start")!;
    this.btnStop         = container.querySelector("#btn-stop")!;
    this.btnPause        = container.querySelector("#btn-pause")!;
    this.btnResume       = container.querySelector("#btn-resume")!;
    this.speedSlider     = container.querySelector("#speed-slider")!;
    this.speedCurrent    = container.querySelector("#speed-current")!;

    const btnDocs = container.querySelector<HTMLButtonElement>("#btn-challenge-docs")!;
    btnDocs.addEventListener("click", () => this._showDocs());

    this._updateButtons();

    this.btnStart.addEventListener("click",  () => this._start());
    this.btnStop.addEventListener("click",   () => this._stop());
    this.btnBack.addEventListener("click",   () => onBackToLanding());
    this.btnPause.addEventListener("click",  () => { if (!this.btnPause.disabled) ws.send("control", { action: "pause" }); });
    this.btnResume.addEventListener("click", () => { if (!this.btnResume.disabled) ws.send("control", { action: "resume" }); });

    this.speedSlider.addEventListener("input", () => {
      const v = parseInt(this.speedSlider.value);
      this.speedCurrent.textContent = `${v}×`;
      ws.send("control", { action: "set_speed", speed: v });
    });

    ws.on("challenges", (raw) => {
      const payload = raw as { challenges?: ChallengeInfo[] } | ChallengeInfo[];
      const list: ChallengeInfo[] = Array.isArray(payload)
        ? payload
        : (payload as { challenges?: ChallengeInfo[] }).challenges ?? [];
      this._challenges = new Map(list.map(c => [c.id, c]));
      if (!this._selectedChallengeId && list.length > 0) {
        this.setSelectedChallenge(list[0].id);
      } else {
        this._renderSelectedChallenge();
      }
    });

    ws.on("challenge", (raw) => {
      const s = raw as ChallengeState;
      const statusChanged = this._status !== s.status;
      if (statusChanged) {
        this._pending = false;
        this.btnStart.textContent = "Start";
      }
      this._status = s.status;
      this.blockEl.textContent = `${s.currentBlock} / ${s.totalBlocks}`;
      this.statusEl.textContent = s.status;
      this.statusEl.className = `badge badge-${s.status}`;
      this._updateButtons();
    });

    ws.on("speed", (raw) => {
      const p = raw as { speed: number };
      this.speedSlider.value = String(p.speed);
      this.speedCurrent.textContent = `${p.speed}×`;
    });
  }

  setSelectedChallenge(challengeId: string) {
    this._selectedChallengeId = challengeId;
    this._renderSelectedChallenge();
    this._updateButtons();
  }

  private _renderSelectedChallenge() {
    const c = this._challenges.get(this._selectedChallengeId);
    const docsBtn = this.container.querySelector<HTMLButtonElement>("#btn-challenge-docs");
    if (!c) {
      this.challengeNameEl.textContent = "No challenge selected";
      this.challengeMetaEl.textContent = "Pick a challenge from the main screen.";
      if (docsBtn) docsBtn.style.display = "none";
      return;
    }
    this.challengeNameEl.textContent = c.name;
    const start  = c.startingValue ?? "10";
    const target = c.metric === "drainContract"
      ? `drain to < ${c.target} ${c.targetToken ?? "ETH"}`
      : `target ${c.target} ETH`;
    this.challengeMetaEl.textContent = `${c.blockCount} blocks • start ${start} ETH • ${target}`;
    if (docsBtn) docsBtn.style.display = "";
  }

  private _updateButtons() {
    const s = this._status;
    const active = s === "running" || s === "paused" || s === "fast_forward";

    this.btnStart.disabled  = active || this._pending || !this._selectedChallengeId;
    this.btnStop.disabled   = s === "idle";
    this.btnPause.disabled  = s !== "running";
    this.btnResume.disabled = s !== "paused";
    this.speedSlider.disabled = !active;
  }

  private _start() {
    if (this._pending) return;
    const active = this._status === "running" || this._status === "paused" || this._status === "fast_forward";
    if (active) return;
    const id = this._selectedChallengeId;
    if (!id) return;

    this._pending = true;
    this.btnStart.textContent = "Starting…";
    this._updateButtons();
    this.ws.send("challenge_start", { challengeId: id });

    // Safety net: reset pending flag if server never responds
    setTimeout(() => {
      if (this._pending) {
        this._pending = false;
        this.btnStart.textContent = "Start";
        this._updateButtons();
      }
    }, 10_000);
  }

  private _stop() {
    if (this._status === "idle") return;
    this.ws.send("challenge_stop", {});
  }

  private async _showDocs() {
    const id = this._selectedChallengeId;
    if (!id) return;
    const c = this._challenges.get(id);

    // Build (or reuse) the backdrop element attached to document.body
    if (!this._docsBackdrop) {
      const el = document.createElement("div");
      el.className = "readme-backdrop hidden";
      el.innerHTML = `
        <div class="readme-modal">
          <div class="readme-header">
            <span class="readme-title" id="cp-docs-title"></span>
            <button class="readme-close" id="cp-docs-close">&#x2715;</button>
          </div>
          <div class="readme-body" id="cp-docs-body"></div>
        </div>
      `;
      document.body.appendChild(el);
      this._docsBackdrop = el;

      el.querySelector("#cp-docs-close")!.addEventListener("click", () => this._hideDocs());
      el.addEventListener("click", (e) => {
        if (e.target === el) this._hideDocs();
      });
    }

    const backdrop = this._docsBackdrop;
    const titleEl  = backdrop.querySelector<HTMLElement>("#cp-docs-title")!;
    const bodyEl   = backdrop.querySelector<HTMLElement>("#cp-docs-body")!;

    titleEl.textContent = c?.name ?? id;
    bodyEl.innerHTML    = `<div class="md-loading">Loading…</div>`;
    backdrop.classList.remove("hidden");
    document.body.style.overflow = "hidden";

    // Escape key closes the modal
    if (this._escHandler) document.removeEventListener("keydown", this._escHandler);
    this._escHandler = (e: KeyboardEvent) => { if (e.key === "Escape") this._hideDocs(); };
    document.addEventListener("keydown", this._escHandler);

    // Abort any in-flight README fetch so a stale response cannot overwrite
    // content for the challenge that is currently being shown.
    if (this._docsAbort) this._docsAbort.abort();
    const abortCtrl = new AbortController();
    this._docsAbort = abortCtrl;

    const descHtml = c?.description
      ? `<p class="readme-desc">${escHtml(c.description)}</p><hr class="readme-desc-divider">`
      : "";

    try {
      const resp = await fetch(`/api/challenge/${encodeURIComponent(id)}/readme`, { signal: abortCtrl.signal });
      if (!resp.ok) throw new Error("no readme");
      const md = await resp.text();
      // Only update the DOM if this fetch is still the current one
      if (!abortCtrl.signal.aborted) {
        bodyEl.innerHTML = descHtml + renderMarkdown(md);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      bodyEl.innerHTML = descHtml || `<p class="md-p" style="color:#6e7681">No documentation available for this challenge.</p>`;
    }
  }

  private _hideDocs() {
    if (this._docsBackdrop) this._docsBackdrop.classList.add("hidden");
    document.body.style.overflow = "";
    if (this._escHandler) {
      document.removeEventListener("keydown", this._escHandler);
      this._escHandler = null;
    }
    if (this._docsAbort) {
      this._docsAbort.abort();
      this._docsAbort = null;
    }
  }
}
