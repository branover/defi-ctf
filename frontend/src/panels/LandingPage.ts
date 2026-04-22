import { escHtml, renderMarkdown } from "../lib/landingMarkdown.js";
import { isSolved, solvedCount, resetProgress } from "../lib/progress.js";

interface ChallengeItem {
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
  order:        number | null;
  pools: Array<{
    id:          string;
    tokenA:      string;
    tokenB:      string;
    exchange:    string;
    displayName: string;
  }>;
}

const CATEGORY_ORDER = ["tutorial", "trading-strategy", "market-manipulation", "defi-exploit"];

const CATEGORY_META: Record<string, { label: string; icon: string; accent: string; desc: string }> = {
  "tutorial":            { label: "Getting Started",     icon: "🎓", accent: "#58a6ff", desc: "New to DeFi CTF? Start here. These guided challenges walk you through the JS SDK, Forge scripts, and your first smart contract exploit — step by step." },
  "trading-strategy":    { label: "Trading Strategies",  icon: "📈", accent: "#3fb950", desc: "Legitimate market strategies — arbitrage, trend following, liquidity provision, price discovery." },
  "market-manipulation": { label: "Market Manipulation", icon: "🎭", accent: "#f0883e", desc: "Borderline tactics — manipulating bots, triggering cascades, wash trading, causing liquidations through price pressure." },
  "defi-exploit":        { label: "DeFi Exploits",       icon: "☠️", accent: "#f85149", desc: "Exploiting security flaws in smart contracts or protocols — reentrancy, oracle attacks, flash loans that steal, uninitialized proxies." },
};

const DIFF_META: Record<string, { label: string; cls: string }> = {
  "beginner": { label: "Beginner", cls: "diff-beginner" },
  "easy":     { label: "Easy",     cls: "diff-easy" },
  "medium":   { label: "Medium",   cls: "diff-medium" },
  "hard":     { label: "Hard",     cls: "diff-hard" },
  "expert":   { label: "Expert",   cls: "diff-expert" },
};

const DIFFICULTY_RANK: Record<string, number> = {
  beginner: 0, easy: 1, medium: 2, hard: 3, expert: 4,
};

// ── LandingPage ───────────────────────────────────────────────────────────────

export class LandingPage {
  private root: HTMLElement;
  private onPlay: (challengeId: string) => void;
  private onTutorial: () => void;
  private challenges: ChallengeItem[] = [];
  // The challenge that is currently active (running/paused/fast_forward) in the
  // engine — shown with a "Resume →" button instead of "Play →".
  private _activeChallengeId: string = "";
  // Single bound click handler stored so it can be removed before re-adding on refresh.
  private _clickHandler: ((e: MouseEvent) => void) | null = null;

  constructor(
    container: HTMLElement,
    onPlay: (challengeId: string) => void,
    onTutorial: () => void = () => {},
  ) {
    this.root       = container;
    this.onPlay     = onPlay;
    this.onTutorial = onTutorial;
    this._init();
  }

  /**
   * Update the active challenge ID.  A non-empty id means that challenge is
   * currently running/paused in the engine and its card should show "Resume".
   * Pass an empty string to clear the active state (challenge idle/ended).
   * Triggers a re-render if challenges are already loaded.
   */
  setActiveChallenge(id: string) {
    if (this._activeChallengeId === id) return; // no-op on no change
    this._activeChallengeId = id;
    this.refresh();
  }

  private async _init() {
    this.root.innerHTML = `<div class="landing-loading">Loading challenges…</div>`;
    try {
      const resp = await fetch("/api/challenges");
      this.challenges = await resp.json() as ChallengeItem[];
    } catch {
      this.root.innerHTML = `<div class="landing-loading">Failed to load challenges.</div>`;
      return;
    }
    this._render();
    this._bindEvents();
  }

  /**
   * Re-render the landing page in-place to reflect updated solved state.
   * Safe to call at any time after initialisation completes.
   */
  refresh() {
    if (this.challenges.length === 0) return; // not yet loaded
    this._render();
    this._bindEvents();
  }

  private _render() {
    const byCategory = new Map<string, ChallengeItem[]>();
    for (const c of this.challenges) {
      const cat = c.category ?? "other";
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(c);
    }

    const totalCount = this.challenges.length;
    const catCount   = byCategory.size;
    const solved     = solvedCount();
    const pct        = totalCount > 0 ? Math.round((solved / totalCount) * 100) : 0;

    const catSections = CATEGORY_ORDER
      .filter(k => byCategory.has(k))
      .concat([...byCategory.keys()].filter(k => !CATEGORY_ORDER.includes(k)))
      .map(cat => this._renderCategory(cat, byCategory.get(cat)!))
      .join("");

    this.root.innerHTML = `
      <div class="landing-scroll">
        <div class="hero">
          <div class="hero-inner">
            <div class="hero-logo">⛓</div>
            <h1 class="hero-title">DeFi CTF</h1>
            <p class="hero-sub">Master trading strategies, market manipulation, and DeFi exploits in a live simulated blockchain environment.</p>
            <div class="hero-stats">
              <div class="hero-stat"><span class="hero-num">${totalCount}</span><span class="hero-label">challenges</span></div>
              <div class="hero-stat-div"></div>
              <div class="hero-stat"><span class="hero-num">${catCount}</span><span class="hero-label">categories</span></div>
              <div class="hero-stat-div"></div>
              <div class="hero-stat"><span class="hero-num" style="color:#3fb950">${solved}</span><span class="hero-label">solved</span></div>
            </div>
          </div>
        </div>
        <div class="cat-list">
          <div class="tutorial-banner" id="tutorial-banner">
            <div class="tutorial-banner-left">
              <span class="tutorial-banner-icon">🚀</span>
              <div>
                <div class="tutorial-banner-title">New to DeFi CTF?</div>
                <div class="tutorial-banner-sub">Learn DeFi basics, the JS SDK, Forge scripts, and contract deployment in 8 interactive steps. Or jump straight into the hands-on tutorial challenges.</div>
              </div>
            </div>
            <div class="tutorial-banner-btns">
              <button class="btn-tutorial" id="btn-tutorial">Read Guide →</button>
              <button class="btn-tutorial btn-tutorial-play" id="btn-start-tutorial">Start Tutorial →</button>
            </div>
          </div>
          <div class="progress-summary-bar" id="progress-summary-bar">
            <div class="progress-summary-left">
              <span class="progress-summary-icon">✓</span>
              <span class="progress-summary-text">${solved} / ${totalCount} Challenges Solved</span>
              <div class="progress-summary-track">
                <div class="progress-summary-fill" style="width:${pct}%"></div>
              </div>
              <span class="progress-summary-pct">${pct}%</span>
            </div>
            <button class="btn-reset-progress" id="btn-reset-progress" title="Clear all solved state">Reset Progress</button>
          </div>
          ${catSections}
        </div>
      </div>
      <div class="readme-backdrop hidden" id="readme-backdrop">
        <div class="readme-modal">
          <div class="readme-header">
            <span class="readme-title" id="readme-title"></span>
            <button class="readme-close" id="readme-close">✕</button>
          </div>
          <div class="readme-body" id="readme-body"></div>
        </div>
      </div>
    `;
  }

  private _renderCategory(cat: string, items: ChallengeItem[]): string {
    const meta = CATEGORY_META[cat] ?? { label: cat, icon: "⚙️", accent: "#8b949e", desc: "" };
    // Tutorial: sort by explicit order field, then difficulty, then name.
    // Other categories: sort by difficulty first, then name as tiebreaker.
    const sorted = cat === "tutorial"
      ? [...items].sort((a, b) =>
          (a.order ?? 999) - (b.order ?? 999) ||
          (DIFFICULTY_RANK[a.difficulty ?? ""] ?? 99) - (DIFFICULTY_RANK[b.difficulty ?? ""] ?? 99) ||
          a.name.localeCompare(b.name)
        )
      : [...items].sort((a, b) =>
          (DIFFICULTY_RANK[a.difficulty ?? ""] ?? 99) - (DIFFICULTY_RANK[b.difficulty ?? ""] ?? 99) ||
          a.name.localeCompare(b.name)
        );
    const cards = sorted.map(c => this._renderCard(c, meta.accent)).join("");
    const descHtml = meta.desc
      ? `<p class="cat-desc">${escHtml(meta.desc)}</p>`
      : "";
    return `
      <section class="cat-section category-${escHtml(cat)}">
        <div class="cat-heading">
          <span class="cat-icon">${meta.icon}</span>
          <span class="cat-label" style="color:${meta.accent}">${meta.label}</span>
          <span class="cat-count">${items.length}</span>
        </div>
        ${descHtml}
        <div class="card-grid">${cards}</div>
      </section>
    `;
  }

  private _renderCard(c: ChallengeItem, accent: string): string {
    const diff    = c.difficulty ? DIFF_META[c.difficulty] ?? { label: c.difficulty, cls: "diff-easy" } : null;
    const tags    = c.tags.slice(0, 3).map(t => `<span class="tag">${escHtml(t)}</span>`).join("");
    const goal    = c.metric === "drainContract"
      ? "Drain the contract"
      : c.metric === "usdBalance"
        ? `Target: ${c.target} USDC`
        : `Target: ${c.target} ETH`;
    const solved  = isSolved(c.id);
    const isActive = c.id === this._activeChallengeId;
    const solvedClass = solved ? " challenge-card-solved" : "";
    const activeClass = isActive ? " challenge-card-active" : "";
    const solvedBadge = solved
      ? `<span class="solved-badge">&#10003; Solved</span>`
      : "";
    const playBtn = isActive
      ? `<button class="btn-card btn-card-resume" data-id="${escHtml(c.id)}">Resume →</button>`
      : `<button class="btn-card btn-card-play" data-id="${escHtml(c.id)}">Play →</button>`;
    return `
      <div class="challenge-card${solvedClass}${activeClass}" data-id="${escHtml(c.id)}" style="--card-accent:${accent}">
        <div class="card-top">
          <div class="card-name-row">
            <span class="card-name">${escHtml(c.name)}</span>
            <div class="card-name-badges">
              ${solvedBadge}
              ${diff ? `<span class="diff-badge ${diff.cls}">${diff.label}</span>` : ""}
            </div>
          </div>
          <p class="card-desc">${escHtml(c.description)}</p>
        </div>
        <div class="card-tags">${tags}</div>
        <div class="card-footer">
          <span class="card-meta">${c.blockCount} blocks · ${escHtml(goal)}</span>
          <div class="card-btns">
            <button class="btn-card btn-card-docs" data-id="${escHtml(c.id)}">Docs</button>
            ${playBtn}
          </div>
        </div>
      </div>
    `;
  }

  private _bindEvents() {
    // Remove the previous handler before re-adding so refresh() doesn't stack listeners.
    if (this._clickHandler) {
      this.root.removeEventListener("click", this._clickHandler);
    }

    // Single delegated handler for all clicks inside the landing page.
    this._clickHandler = async (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // Tutorial guide button
      if (target.id === "btn-tutorial" || target.closest("#btn-tutorial")) {
        this.onTutorial();
        return;
      }

      // "Start Tutorial" — jump directly into hello-trader challenge
      if (target.id === "btn-start-tutorial" || target.closest("#btn-start-tutorial")) {
        this.onPlay("hello-trader");
        return;
      }

      // Reset progress button
      if (target.id === "btn-reset-progress" || target.closest("#btn-reset-progress")) {
        resetProgress();
        this._render();
        this._bindEvents();
        return;
      }

      // README modal close
      if (target.id === "readme-close" || target.id === "readme-backdrop") {
        this._hideReadme();
        return;
      }

      // Challenge card buttons
      const btn = target.closest("[data-id]") as HTMLElement | null;
      if (!btn) return;
      const id = btn.dataset.id!;
      if (btn.classList.contains("btn-card-play") || btn.classList.contains("btn-card-resume")) {
        this.onPlay(id);
      } else if (btn.classList.contains("btn-card-docs")) {
        await this._showReadme(id);
      }
    };

    this.root.addEventListener("click", this._clickHandler);
  }

  private async _showReadme(id: string) {
    const backdrop = this.root.querySelector("#readme-backdrop") as HTMLElement;
    const title    = this.root.querySelector("#readme-title") as HTMLElement;
    const body     = this.root.querySelector("#readme-body") as HTMLElement;
    const c        = this.challenges.find(x => x.id === id);

    title.textContent = c?.name ?? id;
    body.innerHTML    = `<div class="md-loading">Loading…</div>`;
    backdrop.classList.remove("hidden");
    document.body.style.overflow = "hidden";

    // Build the description block shown above the README (always, if available)
    const descHtml = c?.description
      ? `<p class="readme-desc">${escHtml(c.description)}</p><hr class="readme-desc-divider">`
      : "";

    try {
      const resp = await fetch(`/api/challenge/${encodeURIComponent(id)}/readme`);
      if (!resp.ok) throw new Error("no readme");
      const md = await resp.text();
      body.innerHTML = descHtml + renderMarkdown(md);
    } catch {
      body.innerHTML = descHtml || `<p class="md-p" style="color:#6e7681">No documentation available for this challenge.</p>`;
    }
  }

  private _hideReadme() {
    const backdrop = this.root.querySelector("#readme-backdrop") as HTMLElement | null;
    if (backdrop) backdrop.classList.add("hidden");
    document.body.style.overflow = "";
  }
}
