// TutorialOverlay — interactive step-by-step bubble guide for tutorial challenges.
//
// Activates for any challenge that has an entry in CHALLENGE_STEPS.
// The overlay always shows when a tutorial challenge is loaded — dismissed state
// is NOT persisted in localStorage so it re-appears on every visit.

interface BubbleStep {
  /** CSS selector for the element to point at. */
  targetSelector: string;
  /** Step title (short). */
  title: string;
  /** Explanatory message shown in the bubble. */
  message: string;
  /**
   * Optional: game tab to activate before showing this step.
   * Values match the `data-tab` attribute on `.game-tab` buttons:
   *   "trading"  — the main trading view (default)
   *   "explorer" — the Block Explorer tab
   *   "nft"      — the NFT Marketplace tab
   * When omitted no tab switch is performed.
   */
  panel?: "trading" | "explorer" | "nft";
}

const CHALLENGE_STEPS: Record<string, BubbleStep[]> = {
  "hello-trader": [
    {
      targetSelector: "#control-panel",
      title: "Start the Challenge",
      message:
        'Click the <strong>Start</strong> button to spin up your private chain. ' +
        "You'll see the block counter increment as new blocks are mined.",
    },
    {
      targetSelector: "#chart-grid",
      title: "Price Chart",
      message:
        "This is the trading view. The chart shows the live WETH/USDC price. " +
        "Watch it tick as trades land on the chain.",
    },
    {
      targetSelector: "#script-panel",
      title: "JavaScript IDE",
      message:
        "This is your coding environment. Your template script is already loaded. " +
        "Find the line marked <strong>YOUR LINE HERE</strong> and fill in the swap call.",
    },
    {
      targetSelector: ".ide-run-btn, #ide-run-btn, button[title*='Run'], .btn-run, #ide-run",
      title: "Run Your Script",
      message:
        "Click <strong>Run</strong> to execute the script. Your transactions will broadcast " +
        "to the chain — check the Explorer tab to see them land in real time.",
    },
    {
      targetSelector: "#progress-panel",
      title: "Watch Your Progress",
      message:
        "The progress bar tracks your USDC balance toward the 500 USDC target. " +
        "A single swap is all it takes. Good luck — and welcome to DeFi CTF!",
    },
  ],
  "first-script": [
    {
      targetSelector: "#control-panel",
      title: "Start the Challenge",
      message:
        "Click <strong>Start</strong> to spin up your private chain and deploy the contracts.",
    },
    {
      targetSelector: "#script-panel",
      title: "Solidity IDE",
      message:
        "Switch to the <strong>Solidity</strong> tab. Your Forge script template is pre-loaded — " +
        "find the <strong>two lines</strong> marked <strong>// YOUR LINE HERE</strong>: " +
        "the <code>deposit()</code> call (to wrap ETH) and the <code>swapExactIn()</code> call.",
    },
    {
      targetSelector: ".ide-run-btn, #ide-run-btn, button[title*='Run'], .btn-run, #ide-run-script",
      title: "Run the Script",
      message:
        "Click <strong>Run Script</strong> to broadcast your Forge transactions on-chain.",
    },
    {
      targetSelector: "#progress-panel",
      title: "Watch Your Balance",
      message:
        "Your USDC balance appears in the progress bar. Once it hits 500 USDC, " +
        "you've won — welcome to on-chain DeFi!",
    },
  ],
  "broken-token": [
    {
      targetSelector: "#control-panel",
      title: "Start the Challenge",
      message:
        "Click <strong>Start</strong> to deploy the broken token contract and start the clock.",
    },
    {
      targetSelector: "#script-panel",
      title: "Solidity IDE",
      message:
        "Open the <strong>Solidity</strong> tab. The exploit script is mostly written — " +
        "find <strong>// YOUR LINE HERE</strong> and add the <code>transferFrom</code> call that steals the tokens.",
    },
    {
      targetSelector: ".ide-run-btn, #ide-run-btn, button[title*='Run'], .btn-run, #ide-run-script",
      title: "Execute the Exploit",
      message:
        "Run the script to drain the contract. If your <code>transferFrom</code> is correct, " +
        "the tokens move to you and the prize ETH unlocks.",
    },
    {
      targetSelector: "#progress-panel",
      title: "Claim the Prize",
      message:
        "Once the contract ETH drops below 0.1 ETH, you've won. " +
        "Check the Block Explorer to see your transactions on-chain.",
    },
  ],
  "block-explorer-tutorial": [
    {
      targetSelector: "#control-panel",
      title: "Welcome: Follow the Money",
      message:
        "Every transaction on a blockchain is permanent and public. " +
        "In this challenge you'll make a swap and then <strong>track it down in the Block Explorer</strong>. " +
        "Click <strong>Start</strong> to spin up your chain.",
      panel: "trading",
    },
    {
      targetSelector: ".game-tab[data-tab='explorer']",
      title: "Open the Block Explorer",
      message:
        "See this <strong>Explorer</strong> tab? Click it to open the Block Explorer. " +
        "You'll see every transaction that lands on your chain — from bots, from you, from everyone. " +
        "Head there now and watch the blocks roll in.",
    },
    {
      targetSelector: "#explorer-panel",
      title: "Reading Transactions",
      message:
        "Each row is a transaction in a block. You can see the sender, recipient, value, " +
        "and decoded calldata. Bot trades appear here automatically. " +
        "Come back after you make a swap — your transaction will show up here too.",
      panel: "explorer",
    },
    {
      targetSelector: "#script-panel",
      title: "Make a Swap",
      message:
        "Time to make a trade! Find <strong>YOUR LINE HERE</strong> in the JavaScript IDE " +
        "and uncomment the <code>swap()</code> call. Then click <strong>Run</strong> to execute it.",
      panel: "trading",
    },
    {
      targetSelector: ".game-tab[data-tab='explorer']",
      title: "Find Your Transaction",
      message:
        "Click the <strong>Explorer</strong> tab again. Your swap transaction will appear " +
        "in the most recent block — look for your player address in the <em>From</em> column. " +
        "Click any transaction to see its full details.",
    },
    {
      targetSelector: "#explorer-panel",
      title: "You Did It!",
      message:
        "You've learned how to make a trade <em>and</em> verify it on-chain. " +
        "Once your USDC balance hits 400 you win. " +
        "Every DeFi protocol in the world works this way — transactions, blocks, forever.",
      panel: "explorer",
    },
  ],
  "nft-marketplace-tutorial": [
    {
      targetSelector: "#control-panel",
      title: "Welcome: Your First Flip",
      message:
        "NFTs are just tokens with pictures — and where there are tokens, there are trades. " +
        "In this challenge you'll use the <strong>NFT Marketplace</strong> to buy a corgi NFT cheap " +
        "and flip it to a buyer bot for profit. Click <strong>Start</strong> to deploy.",
      panel: "trading",
    },
    {
      targetSelector: "#nft-tab-btn",
      title: "Open the NFT Marketplace",
      message:
        "See the <strong>NFT</strong> tab in the top nav? It only appears when a challenge " +
        "with an NFT marketplace is running. Click it now to open the marketplace.",
    },
    {
      targetSelector: "#nft-grid",
      title: "Browse the Listings",
      message:
        "Each card is a listed NFT. You can see the <strong>rarity score</strong> and price. " +
        "All NFTs start at 0.3 WETH. A buyer bot will pay up to 0.6 WETH for any NFT with " +
        "rarity ≥ 50. Click <strong>Buy</strong> on any card to purchase one.",
      panel: "nft",
    },
    {
      targetSelector: "#nft-owned-grid",
      title: "List Your NFT for Sale",
      message:
        "After buying, your NFT appears in the <strong>YOUR NFTs</strong> section below. " +
        "Click <strong>List</strong> on it and set a price between 0.35 and 0.55 WETH. " +
        "The buyer bot checks every ~15 blocks and will snap it up!",
      panel: "nft",
    },
    {
      targetSelector: "#progress-panel",
      title: "Watch Your Profit",
      message:
        "Once the bot buys your listing, the sale proceeds go to your wallet. " +
        "The progress tracker shows your <strong>NFT sales profit</strong> — the net gain above your starting balance. " +
        "Earn <strong>0.4 ETH</strong> profit from flips to win!",
      panel: "trading",
    },
  ],
};

export class TutorialOverlay {
  private _bubbleEl: HTMLElement | null = null;
  private _stepIndex = 0;
  private _active    = false;
  private _steps: BubbleStep[] = [];

  /** Call whenever the active challenge changes. */
  setChallenge(challengeId: string): void {
    const steps = CHALLENGE_STEPS[challengeId];
    if (steps) {
      this._show(steps);
    } else {
      this._hide();
    }
  }

  /** Force-hide (e.g. when switching away from a tutorial challenge). */
  destroy(): void {
    this._hide();
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _show(steps: BubbleStep[]): void {
    // Always re-show from step 1, even if previously dismissed.
    this._hide();
    this._steps     = steps;
    this._active    = true;
    this._stepIndex = 0;
    this._renderBubble();
  }

  private _hide(): void {
    if (!this._active && !this._bubbleEl) return;
    this._active = false;
    if (this._bubbleEl) {
      this._bubbleEl.remove();
      this._bubbleEl = null;
    }
    this._clearHighlight();
  }

  private _renderBubble(): void {
    if (this._bubbleEl) {
      this._bubbleEl.remove();
      this._bubbleEl = null;
    }
    this._clearHighlight();

    if (this._stepIndex >= this._steps.length) {
      this._hide();
      return;
    }

    const step   = this._steps[this._stepIndex];
    const isLast = this._stepIndex === this._steps.length - 1;

    // Switch to the required panel before positioning the bubble.
    // This ensures the target element is visible when we measure its position.
    if (step.panel) {
      this._switchToPanel(step.panel);
    }

    // Highlight the target
    const target = document.querySelector<HTMLElement>(step.targetSelector);
    if (target) {
      target.classList.add("tutorial-highlight");
    }

    // Build bubble element
    const el = document.createElement("div");
    el.className = "tutorial-bubble";
    el.setAttribute("data-step", String(this._stepIndex));

    el.innerHTML = `
      <div class="tb-header">
        <span class="tb-step-badge">Step ${this._stepIndex + 1} / ${this._steps.length}</span>
        <button class="tb-dismiss" title="Skip tutorial">✕</button>
      </div>
      <div class="tb-title">${escHtml(step.title)}</div>
      <div class="tb-message">${step.message}</div>
      <div class="tb-footer">
        <button class="tb-next btn btn-primary">${isLast ? "Done" : "Next →"}</button>
      </div>
    `;

    document.body.appendChild(el);
    this._bubbleEl = el;

    // Position bubble near target (or center if not found)
    this._positionBubble(el, target);

    // Events
    el.querySelector(".tb-dismiss")!.addEventListener("click", () => this._hide());
    el.querySelector(".tb-next")!.addEventListener("click", () => {
      this._stepIndex++;
      this._renderBubble();
    });
  }

  /**
   * Programmatically activate a game tab by clicking its button.
   * Uses the same `data-tab` attribute that the main.ts tab-switching logic reads.
   */
  private _switchToPanel(panel: "trading" | "explorer" | "nft"): void {
    const btn = document.querySelector<HTMLButtonElement>(`.game-tab[data-tab="${panel}"]`);
    if (!btn) return;
    // Only click if this tab is not already active
    if (!btn.classList.contains("active")) {
      btn.click();
    }
  }

  private _positionBubble(bubble: HTMLElement, target: HTMLElement | null): void {
    // Use a small delay to let the DOM settle before measuring positions
    requestAnimationFrame(() => {
      const margin = 12;

      if (!target) {
        // Center on screen
        bubble.style.position = "fixed";
        bubble.style.top      = "50%";
        bubble.style.left     = "50%";
        bubble.style.transform = "translate(-50%, -50%)";
        return;
      }

      const rect   = target.getBoundingClientRect();
      const bW     = bubble.offsetWidth  || 300;
      const bH     = bubble.offsetHeight || 180;
      const vW     = window.innerWidth;
      const vH     = window.innerHeight;

      // Prefer placing below the target; fall back to above, then sides
      let top  = rect.bottom + margin;
      let left = rect.left + rect.width / 2 - bW / 2;

      // Clamp horizontally
      left = Math.max(margin, Math.min(left, vW - bW - margin));

      // If it goes off the bottom, place above
      if (top + bH > vH - margin) {
        top = rect.top - bH - margin;
      }

      // If still off the top, fall back to a safe center position
      if (top < margin) {
        top  = vH / 2 - bH / 2;
        left = vW  / 2 - bW / 2;
      }

      bubble.style.position  = "fixed";
      bubble.style.top       = `${top}px`;
      bubble.style.left      = `${left}px`;
      bubble.style.transform = "";
    });
  }

  private _clearHighlight(): void {
    document.querySelectorAll(".tutorial-highlight").forEach(el => {
      el.classList.remove("tutorial-highlight");
    });
  }
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
