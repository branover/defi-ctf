import { describe, expect, it } from "vitest";
import {
  askDepth,
  bidDepth,
  fmtToken,
  fmtUSD,
  maxTradeForImpact,
} from "./poolDepthMath.js";

describe("maxTradeForImpact", () => {
  it("returns 0 for non-positive slippage", () => {
    expect(maxTradeForImpact(0, 1000)).toBe(0);
    expect(maxTradeForImpact(-1, 1000)).toBe(0);
  });

  it("returns positive trade size for typical pool", () => {
    const t = maxTradeForImpact(1, 1_000_000);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(50_000);
  });
});

describe("askDepth / bidDepth", () => {
  it("are positive for small moves on deep pool", () => {
    const r0 = 5000;
    expect(askDepth(1, r0)).toBeGreaterThan(0);
    expect(bidDepth(1, r0)).toBeGreaterThan(0);
  });
});

describe("fmtUSD", () => {
  it("formats millions and thousands", () => {
    expect(fmtUSD(2_500_000)).toMatch(/2\.50M/);
    expect(fmtUSD(3500)).toMatch(/3\.5K/);
    expect(fmtUSD(42)).toBe("$42");
  });
});

describe("fmtToken", () => {
  it("reduces decimals for large values", () => {
    expect(fmtToken(12_345, 18)).toBe("12345");
    expect(fmtToken(0.5, 18)).toContain("0.");
  });
});
