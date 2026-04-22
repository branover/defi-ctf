import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./ui",
  globalSetup: "./global-setup.js",

  // Each test file manages its own challenge lifecycle; run files sequentially
  // because the engine only supports one active challenge at a time.
  workers: 1,
  fullyParallel: false,

  timeout:        120_000,   // per-test (challenge start can take ~15s)
  expect: { timeout: 30_000 },

  // Retry once on CI to absorb transient timing issues
  retries: process.env.CI ? 1 : 0,

  use: {
    baseURL:  process.env.FRONTEND_URL ?? "http://localhost:5173",
    headless: true,
    viewport: { width: 1400, height: 900 },

    // Capture artefacts only on failure
    screenshot: "only-on-failure",
    video:      "retain-on-failure",
    trace:      "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "../.test-results/html" }],
  ],
  outputDir: "../.test-results/playwright",
});
