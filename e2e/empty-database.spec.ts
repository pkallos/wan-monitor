import { expect, test } from "@playwright/test";
import { stubEmptyApi } from "./fixtures/emptyApi";

/**
 * First-run behaviour: the dashboard when every data endpoint returns zero rows.
 *
 * Every other spec runs on the globalSetup seed, so the empty state (the one a
 * fresh install actually sees) is otherwise never exercised. Every data
 * endpoint is stubbed at the network boundary (see `fixtures/emptyApi.ts`), so
 * this spec drives the same frontend code path a real empty database would
 * without reading or writing shared database state.
 */

test.describe("Empty database first run", () => {
  test.beforeEach(async ({ page }) => {
    await stubEmptyApi(page);
  });

  test("renders placeholder states instead of crashing or spinning", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "WAN Monitor" })
    ).toBeVisible({ timeout: 10_000 });

    // The figures fall back to placeholders with nothing behind them.
    const speedStat = page.getByTestId("rail-download");
    await expect(speedStat).toContainText("No tests in this range.", {
      timeout: 15_000,
    });
    await expect(speedStat).not.toContainText(/\d/);
    await expect(page.getByTestId("uptime-figure")).toHaveText("- uptime");
    await expect(page.getByTestId("availability-figure")).not.toContainText(
      /\d+\.\d/
    );

    // A monitor that has never reported reads as "No data", not as an outage.
    await expect(page.getByTestId("connection-status")).toHaveText("No data", {
      timeout: 15_000,
    });
    await expect(page.getByText("Offline")).toHaveCount(0);

    // Same placeholder for the four speed test stats.
    for (const label of [
      "Avg download",
      "Avg upload",
      "Max download",
      "Max upload",
    ]) {
      const statValue = page
        .getByText(label, { exact: true })
        .locator("xpath=following-sibling::p[1]");
      await expect(statValue).toHaveText("- Mbps");
    }

    // With no speedtest rows there is no resolved ISP either.
    await expect(page.getByText("ISP unknown")).toBeVisible();

    // Every fetch settled: the loading skeletons are gone rather than stuck,
    // and an empty database is not an error.
    await expect(page.getByRole("status", { name: /^Loading/ })).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);

    // The summary-backed cards say there is nothing to show rather than
    // staying blank.
    await expect(page.getByText("No incidents in this range.")).toBeVisible();
    await expect(page.getByText("No host data in this range.")).toBeVisible();

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

  test("the availability ribbon gap-fills the window as No data", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "WAN Monitor" })
    ).toBeVisible({ timeout: 10_000 });

    const ribbon = page.getByTestId("availability-ribbon");
    await expect(ribbon).toBeVisible({ timeout: 15_000 });

    // An empty database means nothing was ever measured. Reporting that as
    // 0% would claim a total outage over a window nobody was watching.
    await expect(page.getByTestId("uptime-figure")).toHaveText("- uptime");
    await expect(ribbon).toHaveAttribute("aria-label", /No data: \d+ /);
    await expect(ribbon).not.toHaveAttribute("aria-label", /Down:/);

    // Every cell is a gap, and none claims the link was up.
    const cells = page.locator('[data-testid^="connectivity-segment-"]');
    expect(await cells.count()).toBeGreaterThan(1);
    await expect(
      page.locator(
        '[data-testid^="connectivity-segment-"]:not(.pattern-nodata)'
      )
    ).toHaveCount(0);

    const box = await ribbon.boundingBox();
    await ribbon.hover({
      position: { x: (box?.width ?? 0) / 2, y: (box?.height ?? 0) / 2 },
    });
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    // The monitor never ran during this window, which the label distinguishes
    // from the link having been down.
    await expect(tooltip).toHaveText(/No data$/);
  });
});
