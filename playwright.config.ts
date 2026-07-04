import { defineConfig, devices } from "@playwright/test";

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'node:path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html", { outputFolder: "playwright-report" }], ["list"]],
  // Boot + seed the isolated test QuestDB (locally via docker compose, in CI via
  // the workflow's service container) before any test, and tear it down after.
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: [
    {
      // Backend API server, pointed at the isolated test QuestDB (REST/ILP on
      // 9100, PgWire on 8912) with auth disabled for tests.
      command: "pnpm --filter @wan-monitor/server dev",
      // Gate on readiness, not liveness: /ready fails until the QuestDB
      // connection is established, so tests never start against a server that
      // would return empty data on the first dashboard load.
      url: "http://localhost:3001/api/health/ready",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        DB_HOST: "localhost",
        DB_PORT: "9100",
        DB_PG_PORT: "8912",
        DB_PROTOCOL: "http",
        WAN_MONITOR_PASSWORD: "",
      },
    },
    {
      // Frontend dev server
      command: "pnpm --filter @wan-monitor/web dev",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
