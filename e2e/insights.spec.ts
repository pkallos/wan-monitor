import { expect, test } from "@playwright/test";
import {
  pingStampMs,
  SEEDED_OUTAGE_FIRST_CYCLE,
  seededNowMs,
} from "./fixtures/seed";

/**
 * The summary-backed parts of the dashboard: the incidents card, the hosts
 * table and the stat rail. The seed puts an outage of one hour and a degraded
 * period of 30 minutes inside the last 24 hours, across two hosts (see
 * `e2e/fixtures/seed.ts`); the live monitor may add rows of its own, so
 * assertions ask for at least the seeded facts rather than exact counts.
 */

test.describe("Dashboard insights", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "WAN Monitor" })
    ).toBeVisible({ timeout: 10_000 });
  });

  test("the incidents card lists the seeded outage and degraded period with refs", async ({
    page,
  }) => {
    const log = page.getByTestId("incident-log");
    await expect(page.getByRole("heading", { name: "Incidents" })).toBeVisible({
      timeout: 15_000,
    });

    const rows = log.getByRole("row");
    // The header row plus at least the two seeded incidents.
    await expect
      .poll(() => rows.count(), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(3);

    await expect(log.getByRole("row", { name: /Down/ }).first()).toBeVisible();
    await expect(
      log.getByRole("row", { name: /Degraded/ }).first()
    ).toBeVisible();
    await expect(log.getByRole("row", { name: /^A / })).toBeVisible();
    for (const column of [
      "Ref",
      "Start",
      "End",
      "Duration",
      "Status",
      "Hosts",
      "Max loss",
      "Peak latency",
    ]) {
      await expect(
        log.getByRole("columnheader", { name: column })
      ).toBeVisible();
    }
    await expect(log).toContainText(
      /\d+ incidents? in the last 30 days: .*outages? lasting/
    );
    await expect(log).not.toContainText("No incidents in this range.");
  });

  test("the seeded outage reads as one hour long, from the start of its first cycle", async ({
    page,
  }) => {
    const log = page.getByTestId("incident-log");
    // The incidents table's own Start format, in the browser's locale and zone.
    // Locales that put a narrow no-break space before AM or PM read as a plain
    // space in the cell's accessible name.
    const startText = await page.evaluate(
      (startMs) =>
        new Date(startMs)
          .toLocaleString([], {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })
          .replace(/\s+/g, " "),
      pingStampMs(seededNowMs(), SEEDED_OUTAGE_FIRST_CYCLE)
    );

    const outage = log.getByRole("row").filter({
      has: page.getByRole("cell", { name: startText, exact: true }),
    });
    await expect(outage).toHaveCount(1, { timeout: 15_000 });
    await expect(outage).toContainText("Down");
    await expect(outage.getByRole("cell").nth(2)).toHaveText("1h");
  });

  test("the ribbon letters its incidents, and clicking a chip pins the cell it began in", async ({
    page,
  }) => {
    // Over 30 days the two seeded incidents sit a few cells apart, so they may
    // share one cluster chip; either kind pins the first incident's cell.
    const chip = page
      .locator(
        '[data-testid^="incident-chip-"]:not([data-testid^="incident-chip-touch-"])'
      )
      .first();
    await expect(chip).toBeVisible({ timeout: 15_000 });
    await expect(chip).toHaveAttribute("aria-pressed", "false");
    await expect(chip).toContainText(/^A/);

    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("tooltip")).toBeVisible();
  });

  test("the hosts table lists the seeded hosts with status and figures", async ({
    page,
  }) => {
    const hosts = page.getByRole("heading", { name: "Hosts", exact: true });
    await expect(hosts).toBeVisible();

    for (const host of ["8.8.8.8", "1.1.1.1"]) {
      const row = page.getByTestId(`host-row-${host}`);
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expect(row).toContainText(/\d+\.\d ms/);
      await expect(row).toContainText(/\d+\.\d+%/);
    }
    await expect(
      page.getByRole("columnheader", { name: "Pings answered" })
    ).toBeVisible();
  });

  test("the latency stat reports the median with its 95th percentile", async ({
    page,
  }) => {
    const stat = page.getByTestId("rail-latency");

    await expect(stat).toContainText(/95th percentile \d+\.\d ms/, {
      timeout: 15_000,
    });
  });

  test("the footer says only when the dashboard last updated", async ({
    page,
  }) => {
    const footer = page.getByRole("contentinfo");

    await expect(footer).toHaveText(/^Updated \d+ (seconds?|minutes?) ago\.$/, {
      timeout: 15_000,
    });
  });
});
