import { expect, test } from "@playwright/test";

/**
 * PHI-94: Date range + auto-refresh controls update dashboard data.
 *
 * These tests intercept the metrics network requests and assert on their query
 * params plus the resulting UI, rather than sniffing rendered pixels, so they
 * stay deterministic. Auto-refresh runs on a 30s tick; we use Playwright's
 * clock API to advance time instantly instead of waiting on the wall clock.
 */

const METRICS_PATH = "/api/metrics";
const DAY_MS = 24 * 60 * 60 * 1000;

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
      page.getByRole("heading", { name: "WAN Monitor" })
    ).toBeVisible({ timeout: 10_000 });

    // Fresh browser context => the default range is "Last 30 days". Wait for
    // the initial metrics request driven by that default range.
    await expect
      .poll(() => metricsRequests.length, { timeout: 10_000 })
      .toBeGreaterThan(0);

    const initialParams = parseMetricsRequest(metricsRequests[0]);
    // A 30 day span falls in the "<= 30 days" bucket => 1-hour aggregation.
    expect(initialParams.granularity).toBe("1h");
    expect(windowMs(initialParams)).toBeGreaterThan(29 * DAY_MS);

    // Narrow to the "Last 7 days" preset through the picker.
    await page.locator("#date-range-picker-button").click();
    await page.getByRole("button", { name: "Last 7 days" }).click();
    await page.getByRole("button", { name: "Apply" }).click();

    // A new request must fire with the narrowed ~7-day window. The initial
    // 30-day request also resolves to "1h" granularity, so the narrowed
    // request has to be identified by its window size, not by granularity
    // alone. METRICS_PATH also matches /api/metrics/earliest, whose request
    // carries no startTime/endTime, so the check has to guard for those
    // before computing a window size.
    const isNarrowedWindow = (p: MetricsParams): boolean =>
      Boolean(p.startTime && p.endTime && windowMs(p) < 8 * DAY_MS);

    await expect
      .poll(
        () => metricsRequests.map(parseMetricsRequest).some(isNarrowedWindow),
        { timeout: 10_000 }
      )
      .toBe(true);

    const narrowed = metricsRequests
      .map(parseMetricsRequest)
      .find(isNarrowedWindow);
    expect(narrowed).toBeDefined();
    if (!narrowed) return;

    // A 7 day span falls in the "<= 30 days" bucket => 1-hour aggregation.
    expect(narrowed.granularity).toBe("1h");
    expect(windowMs(narrowed)).toBeGreaterThan(6 * DAY_MS);
    expect(windowMs(narrowed)).toBeLessThan(8 * DAY_MS);

    // Charts re-render with the new data.
    await expect(
      page.locator('[aria-label="Latency chart"] canvas')
    ).toBeVisible({ timeout: 10_000 });
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
      page.getByRole("heading", { name: "WAN Monitor" })
    ).toBeVisible({ timeout: 10_000 });

    await expect
      .poll(() => metricsRequests.length, { timeout: 10_000 })
      .toBeGreaterThan(0);

    // Let the initial fetch fully resolve first; otherwise the manual refetch
    // races the still-in-flight request.
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
    // Fake timers let us advance the 30s auto-refresh tick instantly and
    // deterministically, instead of waiting on the real clock.
    await page.clock.install();

    const metricsRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes(METRICS_PATH)) {
        metricsRequests.push(request.url());
      }
    });

    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "WAN Monitor" })
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
    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();

    // Let any in-flight refetch settle, then snapshot the count.
    await page.waitForTimeout(500);
    const countWhilePaused = metricsRequests.length;

    // Even jumping well past two intervals fires no background request.
    await page.clock.fastForward(65_000);
    await page.waitForTimeout(500);
    expect(metricsRequests.length).toBe(countWhilePaused);

    // Resume: the interval restarts and a refetch fires on the next tick.
    await page.getByRole("button", { name: "Resume" }).click();
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();

    await page.clock.fastForward(31_000);
    await expect
      .poll(() => metricsRequests.length, { timeout: 10_000 })
      .toBeGreaterThan(countWhilePaused);
  });
});
