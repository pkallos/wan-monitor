import {
  expect,
  type Page,
  type Request,
  type Response,
  test,
} from "@playwright/test";

/**
 * The interactive parts of the network quality charts: the all-hosts and
 * per-host latency views, and brushing the latency chart to narrow the page's
 * range.
 */

const loaded = async (page: Page) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "WAN Monitor" })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId("incident-log")).toBeVisible({
    timeout: 15_000,
  });
};

const isMetricsResponse = (response: Response) =>
  /\/api\/metrics\?/.test(response.url()) && response.ok();

const DAY_MS = 24 * 60 * 60 * 1000;

const metricsWindowMs = (url: string) => {
  const params = new URL(url).searchParams;
  return (
    Date.parse(params.get("endTime") ?? "") -
    Date.parse(params.get("startTime") ?? "")
  );
};

/** A metrics request for a window of at most a week, which the default 30 day range never requests. */
const isWeekMetricsRequest = (request: Request) =>
  /\/api\/metrics\?/.test(request.url()) &&
  metricsWindowMs(request.url()) < 8 * DAY_MS;

/** Resolves once the next refresh has come back from the API. */
const refreshedOnce = async (page: Page) => {
  const settled = page.waitForResponse(isMetricsResponse);
  await page.getByRole("button", { name: "Refresh now" }).click();
  await settled;
};

/** Resolves once the frame after the current one has painted. */
const afterNextPaint = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );

const storedLatencyView = (page: Page) =>
  page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("wan_monitor_settings") ?? "{}")
        .latencyView
  );

test.describe("Network quality charts", () => {
  test("load and interact without a single page error", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await loaded(page);
    await expect(
      page.locator('[aria-label="Latency chart"] canvas')
    ).toBeVisible({ timeout: 15_000 });
    await page.setViewportSize({ width: 900, height: 800 });
    await page.setViewportSize({ width: 1280, height: 720 });
    const weekRequests: Request[] = [];
    page.on("request", (request) => {
      if (isWeekMetricsRequest(request)) weekRequests.push(request);
    });
    await page.getByRole("button", { name: "7d" }).click();
    await expect(page.getByRole("button", { name: "7d" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    // The latency chart names its range, and says "Loading." until data for
    // that range has been handled, so this holds only once the 7d response has
    // rendered.
    await expect(
      page
        .locator('[aria-label="Latency chart"]')
        .getByRole("img", { name: /^For the last 7 days\. (?!Loading\.$)/ })
    ).toBeVisible();
    await expect(
      page.getByRole("status", { name: /^Loading .* chart$/ })
    ).toHaveCount(0);
    expect(weekRequests).not.toHaveLength(0);
    await Promise.all(
      weekRequests.map(async (request) =>
        (await request.response())?.finished()
      )
    );
    await afterNextPaint(page);

    expect(errors).toEqual([]);
  });

  test("the chart titles are plain names and the latency row has a legend for its two series", async ({
    page,
  }) => {
    await loaded(page);
    const card = page.locator("section", {
      has: page.getByRole("heading", { name: "Network quality" }),
    });

    for (const title of ["Latency", "Packet loss", "Jitter"]) {
      await expect(card.getByText(title, { exact: true })).toBeVisible();
    }
    await expect(card.getByText("Median", { exact: true })).toBeVisible();
    await expect(card.getByText("95th percentile range")).toBeVisible();
    await expect(card).not.toContainText("·");
  });

  test("a plain turn of the wheel over a chart still scrolls the page", async ({
    page,
  }) => {
    await loaded(page);
    const canvas = page.locator('[aria-label="Latency chart"] canvas');
    await expect(canvas).toBeVisible({ timeout: 15_000 });
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const before = await page.evaluate(() => window.scrollY);

    await page.mouse.move(
      (box?.x ?? 0) + (box?.width ?? 0) / 2,
      (box?.y ?? 0) + (box?.height ?? 0) / 2
    );
    await page.mouse.wheel(0, 200);

    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(before);
  });

  test("the loading state hides the previous range's plot completely", async ({
    page,
  }) => {
    await loaded(page);
    await expect(
      page.locator('[aria-label="Latency chart"] canvas')
    ).toBeVisible({ timeout: 15_000 });
    await page.route(/\/api\/metrics\?/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 6_000));
      await route.continue();
    });

    await page.getByRole("button", { name: "24h" }).click();

    const cover = page.getByRole("status", { name: "Loading latency chart" });
    await expect(cover).toBeVisible();
    const alpha = await cover.evaluate((element) => {
      const channels = (
        getComputedStyle(element).backgroundColor.match(/[\d.]+/g) ?? []
      ).map(Number);
      return channels.length < 3 ? 0 : (channels[3] ?? 1);
    });
    expect(alpha).toBe(1);
  });

  test.describe("the latency chart's host view", () => {
    test("starts on all hosts and asks for no per-host series", async ({
      page,
    }) => {
      const hostRequests: string[] = [];
      page.on("request", (request) => {
        if (/\/api\/metrics\?.*host=/.test(request.url())) {
          hostRequests.push(request.url());
        }
      });

      await loaded(page);
      await expect(
        page.getByRole("radio", { name: "All hosts" })
      ).toBeChecked();
      await refreshedOnce(page);

      expect(hostRequests).toEqual([]);
    });

    test("per host draws the host lines without waiting for the all-hosts metrics", async ({
      page,
    }) => {
      await loaded(page);
      await page.getByRole("radio", { name: "Per host" }).click();
      await expect.poll(() => storedLatencyView(page)).toBe("perHost");
      await page.route(/\/api\/metrics\?/, async (route) => {
        if (!new URL(route.request().url()).searchParams.has("host")) {
          await new Promise((resolve) => setTimeout(resolve, 8_000));
        }
        await route.continue();
      });

      await page.reload();

      const chart = page.getByRole("group", { name: "Latency chart" });
      await expect(
        chart.getByRole("img", { name: /Median latency per host/ })
      ).toBeVisible({ timeout: 6_000 });
      await expect
        .poll(
          () =>
            chart.locator("canvas").evaluate((element) => {
              if (!(element instanceof HTMLCanvasElement)) return false;
              const { data } =
                element
                  .getContext("2d")
                  ?.getImageData(0, 0, element.width, element.height) ?? {};
              return data?.some((value, index) => index % 4 === 3 && value > 0);
            }),
          { timeout: 6_000 }
        )
        .toBe(true);
    });

    test("per host fetches one series per host, remembers the choice, and going back stops the fetching", async ({
      page,
      request,
    }) => {
      const configured = await request.get("/api/ping/hosts");
      const { hosts } = (await configured.json()) as {
        hosts: ReadonlyArray<string>;
      };
      expect(hosts.length).toBeGreaterThan(1);

      const hostRequests: string[] = [];
      page.on("request", (request) => {
        if (/\/api\/metrics\?.*host=/.test(request.url())) {
          hostRequests.push(
            new URL(request.url()).searchParams.get("host") ?? ""
          );
        }
      });
      await loaded(page);

      await page.getByRole("radio", { name: "Per host" }).click();

      await expect
        .poll(() => [...hostRequests].sort(), { timeout: 15_000 })
        .toEqual([...hosts].sort());
      await expect(page.getByRole("radio", { name: "Per host" })).toBeChecked();
      await expect(
        page.locator('[aria-label="Latency chart"] canvas')
      ).toBeVisible();
      await expect.poll(() => storedLatencyView(page)).toBe("perHost");

      await page.reload();
      await expect(page.getByRole("radio", { name: "Per host" })).toBeChecked();

      await page.getByRole("radio", { name: "All hosts" }).click();
      await expect.poll(() => storedLatencyView(page)).toBe("all");
      const requestsSoFar = hostRequests.length;
      await refreshedOnce(page);

      expect(hostRequests).toHaveLength(requestsSoFar);
    });
  });

  test.describe("brushing the latency chart", () => {
    const dragAcrossLatencyChart = async (page: Page) => {
      const canvas = page.locator('[aria-label="Latency chart"] canvas');
      await expect(canvas).toBeVisible({ timeout: 15_000 });
      await canvas.scrollIntoViewIfNeeded();
      // The chart is named by its figures once its data has landed, and the
      // brush is armed in the same paint that follows.
      await expect(
        page
          .getByRole("group", { name: "Latency chart" })
          .getByRole("img", { name: /^For .* averages/ })
      ).toBeVisible({ timeout: 15_000 });
      await afterNextPaint(page);
      const box = await canvas.boundingBox();
      expect(box).not.toBeNull();
      const { x, y, width, height } = box ?? {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      };
      await page.mouse.move(x + width * 0.55, y + height / 2);
      await page.mouse.down();
      await page.mouse.move(x + width * 0.7, y + height / 2, { steps: 8 });
      await page.mouse.move(x + width * 0.9, y + height / 2, { steps: 8 });
      await page.mouse.up();
    };

    const rangeButton = (page: Page) =>
      page.locator("#date-range-picker-button");

    test("a drag narrows the whole page to that span, and Reset range brings the old range back", async ({
      page,
    }) => {
      await loaded(page);
      await expect(
        page.getByRole("button", { name: "Reset range" })
      ).toHaveCount(0);
      const before = await rangeButton(page).textContent();
      const metricsRequests: string[] = [];
      page.on("request", (request) => {
        if (/\/api\/metrics\?/.test(request.url())) {
          metricsRequests.push(request.url());
        }
      });

      await dragAcrossLatencyChart(page);

      await expect(
        page.getByRole("button", { name: "Reset range" })
      ).toBeVisible({ timeout: 10_000 });
      await expect(rangeButton(page)).not.toHaveText(before ?? "");
      await expect(page.getByRole("button", { name: "30d" })).toHaveAttribute(
        "aria-pressed",
        "false"
      );
      await expect.poll(() => metricsRequests.length).toBeGreaterThan(0);

      await page.getByRole("button", { name: "Reset range" }).click();

      await expect(
        page.getByRole("button", { name: "Reset range" })
      ).toHaveCount(0);
      await expect(page.getByRole("button", { name: "30d" })).toHaveAttribute(
        "aria-pressed",
        "true"
      );
    });

    test("the brushed span's label is shown in full, not cut off", async ({
      page,
    }) => {
      await loaded(page);

      await dragAcrossLatencyChart(page);

      await expect(
        page.getByRole("button", { name: "Reset range" })
      ).toBeVisible({ timeout: 10_000 });
      const label = page.getByTestId("date-range-label");
      await expect(label).toContainText("–");
      const [scrollWidth, clientWidth] = await label.evaluate((element) => [
        element.scrollWidth,
        element.clientWidth,
      ]);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    });

    test("choosing a range yourself ends the narrowing", async ({ page }) => {
      await loaded(page);
      await dragAcrossLatencyChart(page);
      await expect(
        page.getByRole("button", { name: "Reset range" })
      ).toBeVisible({ timeout: 10_000 });

      await page.getByRole("button", { name: "7d" }).click();

      await expect(
        page.getByRole("button", { name: "Reset range" })
      ).toHaveCount(0);
    });
  });
});
