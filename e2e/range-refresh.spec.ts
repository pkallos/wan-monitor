import { expect, test } from "@playwright/test";

/**
 * PHI-94: Date range + auto-refresh controls update dashboard data.
 *
 * These tests intercept the metrics network requests and assert on their query
 * params plus the resulting UI, rather than sniffing rendered pixels, so they
 * stay deterministic. Auto-refresh is driven by react-query's 30s
 * `refetchInterval`; we use Playwright's clock API to advance time
 * instantly instead of waiting on the wall clock.
 */

const METRICS_PATH = "/api/metrics";

interface MetricsParams {
  readonly startTime: string | null;
  readonly endTime: string | null;
  readonly granularity: string | null;
}

const parseMetricsRequest = (url: string): MetricsParams => {
  const params = new URL(url).searchParams;
  return {
    startTime: params.get("startTime"),
    endTime: params.get("endTime"),
    granularity: params.get("granularity"),
  };
};

const windowMs = (params: MetricsParams): number => {
  if (!(params.startTime && params.endTime)) {
    throw new Error("metrics request missing startTime/endTime");
  }
  return (
    new Date(params.endTime).getTime() - new Date(params.startTime).getTime()
  );
};

test.describe("PHI-94: date range + auto-refresh controls", () => {
  test("changing the date range updates query params and re-renders charts", async ({
    page,
  }) => {
    const metricsRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes(METRICS_PATH)) {
        metricsRequests.push(request.url());
      }
    });

    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /wan monitor/i })
    ).toBeVisible({ timeout: 10_000 });

    // Fresh browser context => persisted range defaults to "1h". Wait for the
    // initial metrics request driven by that default range.
    await expect
      .poll(() => metricsRequests.length, { timeout: 10_000 })
      .toBeGreaterThan(0);

    const initialParams = parseMetricsRequest(metricsRequests[0]);
    // 1h range => 1-minute buckets and a ~1 hour window.
    expect(initialParams.granularity).toBe("1m");
    expect(windowMs(initialParams)).toBeLessThan(2 * 60 * 60 * 1000);

    // Switch to the 24 hour range.
    await page.getByRole("button", { name: "24 Hours" }).click();

    // A new request must fire with the widened window + coarser granularity.
    await expect
      .poll(
        () =>
          metricsRequests
            .map(parseMetricsRequest)
            .some((p) => p.granularity === "5m"),
        { timeout: 10_000 }
      )
      .toBe(true);

    const widened = metricsRequests
      .map(parseMetricsRequest)
      .find((p) => p.granularity === "5m");
    expect(widened).toBeDefined();
    if (!widened) return;

    // 24h range => 5-minute buckets and a window larger than a few hours.
    expect(widened.granularity).toBe("5m");
    expect(windowMs(widened)).toBeGreaterThan(12 * 60 * 60 * 1000);

    // Charts re-render with the new data (Recharts renders SVG surfaces).
    await expect(page.locator("svg.recharts-surface").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("manual refresh fires a new metrics request", async ({ page }) => {
    const metricsRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes(METRICS_PATH)) {
        metricsRequests.push(request.url());
      }
    });

    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /wan monitor/i })
    ).toBeVisible({ timeout: 10_000 });

    await expect
      .poll(() => metricsRequests.length, { timeout: 10_000 })
      .toBeGreaterThan(0);

    // Let the initial fetch fully resolve first; otherwise react-query dedupes
    // the manual refetch into the still-in-flight request and no new call fires.
    await page.waitForLoadState("networkidle");
    const countBeforeRefresh = metricsRequests.length;

    // "Refresh now" triggers an immediate metrics refetch.
    await page.getByRole("button", { name: "Refresh now" }).click();

    await expect
      .poll(() => metricsRequests.length, { timeout: 10_000 })
      .toBeGreaterThan(countBeforeRefresh);
  });

  test("pausing stops background auto-refresh and resuming restarts it", async ({
    page,
  }) => {
    // Fake timers let us advance react-query's 30s refetchInterval instantly
    // and deterministically, instead of waiting on the real clock.
    await page.clock.install();

    const metricsRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes(METRICS_PATH)) {
        metricsRequests.push(request.url());
      }
    });

    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /wan monitor/i })
    ).toBeVisible({ timeout: 10_000 });

    await expect
      .poll(() => metricsRequests.length, { timeout: 10_000 })
      .toBeGreaterThan(0);

    // Advance past the 30s auto-refresh interval: a background refetch fires.
    const countBeforeAuto = metricsRequests.length;
    await page.clock.fastForward(31_000);
    await expect
      .poll(() => metricsRequests.length, { timeout: 10_000 })
      .toBeGreaterThan(countBeforeAuto);

    // Pause auto-refresh; the interval timer must be cleared.
    await page.getByRole("button", { name: "Pause auto-refresh" }).click();
    await expect(
      page.getByRole("button", { name: "Resume auto-refresh" })
    ).toBeVisible();

    // Let any in-flight refetch settle, then snapshot the count.
    await page.waitForTimeout(500);
    const countWhilePaused = metricsRequests.length;

    // Even jumping well past two intervals fires no background request.
    await page.clock.fastForward(65_000);
    await page.waitForTimeout(500);
    expect(metricsRequests.length).toBe(countWhilePaused);

    // Resume: the interval restarts and a refetch fires on the next tick.
    await page.getByRole("button", { name: "Resume auto-refresh" }).click();
    await expect(
      page.getByRole("button", { name: "Pause auto-refresh" })
    ).toBeVisible();

    await page.clock.fastForward(31_000);
    await expect
      .poll(() => metricsRequests.length, { timeout: 10_000 })
      .toBeGreaterThan(countWhilePaused);
  });
});
