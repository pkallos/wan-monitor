import { expect, type Locator, type Page, test } from "@playwright/test";
import { stubEmptyApi } from "./fixtures/emptyApi";

/**
 * Where the stat rail sits relative to the status column and the ribbon card
 * in the top section. From `xl` the rail sits under the ribbon in the right
 * column; below it the rail spans the full width under both.
 */

const boxOf = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error("element has no bounding box");
  }
  return { ...box, right: box.x + box.width, bottom: box.y + box.height };
};

const openDashboard = async (page: Page, width: number) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("rail-latency")).toContainText(
    /p95 \d+\.\d ms/,
    {
      timeout: 15_000,
    }
  );
  await expect(page.getByTestId("availability-card")).toBeVisible();
};

const regions = (page: Page) => ({
  status: page.getByRole("region", { name: "Live status and range uptime" }),
  ribbon: page.getByTestId("availability-card"),
  rail: page.getByRole("region", { name: "Range summary" }),
});

test.describe("Top section layout", () => {
  test("at 1280px the stat rail sits under the ribbon in the right column", async ({
    page,
  }) => {
    await openDashboard(page, 1280);
    const { status, ribbon, rail } = regions(page);
    const [statusBox, ribbonBox, railBox] = await Promise.all([
      boxOf(status),
      boxOf(ribbon),
      boxOf(rail),
    ]);

    expect(railBox.x).toBeGreaterThanOrEqual(ribbonBox.x);
    expect(railBox.y).toBeGreaterThanOrEqual(ribbonBox.bottom);
    expect(Math.abs(railBox.right - ribbonBox.right)).toBeLessThanOrEqual(1);
    expect(statusBox.x).toBeLessThan(ribbonBox.x);
    expect(statusBox.x).toBeLessThan(railBox.x);
  });

  test("at 1280px the ribbon card is not stretched to the status column", async ({
    page,
  }) => {
    await openDashboard(page, 1280);
    const { status, ribbon, rail } = regions(page);
    const [statusBox, ribbonBox, railBox] = await Promise.all([
      boxOf(status),
      boxOf(ribbon),
      boxOf(rail),
    ]);

    expect(ribbonBox.bottom).toBeLessThan(statusBox.bottom - 100);
    expect(railBox.y - ribbonBox.bottom).toBeLessThan(40);
  });

  test("at 1280px no rail figure or note overflows its cell", async ({
    page,
  }) => {
    await openDashboard(page, 1280);
    const overflowing = await page
      .getByRole("region", { name: "Range summary" })
      .locator("[data-testid^='rail-'], [data-testid^='rail-'] *")
      .evaluateAll(
        (nodes) =>
          nodes.filter((node) => node.scrollWidth > node.clientWidth + 1).length
      );

    expect(overflowing).toBe(0);
  });

  test("at 1024px the stat rail spans the full width under the status column and the ribbon", async ({
    page,
  }) => {
    await openDashboard(page, 1024);
    const { status, ribbon, rail } = regions(page);
    const [statusBox, ribbonBox, railBox] = await Promise.all([
      boxOf(status),
      boxOf(ribbon),
      boxOf(rail),
    ]);

    expect(Math.abs(railBox.x - statusBox.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(railBox.right - ribbonBox.right)).toBeLessThanOrEqual(1);
    expect(railBox.y).toBeGreaterThanOrEqual(statusBox.bottom);
    expect(railBox.y).toBeGreaterThanOrEqual(ribbonBox.bottom);
  });
});

test.describe("Stat rail grid", () => {
  const cellsOf = (page: Page) =>
    page
      .getByRole("region", { name: "Range summary" })
      .locator("[data-testid^='rail-']");

  for (const width of [390, 768]) {
    test(`at ${width}px the latency cell spans both columns and no grid slot is left empty`, async ({
      page,
    }) => {
      await openDashboard(page, width);

      const layout = await cellsOf(page).evaluateAll((cells) => {
        const grid = cells[0]?.parentElement;
        if (!grid) {
          throw new Error("the stat rail has no cells");
        }
        const gridBox = grid.getBoundingClientRect();
        const rows = new Map<number, Array<DOMRect>>();
        for (const cell of cells) {
          const box = cell.getBoundingClientRect();
          const top = Math.round(box.top);
          rows.set(top, [...(rows.get(top) ?? []), box]);
        }
        return {
          latencyColumnEnd: getComputedStyle(cells[0]).gridColumnEnd,
          rowsShort: [...rows.values()].filter(
            (row) =>
              Math.abs(Math.min(...row.map((box) => box.left)) - gridBox.left) >
                1 ||
              Math.abs(
                Math.max(...row.map((box) => box.right)) - gridBox.right
              ) > 1
          ).length,
        };
      });

      expect(layout.latencyColumnEnd).toBe("span 2");
      expect(layout.rowsShort).toBe(0);
    });
  }

  for (const width of [1024, 1440]) {
    test(`at ${width}px the latency cell has no left border inside the rail's own`, async ({
      page,
    }) => {
      await openDashboard(page, width);

      const borderLeft = await cellsOf(page)
        .first()
        .evaluate((cell) => getComputedStyle(cell).borderLeftWidth);

      expect(borderLeft).toBe("0px");
    });
  }
});

const DAY_MS = 24 * 60 * 60 * 1000;

const pageOverflow = (page: Page) =>
  page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

test.describe("Page width with a ribbon of no-data cells", () => {
  const cases = [
    ["an empty database", null],
    [
      "a monitor that started 45 days ago and has no rows since",
      new Date(Date.now() - 45 * DAY_MS).toISOString(),
    ],
  ] as const;

  for (const [name, earliestTimestamp] of cases) {
    for (const width of [768, 1024, 1280, 1440, 1920]) {
      test(`over ${name} the 30 day ribbon never widens the page at ${width}px`, async ({
        page,
      }) => {
        await stubEmptyApi(page, { earliestTimestamp });
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/");

        const cells = page.locator('[data-testid^="connectivity-segment-"]');
        await expect(cells.first()).toBeVisible({ timeout: 15_000 });
        expect(await cells.count()).toBeGreaterThan(100);

        const { scrollWidth, clientWidth } = await pageOverflow(page);
        expect(scrollWidth).toBe(clientWidth);
      });
    }
  }
});

test.describe("Incidents card", () => {
  const HOSTS = ["1.1.1.1", "8.8.8.8", "cloudflare.com", "9.9.9.9"];

  const openWithIncident = async (page: Page, width: number) => {
    await stubEmptyApi(page);
    const endMs = Date.now() - 2 * 60 * 60 * 1000;
    const outage = {
      start: new Date(endMs - 20 * 60 * 1000).toISOString(),
      end: new Date(endMs).toISOString(),
      durationSeconds: 1200,
      status: "down",
      affectedHosts: ["1.1.1.1", "8.8.8.8", "cloudflare.com"],
      maxPacketLoss: 100,
      peakLatency: 482,
    };
    await page.route("**/api/connectivity-status/outages*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [outage],
          meta: {
            startTime: new Date(Date.now() - 30 * DAY_MS).toISOString(),
            endTime: new Date().toISOString(),
            count: 1,
            totalCount: 1,
          },
        }),
      })
    );
    await page.route("**/api/ping/hosts*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          hosts: HOSTS,
          pingIntervalSeconds: 30,
          speedtestIntervalSeconds: 3600,
        }),
      })
    );
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByTestId("incident-log")).toBeVisible({
      timeout: 15_000,
    });
  };

  for (const width of [768, 900, 1023]) {
    test(`at ${width}px it lists the incident as a stacked card with every field readable`, async ({
      page,
    }) => {
      await openWithIncident(page, width);

      await expect(page.getByTestId("incident-card-A")).toBeVisible();
      await expect(page.getByTestId("incident-card-A")).toContainText(
        "1.1.1.1, 8.8.8.8, cloudflare.com"
      );
      await expect(
        page.getByRole("table", { name: "Incidents in the selected range" })
      ).toBeHidden();
      const { scrollWidth, clientWidth } = await pageOverflow(page);
      expect(scrollWidth).toBe(clientWidth);
    });
  }

  for (const width of [1024, 1280]) {
    test(`at ${width}px its table shows every column without scrolling`, async ({
      page,
    }) => {
      await openWithIncident(page, width);

      const table = page.getByRole("table", {
        name: "Incidents in the selected range",
      });
      await expect(table).toBeVisible();
      await expect(
        page.getByRole("columnheader", { name: "Peak latency" })
      ).toBeVisible();
      const clipped = await table.evaluate((node) => {
        const wrapper = node.parentElement;
        return wrapper === null
          ? true
          : wrapper.scrollWidth > wrapper.clientWidth;
      });
      expect(clipped).toBe(false);
    });
  }
});

const LONG_HOSTS = [
  "resolver-primary.internal.example-corp.net",
  "resolver-secondary.internal.example-corp.net",
  "very-long-hostname-for-wan-check-three.example.org",
];

const fulfillJson = (body: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify(body),
});

const summaryBody = (hosts: ReadonlyArray<string>) => {
  const range = {
    latencyP50: 14.2,
    latencyP95: 31.8,
    avgPacketLoss: 0.5,
    avgJitter: 2.1,
    uptimePercentage: 99.4,
    availabilityPercentage: 99.8,
    coveragePercentage: 100,
  };
  return {
    range,
    previous: { ...range, latencyP50: 11.4, avgPacketLoss: 0.2 },
    windows: {
      last24h: { uptimePercentage: 99.9 },
      last7d: { uptimePercentage: 99.4 },
      last30d: { uptimePercentage: 99.6 },
    },
    hosts: hosts.map((host) => ({
      host,
      latencyP50: 14.2,
      latencyP95: 31.8,
      avgPacketLoss: 0.5,
      avgJitter: 2.1,
      availabilityPercentage: 99.8,
      lastStatus: "up",
    })),
    speed: { downloadMedian: 941, uploadMedian: 917, count: 24 },
    previousSpeed: { downloadMedian: 930, uploadMedian: 910, count: 24 },
    meta: {
      startTime: new Date(Date.now() - 30 * DAY_MS).toISOString(),
      endTime: new Date().toISOString(),
    },
  };
};

const openWithHosts = async (
  page: Page,
  width: number,
  hosts: ReadonlyArray<string>,
  affectedHosts: ReadonlyArray<string> = hosts
) => {
  await stubEmptyApi(page);
  const startTime = new Date(Date.now() - 30 * DAY_MS).toISOString();
  const endTime = new Date().toISOString();
  await page.route("**/api/summary*", (route) =>
    route.fulfill(fulfillJson(summaryBody(hosts)))
  );
  await page.route("**/api/connectivity-status/outages*", (route) =>
    route.fulfill(
      fulfillJson({
        data: [
          {
            start: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
            end: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
            durationSeconds: 3600,
            status: "down",
            affectedHosts,
            maxPacketLoss: 100,
            peakLatency: 482,
          },
        ],
        meta: { startTime, endTime, count: 1, totalCount: 1 },
      })
    )
  );
  await page.route("**/api/ping/hosts*", (route) =>
    route.fulfill(
      fulfillJson({
        hosts,
        pingIntervalSeconds: 30,
        speedtestIntervalSeconds: 3600,
      })
    )
  );
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("incident-log")).toBeVisible({
    timeout: 15_000,
  });
};

const cardOf = (page: Page, title: string) =>
  page.locator("section", {
    has: page.getByRole("heading", { name: title, level: 2 }),
  });

test.describe("Long host names", () => {
  for (const width of [1024, 1280]) {
    test(`at ${width}px the incidents table keeps every column inside its card`, async ({
      page,
    }) => {
      await openWithHosts(page, width, [...LONG_HOSTS, "8.8.8.8"], LONG_HOSTS);

      const card = cardOf(page, "Incidents");
      const lastHeader = page.getByRole("columnheader", {
        name: "Peak latency",
      });
      await expect(lastHeader).toBeVisible();
      const [cardBox, lastBox] = await Promise.all([
        boxOf(card),
        boxOf(lastHeader),
      ]);

      expect(lastBox.right).toBeLessThanOrEqual(cardBox.right);
      const hosts = page.getByTestId("incident-row-A").getByRole("cell").nth(4);
      await expect(hosts).toContainText(LONG_HOSTS[2] ?? "");
      expect(
        await hosts.evaluate((cell) => cell.scrollWidth <= cell.clientWidth)
      ).toBe(true);
    });
  }

  for (const width of [768, 1023, 1280]) {
    test(`at ${width}px the hosts table keeps every column inside its card`, async ({
      page,
    }) => {
      await openWithHosts(page, width, LONG_HOSTS);

      const lastHeader = page.getByRole("columnheader", {
        name: "Availability",
      });
      await expect(lastHeader).toBeVisible();
      const [cardBox, lastBox] = await Promise.all([
        boxOf(cardOf(page, "Hosts")),
        boxOf(lastHeader),
      ]);

      expect(lastBox.right).toBeLessThanOrEqual(cardBox.right);
    });
  }

  test("at 768px a host name with no break points scrolls inside the card instead of widening the page", async ({
    page,
  }) => {
    await openWithHosts(page, 768, ["x".repeat(70), "1.1.1.1"]);

    await expect(
      page.getByRole("table", { name: "Per-host statistics" })
    ).toBeVisible();
    const { scrollWidth, clientWidth } = await pageOverflow(page);
    expect(scrollWidth).toBe(clientWidth);
  });
});

test.describe("Hosts card", () => {
  for (const [width, showsTable] of [
    [767, false],
    [768, true],
    [1023, true],
  ] as const) {
    test(`at ${width}px it shows ${showsTable ? "the table" : "stacked cards"} and hides the other`, async ({
      page,
    }) => {
      await openWithHosts(page, width, ["8.8.8.8", "1.1.1.1"]);

      const table = page.getByRole("table", { name: "Per-host statistics" });
      const card = page.getByTestId("host-card-8.8.8.8");
      await (showsTable
        ? expect(table).toBeVisible()
        : expect(table).toBeHidden());
      await (showsTable
        ? expect(card).toBeHidden()
        : expect(card).toBeVisible());
    });
  }

  test("at 360px a wide row never widens the page", async ({ page }) => {
    await openWithHosts(page, 360, [LONG_HOSTS[2] ?? "", "x".repeat(60)]);

    await expect(page.getByTestId(`host-card-${LONG_HOSTS[2]}`)).toBeVisible();
    const { scrollWidth, clientWidth } = await pageOverflow(page);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
});

test.describe("Stat rail loading", () => {
  for (const width of [390, 768, 1024, 1440]) {
    test(`at ${width}px the rail keeps its height when the summary lands`, async ({
      page,
    }) => {
      await stubEmptyApi(page);
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route("**/api/summary*", async (route) => {
        await gate;
        await route.fulfill(fulfillJson(summaryBody(["8.8.8.8"])));
      });
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");

      const rail = page.getByRole("region", { name: "Range summary" });
      await expect(rail.getByRole("status")).toHaveCount(5);
      const loading = (await boxOf(rail)).height;
      release();
      await expect(page.getByTestId("rail-latency")).toBeVisible();
      const loaded = (await boxOf(rail)).height;

      expect(Math.abs(loaded - loading)).toBeLessThanOrEqual(25);
    });
  }
});

test.describe("Footer", () => {
  test("at 390px a wrapped line never starts or ends on a separator dot", async ({
    page,
  }) => {
    await openDashboard(page, 390);
    const footer = page.locator("footer");
    await expect(footer).toContainText(/Coverage \d+\.\d%/);

    const dots = await footer.evaluate((node) => {
      const isDot = (element: Element | null) =>
        element !== null &&
        element.getAttribute("aria-hidden") === "true" &&
        element.textContent === "·";
      const rowOf = (element: Element | null) =>
        element === null
          ? null
          : Math.round(element.getBoundingClientRect().top);
      const all = [...node.querySelectorAll('span[aria-hidden="true"]')].filter(
        isDot
      );
      const groups = [...node.querySelectorAll("div > span")].filter(
        (group) => group.parentElement?.parentElement === node
      );
      return {
        count: all.length,
        groupCount: groups.length,
        edgeDots: groups.filter(
          (group) =>
            isDot(group.firstElementChild) || isDot(group.lastElementChild)
        ).length,
        strayDots: all.filter((dot) => {
          const row = rowOf(dot);
          return (
            (dot.previousElementSibling !== null &&
              rowOf(dot.previousElementSibling) !== row) ||
            (dot.nextElementSibling !== null &&
              rowOf(dot.nextElementSibling) !== row)
          );
        }).length,
      };
    });

    expect(dots.groupCount).toBeGreaterThan(0);
    expect(dots.count).toBeGreaterThan(0);
    expect(dots.edgeDots).toBe(0);
    expect(dots.strayDots).toBe(0);
  });
});
