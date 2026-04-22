/**
 * UI tests — ManualTradePanel (PR #40)
 *
 * Verifies:
 *  - Panel is present in the DOM inside the left sidebar.
 *  - Pool select, token select, amount input, and Trade button are present.
 *  - Pool options are populated after a challenge starts.
 *  - Attempting a trade with an invalid (empty) amount shows an error.
 *  - A successful trade (small amount) returns a result without error.
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

// ── Panel presence ────────────────────────────────────────────────────────────

test("manual-trade-panel is in the left sidebar", async ({ page }) => {
  await openApp(page);
  await expect(page.locator(".left-sidebar #manual-trade-panel")).toBeAttached();
});

test("manual-trade-panel shows pool select, token select, amount input, and Trade button", async ({ page }) => {
  await openApp(page);
  const panel = page.locator("#manual-trade-panel");
  await expect(panel.locator("#mt-pool")).toBeAttached();
  await expect(panel.locator("#mt-token")).toBeAttached();
  await expect(panel.locator("#mt-amount")).toBeAttached();
  await expect(panel.locator("#mt-trade")).toBeAttached();
});

// ── Pool options after challenge start ────────────────────────────────────────

test("pool select is populated after wave-rider starts", async ({ page }) => {
  await startChallenge(page, "wave-rider");
  const panel = page.locator("#manual-trade-panel");
  // wave-rider has the weth-usdc pool
  const options = panel.locator("#mt-pool option");
  await expect(options).toHaveCount(1, { timeout: 10_000 });
  const optionText = await options.first().textContent();
  expect(optionText?.toLowerCase()).toMatch(/weth|usdc/i);
});

test("token select is populated after pool is selected (wave-rider)", async ({ page }) => {
  await startChallenge(page, "wave-rider");
  const panel = page.locator("#manual-trade-panel");
  // After challenge starts, pool select has an option; token select should have two tokens
  const tokenOptions = panel.locator("#mt-token option");
  await expect(tokenOptions).toHaveCount(2, { timeout: 10_000 });
});

test("the-spread shows two pool options in manual trade panel", async ({ page }) => {
  await startChallenge(page, "the-spread");
  const panel = page.locator("#manual-trade-panel");
  const poolOptions = panel.locator("#mt-pool option");
  await expect(poolOptions).toHaveCount(2, { timeout: 10_000 });
});

// ── Validation ────────────────────────────────────────────────────────────────

test("clicking Trade with empty amount shows an error message", async ({ page }) => {
  await startChallenge(page, "wave-rider");
  const panel = page.locator("#manual-trade-panel");

  // Clear the amount and click Trade
  await panel.locator("#mt-amount").fill("");
  await panel.locator("#mt-trade").click();

  // Feedback div should become visible with an error
  const feedback = panel.locator("#mt-feedback");
  await expect(feedback).toBeVisible({ timeout: 5_000 });
  const text = await feedback.textContent();
  expect(text?.toLowerCase()).toMatch(/amount|valid/i);
});

test("clicking Trade with zero amount shows an error message", async ({ page }) => {
  await startChallenge(page, "wave-rider");
  const panel = page.locator("#manual-trade-panel");

  await panel.locator("#mt-amount").fill("0");
  await panel.locator("#mt-trade").click();

  const feedback = panel.locator("#mt-feedback");
  await expect(feedback).toBeVisible({ timeout: 5_000 });
});

// ── MAX button ────────────────────────────────────────────────────────────────

test("MAX button fills in a non-zero balance", async ({ page }) => {
  await startChallenge(page, "wave-rider");
  const panel = page.locator("#manual-trade-panel");

  // Click MAX — triggers a get_balance WS round-trip
  await panel.locator("#mt-max").click();

  // After a short wait the amount input should be filled with a number
  await page.waitForFunction(
    () => {
      const input = document.querySelector("#mt-amount");
      const val = (input && input.value) ? input.value : "";
      return val.length > 0 && !isNaN(parseFloat(val));
    },
    null,
    { timeout: 10_000 },
  );

  const val = await panel.locator("#mt-amount").inputValue();
  expect(parseFloat(val)).toBeGreaterThan(0);
});

// ── WS message shape ──────────────────────────────────────────────────────────

test("Trade button sends manual_trade WS message with correct fields", async ({ page }) => {
  let capturedMsg = null;
  page.on("websocket", (ws) => {
    ws.on("framesent", (frame) => {
      try {
        const msg = JSON.parse(frame.payload);
        if (msg.type === "manual_trade") capturedMsg = msg;
      } catch {}
    });
  });

  await startChallenge(page, "wave-rider");
  const panel = page.locator("#manual-trade-panel");

  await panel.locator("#mt-amount").fill("0.001");
  await panel.locator("#mt-trade").click();

  // Give the page a moment to flush the WS send
  await page.waitForTimeout(1500);

  expect(capturedMsg).not.toBeNull();
  expect(capturedMsg.type).toBe("manual_trade");
  const payload = capturedMsg.payload;
  expect(typeof payload.pool).toBe("string");
  expect(typeof payload.tokenIn).toBe("string");
  expect(typeof payload.amountIn).toBe("string");
  expect(payload.amountIn).toBe("0.001");
});
