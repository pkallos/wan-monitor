import { expect, test } from "@playwright/test";

/**
 * PHI-96: when a data query returns the backend's `503 DB_UNAVAILABLE` response,
 * the dashboard shows a warning banner and recovers once queries succeed again.
 *
 * The outage is simulated at the network boundary with `page.route` (no
 * production test hooks): the metrics query drives the banner, so we stub only
 * that endpoint, then unroute to recover. The server's real 503 behaviour is
 * covered by unit tests (server `mapQueryError`, web `errors`).
 */

const BANNER_TEXT = "Database temporarily unavailable. Retrying automatically.";
const METRICS_ROUTE = "**/api/metrics*";

const DB_UNAVAILABLE_BODY = JSON.stringify({
  error: "DB_UNAVAILABLE",
  message: "Database temporarily unavailable",
  timestamp: new Date().toISOString(),
});

test("shows the DB-unavailable banner and recovers", async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "WAN Monitor" })).toBeVisible({
    timeout: 10_000,
  });

  // Baseline: seeded data renders and no banner is shown.
  await expect(page.locator("svg.recharts-surface").first()).toBeVisible({
    timeout: 10_000,
  });
  const banner = page.getByText(BANNER_TEXT);
  await expect(banner).toBeHidden();

  // Simulate the outage, then switch the time range to force a fresh metrics
  // request (range buttons stay enabled during refetch, unlike "Refresh now").
  await page.route(METRICS_ROUTE, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: DB_UNAVAILABLE_BODY,
    })
  );
  await page.getByRole("button", { name: "24 Hours" }).click();

  await expect(banner).toBeVisible({ timeout: 15_000 });

  // Restore connectivity and trigger another fresh query; the banner clears and
  // the charts repopulate.
  await page.unroute(METRICS_ROUTE);
  await page.getByRole("button", { name: "7 Days" }).click();

  await expect(banner).toBeHidden({ timeout: 30_000 });
  await expect(page.locator("svg.recharts-surface").first()).toBeVisible({
    timeout: 10_000,
  });
});
