import { expect, test } from "@playwright/test";

/**
 * First-run behaviour: the dashboard when every data endpoint returns zero rows.
 *
 * Every other spec runs on the globalSetup seed, so the empty state (the one a
 * fresh install actually sees) is otherwise never exercised. Every data
 * endpoint is stubbed at the network boundary with `page.route`, the same
 * approach `db-unavailable.spec.ts` uses, so this spec reads and writes no
 * shared database state and stays correct at any worker count.
 *
 * The stubbed bodies match what the server returns for an empty table (see
 * `getConnectivityStatusHandler`: zero rows yields `data: []` with
 * `uptimePercentage` and `availabilityPercentage` null and zero coverage), so
 * this drives the same frontend code path a real empty database would. Keep
 * the stubbed meta in sync with `ConnectivityStatusMeta`; a missing field
 * fails decoding and the dashboard renders the error branch instead of the
 * empty state this spec is about. Stubbing also holds the
 * window empty for the whole test: the live monitor writes a ping row every 30s
 * (PING_INTERVAL_SECONDS), which against the real table would drift into the
 * tail of the window mid-assertion.
 */

const emptyMeta = {
  startTime: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  endTime: new Date().toISOString(),
  count: 0,
};

const fulfillJson = (body: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify(body),
});

test.describe("Empty database first run", () => {
  test.beforeEach(async ({ page }) => {
    // A glob's `*` never crosses a `/`, so this has to be routed separately
    // from `**/api/metrics*` below or it falls through to the real seed.
    await page.route("**/api/metrics/earliest*", (route) =>
      route.fulfill(fulfillJson({ timestamp: null }))
    );
    await page.route("**/api/metrics*", (route) =>
      route.fulfill(fulfillJson({ data: [], meta: emptyMeta }))
    );
    await page.route("**/api/speedtest/history*", (route) =>
      route.fulfill(fulfillJson({ data: [], meta: emptyMeta }))
    );
    // Same glob caveat as `/api/metrics/earliest` above: `*` never crosses a
    // `/`, so the live endpoint needs its own route or it falls through.
    await page.route("**/api/connectivity-status/live*", (route) =>
      route.fulfill(
        fulfillJson({ status: "noInfo", lastSampleAt: null, windowSeconds: 60 })
      )
    );
    await page.route("**/api/connectivity-status*", (route) =>
      route.fulfill(
        fulfillJson({
          data: [],
          meta: {
            ...emptyMeta,
            uptimePercentage: null,
            availabilityPercentage: null,
            expectedBuckets: 288,
            observedBuckets: 0,
            coveragePercentage: 0,
            observedCycles: 0,
            expectedSampleIntervalSeconds: 30,
          },
        })
      )
    );
  });

  test("renders placeholder states instead of crashing or spinning", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "WAN Monitor" })
    ).toBeVisible({ timeout: 10_000 });

    // The top speed cards fall back to "- Mbps" with no speedtest rows behind
    // them; each card renders its value as the heading's sibling paragraph.
    for (const title of ["Download Speed", "Upload Speed"]) {
      const cardValue = page
        .getByRole("heading", { name: title, exact: true })
        .locator("xpath=following-sibling::p[1]");
      await expect(cardValue).toHaveText("- Mbps", { timeout: 15_000 });
    }

    // A monitor that has never reported reads as "No Data", not as an outage.
    const connectivityValue = page
      .getByRole("heading", { name: "Connectivity", exact: true })
      .locator("xpath=following-sibling::p[1]");
    await expect(connectivityValue).toContainText("No Data", {
      timeout: 15_000,
    });
    await expect(connectivityValue).not.toContainText("Offline");

    // Same placeholder for the four Speed Test History stats.
    for (const label of [
      "Avg Download",
      "Avg Upload",
      "Max Download",
      "Max Upload",
    ]) {
      const statValue = page
        .getByText(label, { exact: true })
        .locator("xpath=following-sibling::p[1]");
      await expect(statValue).toHaveText("- Mbps");
    }

    // With no speedtest rows there is no resolved ISP either.
    await expect(page.getByText("Unknown ISP")).toBeVisible();

    // Every fetch settled: the loading placeholders are gone rather than stuck.
    await expect(page.getByText("Loading metrics…")).toHaveCount(0);
    await expect(page.getByText("Loading speed test history…")).toHaveCount(0);
    await expect(page.getByText("Loading connectivity status…")).toHaveCount(0);

    // The charts still mount and size themselves with an empty dataset.
    for (const label of [
      "Latency chart",
      "Packet loss chart",
      "Jitter chart",
      "Speed chart",
    ]) {
      const canvas = page.locator(`[aria-label="${label}"] canvas`);
      await expect(canvas).toBeVisible({ timeout: 15_000 });
      const box = await canvas.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThan(0);
      expect(box?.height ?? 0).toBeGreaterThan(0);
    }
  });

  test("connectivity timeline gap-fills the window as No Data", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "WAN Monitor" })
    ).toBeVisible({ timeout: 10_000 });

    await expect(
      page.getByRole("img", { name: "Connectivity status timeline" })
    ).toBeVisible({ timeout: 15_000 });

    // An empty database means nothing was ever measured. Reporting that as
    // 0.0% would claim a total outage over a window nobody was watching.
    await expect(
      page.getByText("Uptime: no data for this period")
    ).toBeVisible();
    await expect(page.getByText(/^Uptime: \d/)).toHaveCount(0);

    // Every slot gap-fills to the same `noInfo` status, so the whole window
    // merges down to exactly one bar.
    await expect(
      page.locator('[data-testid^="connectivity-segment-"]')
    ).toHaveCount(1);

    await page.getByTestId("connectivity-segment-0").hover();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    // The monitor never ran during this window, which the label distinguishes
    // from the link having been down.
    await expect(tooltip).toHaveText(/No Data \(monitor offline\)$/);
  });
});
