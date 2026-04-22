import type { WSClient } from "../ws/WSClient.js";

interface TriggerInfo {
  id:           string;
  type:         string;
  description:  string;
  pair?:        string;
  threshold?:   number;
  active:       boolean;
}

interface TriggerFiredPayload {
  triggerId:   string;
  triggerType: string;
  blockNumber: number;
  pair?:       string;
  price?:      number;
}

export class TriggerPanel {
  private listEl:            HTMLElement;
  private logEl:             HTMLElement;
  private ws:                WSClient;
  private _activeChallengeId: string | null = null;

  constructor(container: HTMLElement, ws: WSClient) {
    this.ws = ws;
    container.innerHTML = `
      <div class="panel-title">TRIGGERS</div>
      <div id="trigger-list" class="trigger-list"></div>
      <div class="panel-title" style="margin-top:12px;">SCRIPT LOG</div>
      <div id="script-log" class="script-log"></div>
    `;
    this.listEl = container.querySelector("#trigger-list")!;
    this.logEl  = container.querySelector("#script-log")!;

    ws.on("triggers", (raw) => {
      const p = raw as { triggers: TriggerInfo[] };
      this._renderTriggers(p.triggers);
    });

    // Clear the trigger list when the active challenge changes so stale
    // triggers from a previous challenge don't remain visible.
    // We track the challenge ID rather than reacting to every `running`
    // broadcast (which fires every block and would wipe the panel
    // while the challenge is ongoing).
    ws.on("challenge", (raw) => {
      const p = raw as { id: string; status: string };
      if (p.status === "running" && p.id !== this._activeChallengeId) {
        this._activeChallengeId = p.id;
        this._renderTriggers([]);
      }
    });

    ws.on("trigger_fired", (raw) => {
      const p = raw as TriggerFiredPayload;
      const badge = document.createElement("div");
      badge.className = "log-line log-trigger";
      badge.textContent = `[${p.blockNumber}] ${p.triggerType} ${p.pair ? `(${p.pair} @ ${p.price?.toFixed(2)})` : ""}`;
      this.logEl.prepend(badge);
      if (this.logEl.children.length > 50) this.logEl.lastChild?.remove();
    });

    ws.on("script_log", (raw) => {
      const p = raw as { level: string; message: string; blockNumber: number };
      const line = document.createElement("div");
      line.className = `log-line log-${p.level}`;
      line.textContent = `[${p.blockNumber}] ${p.message}`;
      this.logEl.prepend(line);
      if (this.logEl.children.length > 50) this.logEl.lastChild?.remove();
    });
  }

  private _renderTriggers(triggers: TriggerInfo[]) {
    if (triggers.length === 0) {
      this.listEl.innerHTML = '<div class="empty-state">No active triggers</div>';
      return;
    }
    this.listEl.innerHTML = triggers.map(t => `
      <div class="trigger-item ${t.active ? "" : "inactive"}">
        <div class="trigger-info">
          <span class="trigger-desc">${t.description ?? t.type}</span>
          <span class="trigger-type-badge">${t.type}</span>
        </div>
        <button class="btn-remove" data-id="${t.id}">×</button>
      </div>
    `).join("");

    this.listEl.querySelectorAll(".btn-remove").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = (btn as HTMLElement).dataset.id!;
        this.ws.send("trigger_remove", { triggerId: id });
      });
    });
  }
}
