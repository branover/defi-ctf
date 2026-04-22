/**
 * UI tests — Pool Depth Panel.
 *
 * Verifies that liquidity data surfaces in the left-sidebar depth panel
 * once a challenge is running and price WS messages flow in.
 */

import { test, expect } from "@playwright/test";
import {
  waitForEngine,
  openApp,
  startChallenge,
  stopChallenge,
} from "./helpers.js";

test.beforeAll(async () => {
  await waitForEngine();
});

test.afterEach(async ({ page }) => {
  await stopChallenge(page).catch(() => {});
});

// ── Before challenge ──────────────────────────────────────────────────────────

test("depth panel shows empty-state before any challenge starts", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("#depth-pools .empty-state")).toBeVisible();
  await expect(page.locator("#depth-pools .empty-state")).toContainText("Start a challenge");
});

// ── After challenge starts ────────────────────────────────────────────────────

test("depth panel populates with pool section after wave-rider starts", async ({ page }) => {
  await openApp(page);
  await startChallenge(page, "wave-rider");

  // Pool depth updates on every price message; should appear within a few blocks
  await expect(page.locator(".depth-pool-section")).toBeVisible({ timeout: 20_000 });
});

test("depth pool header shows exchange name and token pair", async ({ page }) => {
  await openApp(page);
  await startChallenge(page, "wave-rider");

  await expect(page.locator(".depth-pool-section")).toBeVisible({ timeout: 20_000 });

  const header = page.locator(".depth-pool-header").first();
  await expect(header).toBeVisible();

  // wave-rider uses Uniswap
  const headerText = await header.textContent();
  expect(headerText).toContain("WETH");
  expect(headerText).toContain("USDC");
});

test("depth panel shows current price in pool header", async ({ page }) => {
  await openApp(page);
  await startChallenge(page, "wave-rider");
  await expect(page.locator(".depth-pool-section")).toBeVisible({ timeout: 20_000 });

  const priceText = await page.locator(".depth-pool-price").first().textContent();
  // Should be a dollar amount like "$3000.00"
  expect(priceText).toMatch(/\$[\d,.]+/);
  const price = parseFloat(priceText.replace(/[$,]/g, ""));
  expect(price).toBeGreaterThan(100); // WETH should be well above $100
});

test("depth panel shows TVL line", async ({ page }) => {
  await openApp(page);
  await startChallenge(page, "wave-rider");
  await expect(page.locator(".depth-pool-section")).toBeVisible({ timeout: 20_000 });

  const tvlText = await page.locator(".depth-tvl").first().textContent();
  expect(tvlText).toContain("TVL");
  expect(tvlText).toMatch(/\$[\d.,]+[KM]/); // e.g. $6.00M
});

test("depth impact table has 4 slippage rows", async ({ page }) => {
  await openApp(page);
  await startChallenge(page, "wave-rider");
  await expect(page.locator(".depth-pool-section")).toBeVisible({ timeout: 20_000 });

  const rows = page.locator(".depth-impact-row");
  await expect(rows).toHaveCount(4);
  const labels = await rows.allTextContents();
  expect(labels.some((t) => t.includes("1% slippage"))).toBe(true);
  expect(labels.some((t) => t.includes("5% slippage"))).toBe(true);
  expect(labels.some((t) => t.includes("10% slippage"))).toBe(true);
});

test("depth bands section has 3 band rows (±1%, ±5%, ±10%)", async ({ page }) => {
  await openApp(page);
  await startChallenge(page, "wave-rider");
  await expect(page.locator(".depth-pool-section")).toBeVisible({ timeout: 20_000 });

  const rows = page.locator(".depth-band-row");
  await expect(rows).toHaveCount(3);
});

test("bid/ask depth bars are rendered with non-zero widths", async ({ page }) => {
  await openApp(page);
  await startChallenge(page, "wave-rider");
  await expect(page.locator(".depth-pool-section")).toBeVisible({ timeout: 20_000 });

  // At least one bid and one ask bar should have a non-zero width
  const bidBars  = await page.locator(".depth-bar-bid").all();
  const askBars  = await page.locator(".depth-bar-ask").all();
  expect(bidBars.length).toBeGreaterThan(0);
  expect(askBars.length).toBeGreaterThan(0);

  const someNonZero = async (bars) => {
    for (const bar of bars) {
      const w = await bar.evaluate((el) => el.style.width);
      if (w && w !== "0%" && w !== "0px") return true;
    }
    return false;
  };
  expect(await someNonZero(bidBars)).toBe(true);
  expect(await someNonZero(askBars)).toBe(true);
});

// ── Two-pool challenge ────────────────────────────────────────────────────────

test("the-spread shows two pool depth sections", async ({ page }) => {
  await openApp(page);
  await startChallenge(page, "the-spread");

  // Wait for first section, then assert count
  await expect(page.locator(".depth-pool-section").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".depth-pool-section")).toHaveCount(2, { timeout: 10_000 });
});

// ── Cleanup on stop ───────────────────────────────────────────────────────────

test("depth panel returns to empty-state after challenge stops", async ({ page }) => {
  await openApp(page);
  await startChallenge(page, "wave-rider");
  await expect(page.locator(".depth-pool-section")).toBeVisible({ timeout: 20_000 });

  await page.click("#btn-stop");

  await expect(page.locator("#depth-pools .empty-state")).toBeVisible({ timeout: 15_000 });
});
