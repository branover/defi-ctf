/**
 * UI tests — chart rendering and split-view controls.
 */

import { test, expect } from "@playwright/test";
import {
  waitForEngine,
  openApp,
  startChallenge,
  stopChallenge,
} from "./helpers.js";

const ENGINE_URL = process.env.ENGINE_URL ?? "http://localhost:3000";

test.beforeAll(async () => {
  await waitForEngine();
});

test.afterEach(async ({ page }) => {
  await stopChallenge(page).catch(() => {});
});

// ── Chart presence ────────────────────────────────────────────────────────────

test("chart grid element is present on page load", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("#chart-grid")).toBeVisible();
});

test("chart canvas renders after challenge starts", async ({ page }) => {
  await openApp(page);
  await startChallenge(page, "wave-rider");

  // lightweight-charts v5 uses multiple canvases per chart; assert by chart cell + any canvas inside it
  await expect(page.locator("#chart-grid .chart-cell")).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator("#chart-grid .chart-cell").first().locator("canvas").first()).toBeVisible({
    timeout: 15_000,
  });
});

test("candle data accumulates in history API after a few blocks", async ({ page }) => {
  await startChallenge(page, "wave-rider");

  // Wait a bit for blocks to mine, then check history endpoint
  await page.waitForFunction(
    () => {
      const [cur] = (document.querySelector("#block-el")?.textContent ?? "0").split("/");
      return parseInt(cur.trim(), 10) >= 2;
    },
    null,
    { timeout: 40_000 },
  );

  // Hit the history API directly from the test runner
  const resp = await fetch(`${ENGINE_URL}/api/history/weth-usdc-uniswap?lastN=50`);
  expect(resp.ok).toBe(true);
  const candles = await resp.json();
  expect(Array.isArray(candles)).toBe(true);
  expect(candles.length).toBeGreaterThan(0);

  // Each candle should have OHLCV shape
  const c = candles[0];
  expect(typeof c.time).toBe("number");
  expect(typeof c.open).toBe("number");
  expect(typeof c.high).toBe("number");
  expect(typeof c.low).toBe("number");
  expect(typeof c.close).toBe("number");
});

// ── Split-view buttons ────────────────────────────────────────────────────────

test("1× split button starts active", async ({ page }) => {
  await openApp(page);
  await expect(page.locator(".split-btn[data-split='1']")).toHaveClass(/active/);
  await expect(page.locator(".split-btn[data-split='2']")).not.toHaveClass(/active/);
});

test("clicking 2× activates that button and deactivates 1×", async ({ page }) => {
  await openApp(page);
  await page.click(".split-btn[data-split='2']");
  await expect(page.locator(".split-btn[data-split='2']")).toHaveClass(/active/);
  await expect(page.locator(".split-btn[data-split='1']")).not.toHaveClass(/active/);
});

test("clicking 4× activates that button", async ({ page }) => {
  await openApp(page);
  await page.click(".split-btn[data-split='4']");
  await expect(page.locator(".split-btn[data-split='4']")).toHaveClass(/active/);
});

test("can cycle through all split modes without error", async ({ page }) => {
  await openApp(page);
  for (const n of ["2", "4", "1"]) {
    await page.click(`.split-btn[data-split='${n}']`);
    await expect(page.locator(`.split-btn[data-split='${n}']`)).toHaveClass(/active/);
  }
});

test("split mode shows one chart cell per layout slot", async ({ page }) => {
  await openApp(page);
  await startChallenge(page, "wave-rider");
  await expect(page.locator("#chart-grid .chart-cell")).toHaveCount(1, { timeout: 15_000 });
  await page.click(".split-btn[data-split='2']");
  await expect(page.locator("#chart-grid .chart-cell")).toHaveCount(2, { timeout: 15_000 });
  await page.click(".split-btn[data-split='1']");
  await expect(page.locator("#chart-grid .chart-cell")).toHaveCount(1, { timeout: 15_000 });
});

// ── Speed slider ──────────────────────────────────────────────────────────────

test("speed slider reflects value change and updates display label", async ({ page }) => {
  await openApp(page);
  await startChallenge(page, "wave-rider");

  await expect(page.locator("#speed-slider")).toBeEnabled();

  // Change to 3×
  await page.locator("#speed-slider").fill("3");
  await page.locator("#speed-slider").dispatchEvent("input");

  await expect(page.locator("#speed-current")).toHaveText("3×");
});

test("speed slider sends set_speed message over WebSocket", async ({ page }) => {
  let capturedSpeed = null;
  page.on("websocket", (ws) => {
    ws.on("framesent", (frame) => {
      try {
        const msg = JSON.parse(frame.payload);
        if (msg.type === "control" && msg.payload?.action === "set_speed") {
          capturedSpeed = msg.payload.speed;
        }
      } catch {}
    });
  });

  await openApp(page);
  await startChallenge(page, "wave-rider");
  await page.locator("#speed-slider").fill("4");
  await page.locator("#speed-slider").dispatchEvent("input");

  await page.waitForFunction(() => true); // flush microtasks
  expect(capturedSpeed).toBe(4);
});

// ── Platform / pair dropdown switching ────────────────────────────────────────

test("changing platform updates selected pair options (the-spread)", async ({ page }) => {
  await startChallenge(page, "the-spread");

  const cell = page.locator(".chart-cell").first();
  const platform = cell.locator(".platform-select");
  await expect(platform.locator("option")).toHaveCount(2, { timeout: 15_000 });
  await platform.selectOption({ index: 1 });
  await expect(cell.locator(".pair-select")).toHaveValue(/weth-usdc-uniswap/);
});
