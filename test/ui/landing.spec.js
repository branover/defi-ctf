/**
 * UI tests — landing page (challenge picker) vs in-game shell.
 */

import { test, expect } from "@playwright/test";
import { waitForConnected, waitForEngine } from "./helpers.js";

test.beforeAll(async () => {
  await waitForEngine();
});

test("landing shows hero and hides game shell initially", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".hero-title")).toHaveText("DeFi CTF");
  await expect(page.locator("#game-view")).toBeHidden();
  await expect(page.locator("#landing-view")).toBeVisible();
});

test("clicking Play on a challenge reveals game view", async ({ page }) => {
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/challenges") && r.ok()),
    page.goto("/"),
  ]);
  await expect(page.locator(".btn-card-play").first()).toBeVisible({ timeout: 15_000 });
  await page.locator(".btn-card-play").first().click();
  await expect(page.locator("#game-view")).toBeVisible();
  await expect(page.locator("#landing-view")).toBeHidden();
  await waitForConnected(page, 30_000);
  await expect(page.locator("#conn-status")).toHaveText("connected");
});

test("home button returns to landing from game", async ({ page }) => {
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/challenges") && r.ok()),
    page.goto("/"),
  ]);
  await expect(page.locator(".btn-card-play").first()).toBeVisible({ timeout: 15_000 });
  await page.locator(".btn-card-play").first().click();
  await waitForConnected(page, 30_000);
  await page.locator("#home-btn").click();
  await expect(page.locator("#landing-view")).toBeVisible();
  await expect(page.locator("#game-view")).toBeHidden();
});
