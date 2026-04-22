/**
 * Shared Playwright test helpers for defi-ctf UI tests.
 *
 * All helpers are pure async functions that take a Playwright `page` object.
 * Import them in each spec file as needed.
 */

const ENGINE_URL = process.env.ENGINE_URL ?? "http://localhost:3000";

/** Best-effort: reset the engine to idle so the UI matches test expectations. */
export async function ensureChallengeIdle() {
  try {
    const r = await fetch(`${ENGINE_URL}/api/challenge/state`);
    const s = await r.json();
    if (s.status && s.status !== "idle") {
      await fetch(`${ENGINE_URL}/api/challenge/stop`, { method: "POST" });
    }
  } catch {
    // Engine may be down — caller's health checks will surface that.
  }
}

/**
 * Wait until the WebSocket connection badge shows "connected".
 * Uses `attached` because the badge lives inside `#game-view`, which is `display:none`
 * on the landing page — the socket still connects; only visibility is hidden.
 */
export async function waitForConnected(page, timeout = 15_000) {
  await page.locator(".conn-badge.conn-ok").waitFor({ state: "attached", timeout });
}

/**
 * Wait until the CHAIN → Status badge shows the given status string.
 * Uses page.waitForFunction for polling (status changes are WS-driven).
 */
export async function waitForStatus(page, status, timeout = 60_000) {
  await page.waitForFunction(
    (s) => document.querySelector("#status-el")?.textContent?.trim() === s,
    status,
    { timeout },
  );
}

/** Enter game view with a specific challenge selected (but not started). */
export async function selectChallenge(page, challengeId = "wave-rider") {
  await ensureChallengeIdle();
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/challenges") && r.ok()),
    page.goto("/"),
  ]);
  await page.locator(`.btn-card-play[data-id="${challengeId}"]`).waitFor({ state: "visible", timeout: 15_000 });
  await page.locator(`.btn-card-play[data-id="${challengeId}"]`).click();
  await waitForConnected(page, 30_000);
}

/** Start the currently selected challenge and wait for running state. */
export async function startChallenge(page, challengeId = "wave-rider") {
  if (challengeId) {
    await selectChallenge(page, challengeId);
  } else {
    await openApp(page);
  }
  await page.click("#btn-start");
  await waitForStatus(page, "running", 45_000);
}

/**
 * Stop the currently running challenge and wait for "idle".
 * Safe to call even if already idle (Stop button is disabled when idle,
 * so we only click if it is enabled).
 */
export async function stopChallenge(page) {
  const disabled = await page.$eval(
    "#btn-stop",
    (el) => el.disabled,
  ).catch(() => true);
  if (!disabled) {
    await page.click("#btn-stop");
  }
  await waitForStatus(page, "idle", 15_000);
}

/**
 * Block until the engine HTTP health endpoint returns 200.
 * Useful as a pre-test guard in globalSetup or beforeAll.
 */
export async function waitForEngine(timeout = 30_000) {
  const url = `${process.env.ENGINE_URL ?? "http://localhost:3000"}/health`;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      // connection refused — not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Engine not reachable at ${url} after ${timeout}ms`);
}

/**
 * Navigate to the frontend game shell (no challenge auto-start), wait for WS connected.
 * Uses `/#game` so the layout is visible even though the default entry is the landing page.
 */
export async function openApp(page) {
  await ensureChallengeIdle();
  await page.goto("/#game");
  await waitForConnected(page);
  return page;
}
