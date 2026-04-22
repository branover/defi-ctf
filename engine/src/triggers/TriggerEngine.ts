import type { TriggerRegistry, Trigger } from "./TriggerRegistry.js";
import type { PoolRegistry } from "../market/PoolRegistry.js";

type BroadcastFn = (type: string, payload: unknown) => void;

export class TriggerEngine {
  constructor(
    private registry:  TriggerRegistry,
    private pools:     PoolRegistry,
    private broadcast: BroadcastFn,
  ) {}

  async tick(blockNumber: number): Promise<void> {
    const triggers = this.registry.getAll().filter(t => t.active);

    // Fetch current prices once for all price triggers.
    // Resolve the pool identifier: prefer poolId, fall back to legacy pair field.
    const priceCache = new Map<string, number>();
    const priceTriggers = triggers.filter(t => t.type === "onPriceBelow" || t.type === "onPriceAbove");
    const poolIds = [...new Set(priceTriggers.map(t => (t.poolId ?? t.pair)!))];
    await Promise.all(poolIds.map(async (poolId) => {
      try {
        priceCache.set(poolId, await this.pools.getSpotPrice(poolId));
      } catch {}
    }));

    for (const trigger of triggers) {
      try {
        const fired = await this._evaluate(trigger, blockNumber, priceCache);
        if (fired) {
          const triggerPoolId = trigger.poolId ?? trigger.pair;
          this.broadcast("trigger_fired", {
            triggerId:   trigger.id,
            triggerType: trigger.type,
            blockNumber,
            poolId: triggerPoolId,
            pair:   triggerPoolId,   // kept for backward compat
            price:  triggerPoolId ? priceCache.get(triggerPoolId) : undefined,
          });
          if (trigger.once) this.registry.deactivate(trigger.id);
        }
      } catch (e) {
        console.error(`[TriggerEngine] trigger ${trigger.id} error:`, e);
      }
    }
  }

  private async _evaluate(
    trigger: Trigger,
    blockNumber: number,
    priceCache: Map<string, number>,
  ): Promise<boolean> {
    switch (trigger.type) {
      case "onBlock": {
        const ctx = { blockNumber, timestamp: Date.now() };
        await trigger.callback(ctx);
        return true;
      }

      case "onPriceBelow": {
        const poolId = (trigger.poolId ?? trigger.pair)!;
        const price = priceCache.get(poolId);
        if (price === undefined || price >= trigger.threshold!) return false;
        const ctx = { blockNumber, poolId, pair: poolId, price };
        await trigger.callback(ctx);
        return true;
      }

      case "onPriceAbove": {
        const poolId = (trigger.poolId ?? trigger.pair)!;
        const price = priceCache.get(poolId);
        if (price === undefined || price <= trigger.threshold!) return false;
        const ctx = { blockNumber, poolId, pair: poolId, price };
        await trigger.callback(ctx);
        return true;
      }

      default:
        return false;
    }
  }

  clear() {
    this.registry.clear();
  }
}
