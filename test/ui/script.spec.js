/**
 * UI tests — script editor (CodeMirror) and script execution.
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

// ── Editor presence ───────────────────────────────────────────────────────────

test("CodeMirror editor mounts inside .ide-editor-wrap", async ({ page }) => {
  await openApp(page);
  await expect(page.locator(".ide-editor-wrap .cm-editor")).toBeVisible();
});

test("default script is pre-loaded in the editor", async ({ page }) => {
  await openApp(page);
  const content = await page.locator(".cm-content").textContent();
  expect(content).toContain("onPriceBelow");
  expect(content).toContain("onPriceAbove");
});

test("Run button is visible and enabled in JS mode", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("#ide-run")).toBeVisible();
  await expect(page.locator("#ide-run")).toBeEnabled();
});

test("Stop button is visible next to Run in JS mode", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("#ide-stop")).toBeVisible();
});

// ── Editing the script ────────────────────────────────────────────────────────

test("user can type into the CodeMirror editor", async ({ page }) => {
  await openApp(page);

  // Click into the editor and select-all, type new content
  await page.click(".cm-content");
  await page.keyboard.press("Control+a");
  await page.keyboard.type("// test comment");

  const content = await page.locator(".cm-content").textContent();
  expect(content).toContain("test comment");
});

// ── Script execution and log output ──────────────────────────────────────────

test("running a simple log script appends to the script log panel", async ({ page }) => {
  await openApp(page);
  await startChallenge(page, "wave-rider");

  // Replace editor content with a simple log script
  await page.click(".cm-content");
  await page.keyboard.press("Control+a");
  await page.keyboard.type(`log("ui-test-ping-" + Date.now());`);

  // Click Run Script
  await page.click("#ide-run");

  await expect(
    page.locator("#script-log .log-line").filter({ hasText: /ui-test-ping-/ }),
  ).toHaveCount(1, { timeout: 10_000 });
});

test("running a getBalance script logs a numeric result", async ({ page }) => {
  await openApp(page);
  await startChallenge(page, "wave-rider");

  await page.click(".cm-content");
  await page.keyboard.press("Control+a");
  await page.keyboard.type(`
getBalance("ETH").then(b => {
  log("eth-balance:" + b.toString());
});
`);

  await page.click("#ide-run");

  await page.waitForFunction(
    () => {
      const lines = document.querySelectorAll("#script-log .log-line");
      return [...lines].some((l) => l.textContent.includes("eth-balance:"));
    },
    null,
    { timeout: 15_000 },
  );

  const line = await page.locator("#script-log .log-line",
    { hasText: "eth-balance:" }).first().textContent();
  // Balance should be a large bigint (18-decimal ETH)
  const balStr = line.split("eth-balance:")[1]?.trim();
  expect(Number(balStr)).toBeGreaterThan(0);
});

test("running an onBlock trigger registers it in the trigger list", async ({ page }) => {
  await openApp(page);
  await startChallenge(page, "wave-rider");

  await page.click(".cm-content");
  await page.keyboard.press("Control+a");
  await page.keyboard.type(`onBlock(({ blockNumber }) => { /* noop */ });`);

  await page.click("#ide-run");

  // Trigger list should show the registered trigger
  await expect(page.locator("#trigger-list .trigger-item")).toHaveCount(
    1,
    { timeout: 10_000 },
  );
  // TriggerPanel renders a .trigger-type-badge (not .trigger-type) for the type label
  await expect(page.locator(".trigger-type-badge")).toHaveText("onBlock");
});

test("script_stop clears triggers from the panel", async ({ page }) => {
  await openApp(page);
  await startChallenge(page, "wave-rider");

  // Register a trigger
  await page.click(".cm-content");
  await page.keyboard.press("Control+a");
  await page.keyboard.type(`onBlock(() => {});`);
  await page.click("#ide-run");
  await expect(page.locator("#trigger-list .trigger-item")).toHaveCount(1, { timeout: 10_000 });

  // Stop the script
  await page.click("#ide-stop");
  await expect(page.locator("#trigger-list .trigger-item")).toHaveCount(0, { timeout: 5_000 });
});

// ── Run Script sends the correct WS message ───────────────────────────────────

test("Run Script sends script_run message with current editor source", async ({ page }) => {
  let capturedSource = null;
  page.on("websocket", (ws) => {
    ws.on("framesent", (frame) => {
      try {
        const msg = JSON.parse(frame.payload);
        if (msg.type === "script_run") capturedSource = msg.payload.source;
      } catch {}
    });
  });

  await openApp(page);

  const marker = `// ws-capture-${Date.now()}`;
  await page.click(".cm-content");
  await page.keyboard.press("Control+a");
  await page.keyboard.type(marker);

  await page.click("#ide-run");

  await page.waitForFunction(
    (m) => typeof window.__capturedSource === "string" || true,
    null,
    { timeout: 3_000 },
  ).catch(() => {});

  expect(capturedSource).toContain(marker);
});
