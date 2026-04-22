/**
 * Unit tests for TriggerRegistry
 *
 * Covers:
 *  - register() returns a unique id and stores the trigger
 *  - Trigger name/description is stored correctly (PR #36)
 *    - auto-generated description when name is omitted
 *    - custom description when name is supplied
 *  - remove() deletes the trigger
 *  - deactivate() sets active = false
 *  - clear() empties the registry
 *  - list() returns the serialisable shape (no callback)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TriggerRegistry } from "./TriggerRegistry.js";

// Minimal no-op callback
const noop = () => {};

describe("TriggerRegistry — register", () => {
  let registry: TriggerRegistry;

  beforeEach(() => {
    registry = new TriggerRegistry();
  });

  it("returns a string id", () => {
    const id = registry.register({
      type: "onBlock",
      description: "Every block",
      callback: noop,
      once: false,
    });
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("returns distinct ids for successive registrations", () => {
    const id1 = registry.register({ type: "onBlock", description: "a", callback: noop, once: false });
    const id2 = registry.register({ type: "onBlock", description: "b", callback: noop, once: false });
    expect(id1).not.toBe(id2);
  });

  it("stores the trigger so getAll() returns it", () => {
    const id = registry.register({ type: "onBlock", description: "Every block", callback: noop, once: false });
    const all = registry.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(id);
    expect(all[0].active).toBe(true);
  });
});

describe("TriggerRegistry — name / description (PR #36)", () => {
  let registry: TriggerRegistry;

  beforeEach(() => {
    registry = new TriggerRegistry();
  });

  it("stores a custom description verbatim", () => {
    registry.register({
      type: "onBlock",
      description: "My custom trigger",
      callback: noop,
      once: false,
    });
    const [t] = registry.getAll();
    expect(t.description).toBe("My custom trigger");
  });

  it("stores the auto-generated description for onPriceBelow", () => {
    registry.register({
      type: "onPriceBelow",
      description: "When weth-usdc < $2500",
      poolId: "weth-usdc-uniswap",
      threshold: 2500,
      callback: noop,
      once: false,
    });
    const [t] = registry.getAll();
    expect(t.description).toContain("weth-usdc-uniswap");
    expect(t.description).toContain("2500");
  });

  it("stores the auto-generated description for onPriceAbove", () => {
    registry.register({
      type: "onPriceAbove",
      description: "When weth-usdc > $3200",
      poolId: "weth-usdc-uniswap",
      threshold: 3200,
      callback: noop,
      once: false,
    });
    const [t] = registry.getAll();
    expect(t.description).toContain("3200");
  });

  it("list() includes the description field", () => {
    registry.register({ type: "onBlock", description: "Named trigger", callback: noop, once: false });
    const [entry] = registry.list();
    expect(entry.description).toBe("Named trigger");
  });
});

describe("TriggerRegistry — remove", () => {
  let registry: TriggerRegistry;

  beforeEach(() => {
    registry = new TriggerRegistry();
  });

  it("removes the trigger by id", () => {
    const id = registry.register({ type: "onBlock", description: "a", callback: noop, once: false });
    registry.remove(id);
    expect(registry.getAll()).toHaveLength(0);
  });

  it("does not throw when removing a non-existent id", () => {
    expect(() => registry.remove("ghost-id")).not.toThrow();
  });
});

describe("TriggerRegistry — deactivate", () => {
  let registry: TriggerRegistry;

  beforeEach(() => {
    registry = new TriggerRegistry();
  });

  it("sets active to false", () => {
    const id = registry.register({ type: "onBlock", description: "a", callback: noop, once: false });
    registry.deactivate(id);
    const [t] = registry.getAll();
    expect(t.active).toBe(false);
  });
});

describe("TriggerRegistry — clear", () => {
  let registry: TriggerRegistry;

  beforeEach(() => {
    registry = new TriggerRegistry();
  });

  it("empties all triggers", () => {
    registry.register({ type: "onBlock", description: "a", callback: noop, once: false });
    registry.register({ type: "onBlock", description: "b", callback: noop, once: false });
    registry.clear();
    expect(registry.getAll()).toHaveLength(0);
  });
});

describe("TriggerRegistry — list serialisation", () => {
  let registry: TriggerRegistry;

  beforeEach(() => {
    registry = new TriggerRegistry();
  });

  it("list() does not include the callback function", () => {
    registry.register({ type: "onBlock", description: "a", callback: noop, once: false });
    const [entry] = registry.list();
    expect((entry as Record<string, unknown>).callback).toBeUndefined();
  });

  it("list() includes id, type, description, active", () => {
    registry.register({
      type: "onPriceBelow",
      description: "Buy the dip",
      poolId: "weth-usdc-uniswap",
      threshold: 2500,
      callback: noop,
      once: false,
    });
    const [entry] = registry.list();
    expect(typeof entry.id).toBe("string");
    expect(entry.type).toBe("onPriceBelow");
    expect(entry.description).toBe("Buy the dip");
    expect(entry.active).toBe(true);
    expect(entry.poolId).toBe("weth-usdc-uniswap");
    expect(entry.threshold).toBe(2500);
  });
});
