import { expect, type Page, test } from "@playwright/test";

/**
 * PHI-96: when a data query returns the backend's `503 DB_UNAVAILABLE` response,
 * the dashboard shows a warning distinguishing that specific failure and
 * recovers once queries succeed again.
 *
 * The outage is simulated at the network boundary with `page.route` (no
 * production test hooks): the metrics query drives the banner, so we stub only
 * that endpoint, then unroute to recover. The server's real 503 behaviour is
 * covered by unit tests (server `mapQueryError`, web `command.test.ts`).
 */

const BANNER_TEXT = /Database temporarily unavailable/;
const METRICS_ROUTE = "**/api/metrics*";
const latencyChartCanvas = (page: Page) =>
  page.locator('[aria-label="Latency chart"] canvas');

const applyPreset = async (page: Page, preset: string) => {
  await page.locator("#date-range-picker-button").click();
  await page.getByRole("button", { name: preset }).click();
  await page.getByRole("button", { name: "Apply" }).click();
};

const DB_UNAVAILABLE_BODY = JSON.stringify({
  error: "DB_UNAVAILABLE",
  message: "Database temporarily unavailable",
  timestamp: new Date().toISOString(),
});

test("shows the DB-unavailable message and recovers", async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "WAN Monitor" })).toBeVisible({
    timeout: 10_000,
  });

  // Baseline: seeded data renders and no DB-unavailable message is shown.
  await expect(latencyChartCanvas(page)).toBeVisible({ timeout: 10_000 });
  const banner = page.getByText(BANNER_TEXT);
  await expect(banner).toBeHidden();

  // Simulate the outage, then apply a different date range to force a fresh
  // metrics request (the picker stays enabled during refetch, unlike
  // "Refresh now").
  await page.route(METRICS_ROUTE, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: DB_UNAVAILABLE_BODY,
    })
  );
  await applyPreset(page, "Last 7 days");

  await expect(banner).toBeVisible({ timeout: 15_000 });

  // Restore connectivity and trigger another fresh query; the message clears
  // and the charts repopulate.
  await page.unroute(METRICS_ROUTE);
  await applyPreset(page, "Last 30 days");

  await expect(banner).toBeHidden({ timeout: 30_000 });
  await expect(latencyChartCanvas(page)).toBeVisible({ timeout: 10_000 });
});
