export type TriggerType = "onBlock" | "onPriceBelow" | "onPriceAbove" | "onEvent";

export interface Trigger {
  id:           string;
  type:         TriggerType;
  /** Human-readable label. Auto-generated if not supplied by the player. */
  description:  string;
  /** Pool ID (e.g. "weth-usdc-uniswap") — the primary identifier for price triggers. */
  poolId?:      string;
  /** @deprecated use poolId instead */
  pair?:        string;
  threshold?:   number;
  contract?:    string;
  eventName?:   string;
  callback: (ctx: unknown) => Promise<void> | void;
  once:     boolean;
  active:   boolean;
}

let _counter = 0;

export class TriggerRegistry {
  private triggers = new Map<string, Trigger>();

  register(trigger: Omit<Trigger, "id" | "active">): string {
    const id = `trig_${++_counter}`;
    this.triggers.set(id, { ...trigger, id, active: true });
    return id;
  }

  remove(id: string): void {
    this.triggers.delete(id);
  }

  deactivate(id: string): void {
    const t = this.triggers.get(id);
    if (t) t.active = false;
  }

  getAll(): Trigger[] {
    return [...this.triggers.values()];
  }

  clear(): void {
    this.triggers.clear();
  }

  list() {
    return [...this.triggers.values()].map(({ id, type, description, poolId, pair, threshold, active }) => ({
      id, type, description,
      // Prefer poolId; fall back to legacy pair field for backward compat
      poolId: poolId ?? pair,
      pair:   poolId ?? pair,
      threshold, active,
    }));
  }
}
