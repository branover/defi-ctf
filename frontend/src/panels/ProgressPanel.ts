import type { WSClient } from "../ws/WSClient.js";

interface ChallengeState {
  status:         string;
  playerBalance?: string;
  targetBalance?: string;
  metric:         string;
  balances?:      Record<string, string>;
}

/** Human-readable label for each win metric. */
function metricLabel(metric: string): { balance: string; target: string; hint: string } {
  switch (metric) {
    case "portfolioValueInEth":
      return {
        balance: "Portfolio Value",
        target:  "Win Target",
        hint:    "Portfolio value = ETH + all tokens converted to ETH at market price",
      };
    case "ethBalance":
      return {
        balance: "ETH Balance",
        target:  "Win Target",
        hint:    "Progress tracks your native ETH balance",
      };
    case "tokenBalance":
      return {
        balance: "Token Balance",
        target:  "Win Target",
        hint:    "Progress tracks a specific token balance",
      };
    case "usdBalance":
      return {
        balance: "USD Balance",
        target:  "Win Target",
        hint:    "Progress tracks your stablecoin balance",
      };
    case "drainContract":
      return {
        balance: "Contract Balance",
        target:  "Drain Target (below)",
        hint:    "Win when the target contract balance drops below the threshold",
      };
    case "nftSalesProfit":
      return {
        balance: "NFT Sales Profit",
        target:  "Profit Target",
        hint:    "Progress tracks cumulative profit from NFT sales",
      };
    default:
      return {
        balance: "Balance",
        target:  "Target",
        hint:    "",
      };
  }
}

export class ProgressPanel {
  constructor(container: HTMLElement, ws: WSClient) {
    container.innerHTML = `
      <div class="panel-title">PROGRESS</div>
      <div class="progress-wrap">
        <div class="progress-bar-bg">
          <div id="progress-fill" class="progress-fill" style="width:0%"></div>
        </div>
        <div id="progress-label" class="progress-label">Start a challenge</div>
      </div>
      <div id="progress-hint" class="progress-hint" style="display:none"></div>
      <div class="stat-row">
        <span id="balance-label">Balance</span>
        <span id="balance-el" class="stat-value">–</span>
      </div>
      <div class="stat-row">
        <span id="target-label">Target</span>
        <span id="target-el" class="stat-value">–</span>
      </div>
      <div class="portfolio-section" id="portfolio-section" style="display:none">
        <div class="portfolio-divider"></div>
        <div class="panel-title" style="margin-top:10px">PORTFOLIO</div>
        <div id="portfolio-list" class="portfolio-list"></div>
        <div id="portfolio-total-row" class="stat-row portfolio-total-row" style="display:none">
          <span class="portfolio-sym portfolio-total-label">Total ≈</span>
          <span id="portfolio-total-el" class="stat-value portfolio-amt"></span>
        </div>
      </div>
    `;

    const fillEl         = container.querySelector("#progress-fill")!       as HTMLElement;
    const labelEl        = container.querySelector("#progress-label")!      as HTMLElement;
    const hintEl         = container.querySelector("#progress-hint")!       as HTMLElement;
    const balanceLabelEl = container.querySelector("#balance-label")!       as HTMLElement;
    const balanceEl      = container.querySelector("#balance-el")!          as HTMLElement;
    const targetLabelEl  = container.querySelector("#target-label")!        as HTMLElement;
    const targetEl       = container.querySelector("#target-el")!           as HTMLElement;
    const portfolioSection    = container.querySelector("#portfolio-section")!    as HTMLElement;
    const portfolioList       = container.querySelector("#portfolio-list")!       as HTMLElement;
    const portfolioTotalRow   = container.querySelector("#portfolio-total-row")!  as HTMLElement;
    const portfolioTotalEl    = container.querySelector("#portfolio-total-el")!   as HTMLElement;

    ws.on("challenge", (raw) => {
      const s = raw as ChallengeState;
      if (s.status === "idle") {
        fillEl.style.width = "0%";
        fillEl.style.background = "#388bfd";
        labelEl.textContent  = "Start a challenge";
        hintEl.style.display = "none";
        balanceLabelEl.textContent = "Balance";
        balanceEl.textContent = "–";
        targetLabelEl.textContent  = "Target";
        targetEl.textContent  = "–";
        portfolioSection.style.display = "none";
        portfolioTotalRow.style.display = "none";
        portfolioList.innerHTML = "";
        return;
      }
      if (!s.playerBalance || !s.targetBalance) return;

      const labels = metricLabel(s.metric);

      // Update stat row labels
      balanceLabelEl.textContent = labels.balance;
      targetLabelEl.textContent  = labels.target;

      // Show metric hint
      if (labels.hint) {
        hintEl.textContent     = labels.hint;
        hintEl.style.display   = "block";
      } else {
        hintEl.style.display   = "none";
      }

      const current = Number(BigInt(s.playerBalance)) / 1e18;
      const target  = Number(BigInt(s.targetBalance)) / 1e18;

      // Determine display unit suffix based on metric
      const isTokenMetric = s.metric === "tokenBalance" || s.metric === "usdBalance";
      const valueSuffix = isTokenMetric ? "" : " ETH";

      let pct: number;
      if (s.metric === "drainContract") {
        // For drain: 0% = full (nothing drained), 100% = fully drained (current <= 0)
        // Show how much has been removed: (target - current) / target, capped at 100%
        pct = target > 0 ? Math.min(100, Math.max(0, (1 - current / target) * 100)) : (current <= 0 ? 100 : 0);
        balanceEl.textContent = `${current.toFixed(4)} (remaining)`;
        targetEl.textContent  = `< ${target.toFixed(4)}`;
      } else {
        pct = Math.min(100, (current / target) * 100);
        balanceEl.textContent = `${current.toFixed(4)}${valueSuffix}`;
        targetEl.textContent  = `${target.toFixed(4)}${valueSuffix}`;
      }

      fillEl.style.width      = `${pct}%`;
      fillEl.style.background = pct >= 100 ? "#3fb950" : "#388bfd";
      labelEl.textContent     = `${pct.toFixed(1)}%`;

      // Portfolio balances
      if (s.balances && Object.keys(s.balances).length > 0) {
        portfolioSection.style.display = "block";
        portfolioList.innerHTML = Object.entries(s.balances)
          .map(([sym, amt]) => `
            <div class="stat-row">
              <span class="portfolio-sym">${sym}</span>
              <span class="stat-value portfolio-amt">${amt}</span>
            </div>
          `).join("");

        // For portfolio-value metrics, show a total row that matches the progress bar value
        // so it's clear the progress bar IS the portfolio total.
        if (s.metric === "portfolioValueInEth" || s.metric === "nftSalesProfit") {
          portfolioTotalRow.style.display = "flex";
          portfolioTotalEl.textContent    = `${current.toFixed(4)} ETH`;
        } else {
          portfolioTotalRow.style.display = "none";
        }
      } else {
        portfolioSection.style.display = "none";
        portfolioTotalRow.style.display = "none";
        portfolioList.innerHTML = "";
      }
    });
  }
}
