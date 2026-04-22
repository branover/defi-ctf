/**
 * UI tests — challenge lifecycle (start / pause / resume / stop).
 *
 * Each test that starts a challenge also stops it in afterEach cleanup.
 */

import { test, expect } from "@playwright/test";
import {
  waitForEngine,
  waitForStatus,
  selectChallenge,
  startChallenge,
  stopChallenge,
} from "./helpers.js";

test.beforeAll(async () => {
  await waitForEngine();
});

test.afterEach(async ({ page }) => {
  // Always clean up — stop any running challenge so the next test starts fresh
  await stopChallenge(page).catch(() => {});
});

// ── Start flow ────────────────────────────────────────────────────────────────

test("Start button shows 'Starting…' immediately after click", async ({ page }) => {
  await selectChallenge(page, "wave-rider");
  await page.click("#btn-start");
  // The button text should briefly change before the status arrives
  await expect(page.locator("#btn-start")).toHaveText("Starting…", { timeout: 5_000 });
});

test("status badge reaches 'running' after starting wave-rider", async ({ page }) => {
  await startChallenge(page, "wave-rider");
  await expect(page.locator("#status-el")).toHaveText("running");
});

test("status badge reaches 'running' after starting the-spread", async ({ page }) => {
  await startChallenge(page, "the-spread");
  await expect(page.locator("#status-el")).toHaveText("running");
});

// ── Button states when running ────────────────────────────────────────────────

test("Stop is enabled and Start is disabled while running", async ({ page }) => {
  await startChallenge(page);
  await expect(page.locator("#btn-stop")).toBeEnabled();
  await expect(page.locator("#btn-start")).toBeDisabled();
});

test("Pause is enabled and Resume is disabled while running", async ({ page }) => {
  await startChallenge(page);
  await expect(page.locator("#btn-pause")).toBeEnabled();
  await expect(page.locator("#btn-resume")).toBeDisabled();
});

test("speed slider is enabled while running", async ({ page }) => {
  await startChallenge(page);
  await expect(page.locator("#speed-slider")).toBeEnabled();
});

// ── Block counter ─────────────────────────────────────────────────────────────

test("block counter increments while running", async ({ page }) => {
  await startChallenge(page);

  const read = () =>
    page.$eval("#block-el", (el) => {
      const [cur] = el.textContent.split("/");
      return parseInt(cur.trim(), 10);
    });

  const b1 = await read();
  // Wait for at least 2 new blocks (default interval ~400ms each)
  await page.waitForFunction(
    (initial) => {
      const [cur] = (document.querySelector("#block-el")?.textContent ?? "0").split("/");
      return parseInt(cur.trim(), 10) > initial;
    },
    b1,
    { timeout: 40_000 },
  );
  const b2 = await read();
  expect(b2).toBeGreaterThan(b1);
});

// ── Chart selectors ────────────────────────────────────────────────────────────

test("wave-rider shows one platform option and one pair option", async ({ page }) => {
  await startChallenge(page, "wave-rider");
  await expect(page.locator(".chart-cell").first().locator(".platform-select option")).toHaveCount(1);
  await expect(page.locator(".chart-cell").first().locator(".pair-select option")).toHaveCount(1);
});

test("the-spread shows two platform options in each chart view", async ({ page }) => {
  await startChallenge(page, "the-spread");
  await expect(page.locator(".chart-cell").first().locator(".platform-select option")).toHaveCount(2, { timeout: 15_000 });
});

// ── Pause / Resume ────────────────────────────────────────────────────────────

test("clicking Pause changes status to 'paused' and flips button states", async ({ page }) => {
  await startChallenge(page);
  await page.click("#btn-pause");
  await waitForStatus(page, "paused", 10_000);
  await expect(page.locator("#status-el")).toHaveText("paused");
  await expect(page.locator("#btn-pause")).toBeDisabled();
  await expect(page.locator("#btn-resume")).toBeEnabled();
});

test("clicking Resume after Pause restores 'running' status", async ({ page }) => {
  await startChallenge(page);
  await page.click("#btn-pause");
  await waitForStatus(page, "paused", 10_000);
  await page.click("#btn-resume");
  await waitForStatus(page, "running", 10_000);
  await expect(page.locator("#status-el")).toHaveText("running");
});

// ── Stop flow ─────────────────────────────────────────────────────────────────

test("clicking Stop returns status to 'idle'", async ({ page }) => {
  await startChallenge(page);
  await page.click("#btn-stop");
  await waitForStatus(page, "idle", 15_000);
  await expect(page.locator("#status-el")).toHaveText("idle");
});

test("after stopping, Start is re-enabled and Stop is disabled", async ({ page }) => {
  await startChallenge(page);
  await page.click("#btn-stop");
  await waitForStatus(page, "idle", 15_000);
  await expect(page.locator("#btn-start")).toBeEnabled();
  await expect(page.locator("#btn-stop")).toBeDisabled();
});

test("double-clicking Start does not submit two challenge_start messages", async ({ page }) => {
  let startCount = 0;
  page.on("websocket", (ws) => {
    ws.on("framesent", (frame) => {
      try {
        const msg = JSON.parse(frame.payload);
        if (msg.type === "challenge_start") startCount++;
      } catch {}
    });
  });

  await selectChallenge(page, "wave-rider");

  await page.click("#btn-start");
  // Subsequent clicks hit a disabled control while "Starting…"; use force to mimic rapid double-clicks.
  await page.click("#btn-start", { force: true });
  await page.click("#btn-start", { force: true });
  await waitForStatus(page, "running", 30_000);

  expect(startCount).toBe(1);
});
