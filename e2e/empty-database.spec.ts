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
 * `uptimePercentage` and `availabilityPercentage` both 0), so this drives the
 * same frontend code path a real empty database would. Stubbing also holds the
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
    await page.route("**/api/connectivity-status*", (route) =>
      route.fulfill(
        fulfillJson({
          data: [],
          meta: {
            ...emptyMeta,
            uptimePercentage: 0,
            availabilityPercentage: 0,
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

    // Uptime renders (rather than staying on the loading placeholder) even
    // with an empty denominator.
    await expect(page.getByText("Uptime: 0.0%")).toBeVisible();

    // Every slot gap-fills to the same `noInfo` status, so the whole window
    // merges down to exactly one bar.
    await expect(
      page.locator('[data-testid^="connectivity-segment-"]')
    ).toHaveCount(1);

    await page.getByTestId("connectivity-segment-0").hover();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveText(/No Data$/);
  });
});
