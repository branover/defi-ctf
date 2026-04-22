/**
 * UI tests — page layout and initial state.
 *
 * These tests do NOT start a challenge. They only verify that the page loads
 * correctly and that the static structure is in place.
 */

import { test, expect } from "@playwright/test";
import { ensureChallengeIdle, waitForConnected, waitForEngine } from "./helpers.js";

test.beforeAll(async () => {
  await waitForEngine();
});

test.beforeEach(async ({ page }) => {
  await ensureChallengeIdle();
  await page.goto("/#game");
});

// ── Structural presence ────────────────────────────────────────────────────────

test("page title is defi-ctf", async ({ page }) => {
  await expect(page).toHaveTitle(/defi-ctf/i);
});

test("topbar renders home button and split buttons", async ({ page }) => {
  await expect(page.locator("#home-btn.home-btn")).toBeVisible();
  await expect(page.locator(".split-btn[data-split='1']")).toBeVisible();
  await expect(page.locator(".split-btn[data-split='2']")).toBeVisible();
  await expect(page.locator(".split-btn[data-split='4']")).toBeVisible();
});

test("left sidebar contains control, progress, depth, and manual-trade panels", async ({ page }) => {
  await expect(page.locator(".left-sidebar #control-panel")).toBeVisible();
  await expect(page.locator(".left-sidebar #progress-panel")).toBeVisible();
  await expect(page.locator(".left-sidebar #depth-panel")).toBeVisible();
  // ManualTradePanel added in PR #40
  await expect(page.locator(".left-sidebar #manual-trade-panel")).toBeAttached();
});

test("right sidebar contains trigger and script panels", async ({ page }) => {
  await expect(page.locator(".right-sidebar #trigger-panel")).toBeVisible();
  await expect(page.locator(".right-sidebar #script-panel")).toBeVisible();
});

test("chart grid area is present", async ({ page }) => {
  await expect(page.locator(".chart-area #chart-grid")).toBeVisible();
});

test("resize handle between chart and right sidebar is present", async ({ page }) => {
  await expect(page.locator("#sidebar-resize")).toBeVisible();
});

// ── Control panel initial state ───────────────────────────────────────────────

test("control panel shows selected challenge details", async ({ page }) => {
  // Wait for WS so challenges message arrives
  await waitForConnected(page);
  await expect(page.locator("#selected-challenge-name")).not.toHaveText("No challenge selected");
  await expect(page.locator("#selected-challenge-meta")).toContainText("blocks");
  await expect(page.locator("#btn-back-challenges")).toBeVisible();
});

test("Start button is enabled and Stop/Pause/Resume are disabled on load", async ({ page }) => {
  await waitForConnected(page);
  await expect(page.locator("#btn-start")).toBeEnabled();
  await expect(page.locator("#btn-stop")).toBeDisabled();
  await expect(page.locator("#btn-pause")).toBeDisabled();
  await expect(page.locator("#btn-resume")).toBeDisabled();
});

test("speed slider is disabled before challenge starts", async ({ page }) => {
  await waitForConnected(page);
  await expect(page.locator("#speed-slider")).toBeDisabled();
});

test("status badge shows 'idle' on load", async ({ page }) => {
  await waitForConnected(page);
  await expect(page.locator("#status-el")).toHaveText("idle");
});

// ── WebSocket connectivity ────────────────────────────────────────────────────

test("connection badge reaches 'connected' state", async ({ page }) => {
  await waitForConnected(page);
  await expect(page.locator("#conn-status")).toHaveText("connected");
  await expect(page.locator("#conn-status")).toHaveClass(/conn-ok/);
});

// ── Script / IDE panel ────────────────────────────────────────────────────────

test("CodeMirror editor is present and contains default script text", async ({ page }) => {
  // IdePanel (which replaced the old ScriptPanel) uses .ide-editor-wrap
  await expect(page.locator(".ide-editor-wrap .cm-editor")).toBeVisible();
  // Default script includes this string
  const content = await page.locator(".cm-content").textContent();
  expect(content).toContain("onPriceBelow");
});

test("Run and Stop buttons are present in JS mode", async ({ page }) => {
  // IdePanel uses #ide-run / #ide-stop; old #btn-run-script/#btn-stop-script were in ScriptPanel
  await expect(page.locator("#ide-run")).toBeVisible();
  await expect(page.locator("#ide-stop")).toBeVisible();
});

// ── Progress panel ────────────────────────────────────────────────────────────

test("progress panel shows placeholder text before challenge starts", async ({ page }) => {
  await waitForConnected(page);
  await expect(page.locator("#progress-label")).toHaveText("Start a challenge");
});

// ── Pool depth panel ──────────────────────────────────────────────────────────

test("pool depth panel shows empty-state message before challenge starts", async ({ page }) => {
  await waitForConnected(page);
  await expect(page.locator("#depth-pools .empty-state")).toBeVisible();
});
