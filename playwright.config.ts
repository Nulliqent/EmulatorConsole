import { defineConfig } from "@playwright/test";

// UI tests run against the shared e2e stack (scripts/e2e.sh up): Console on 19298, Emulator on 19297.
// One worker: the outage spec stops and starts the stack's Emulator.
export default defineConfig({
  testDir: "e2e/ui",
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results",
  use: {
    baseURL: process.env.CONSOLE_URL ?? "http://127.0.0.1:19298",
    browserName: "chromium",
    trace: "off",
    screenshot: "off",
  },
});
