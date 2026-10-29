import { expect, type Request, test } from "@playwright/test";

test.describe("WAN Monitor Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("should load the dashboard without authentication (when auth disabled)", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "WAN Monitor" })
    ).toBeVisible({ timeout: 10000 });
  });

  test("should display the live status, the range figures and the stat rail", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "WAN Monitor" })
    ).toBeVisible({ timeout: 10000 });

    await expect(page.getByTestId("connection-status")).toHaveText(
      /^(Online|Degraded|Offline|No data)$/,
      { timeout: 15000 }
    );
    for (const testId of [
      "uptime-figure",
      "uptime-label",
      "outage-summary",
      "rail-latency",
      "rail-loss",
      "rail-jitter",
      "rail-download",
      "rail-upload",
    ]) {
      await expect(page.getByTestId(testId)).toBeVisible();
    }
  });

  test("should display the dashboard section headings", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "WAN Monitor" })
    ).toBeVisible({ timeout: 10000 });

    await expect(
      page.getByRole("heading", { name: "Availability", exact: true, level: 2 })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Network quality", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Speed tests", exact: true })
    ).toBeVisible();
  });

  // The only assertion covering the full preset list and the Apply/Cancel
  // controls: "Last 7 days" is clicked elsewhere (below, and in
  // range-refresh.spec.ts), but nothing else touches the remaining presets.
  test("should display date range selector", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "WAN Monitor" })
    ).toBeVisible({ timeout: 10000 });

    const trigger = page.locator("#date-range-picker-button");
    await expect(trigger).toBeVisible();
    await trigger.click();

    await expect(
      page.getByRole("button", { name: "Last 7 days" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Last 30 days" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Month to date" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Quarter to date" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Year to date" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Last 12 months" })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "All time" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
  });

  test("should close the date range picker when clicking page content outside it", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "WAN Monitor" })
    ).toBeVisible({ timeout: 10000 });

    await page.locator("#date-range-picker-button").click();
    const apply = page.getByRole("button", { name: "Apply" });
    await expect(apply).toBeVisible();

    // A raw mouse click at the centre of a figure below the header: a locator
    // click would refuse to run if anything covered the figure, and covering
    // it is what a working dismissal does.
    const figure = await page.getByTestId("uptime-figure").boundingBox();
    if (figure === null) throw new Error("uptime figure has no layout box");
    await page.mouse.click(
      figure.x + figure.width / 2,
      figure.y + figure.height / 2
    );

    await expect(apply).toBeHidden();
  });

  test("should allow changing the date range", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "WAN Monitor" })
    ).toBeVisible({ timeout: 10000 });

    const trigger = page.locator("#date-range-picker-button");
    const initialLabel = await trigger.textContent();

    await trigger.click();
    await page.getByRole("button", { name: "Last 7 days" }).click();
    await page.getByRole("button", { name: "Apply" }).click();

    // The trigger's label reflects the newly applied range, not the preset
    // name, so assert it changed rather than matching an exact string.
    await expect.poll(() => trigger.textContent()).not.toBe(initialLabel);

    // Charts re-render on ECharts canvases (data should update).
    await expect(
      page.locator('[aria-label="Latency chart"] canvas')
    ).toBeVisible();
  });

  test("should toggle dark mode", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "WAN Monitor" })
    ).toBeVisible({ timeout: 10000 });

    // The theme is persisted as part of the `wan_monitor_settings` blob;
    // assert the preference changes after choosing it in the menu rather than
    // sniffing computed styles.
    const readMode = () =>
      page.evaluate(() => {
        const raw = localStorage.getItem("wan_monitor_settings");
        return raw === null ? null : JSON.parse(raw).theme;
      });
    const initialMode = await readMode();

    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("menuitem", { name: "Dark" }).click();

    await expect.poll(readMode).toBe("dark");
    expect(initialMode).not.toBe("dark");
  });

  test("should display last updated indicator", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "WAN Monitor" })
    ).toBeVisible({ timeout: 10000 });

    await expect(page.getByTestId("last-updated")).toContainText("Updated", {
      timeout: 15000,
    });
  });

  test("should display resolved ISP information when speedtest data exists", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "WAN Monitor" })
    ).toBeVisible({ timeout: 10000 });

    // The default 30-day range already covers the latest speedtest (and its
    // ISP).

    // With speedtest data present (seeded baseline plus any live monitor
    // results) the header resolves a real ISP instead of the "ISP unknown"
    // fallback. We assert the fallback is gone rather than a specific value,
    // since the live monitor's ISP is environment-dependent.
    await expect(page.getByText("ISP unknown")).toHaveCount(0, {
      timeout: 15000,
    });
  });
});

test.describe("Dashboard renders seeded data (PHI-93)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "WAN Monitor" })
    ).toBeVisible({ timeout: 10000 });
  });

  test("status field and stat rail show non-placeholder seeded values", async ({
    page,
  }) => {
    // The seed anchors the most recent ping and speedtest at "now", so the
    // default date range has data behind every figure.
    await expect(page.getByTestId("connection-status")).toHaveText(
      /^(Online|Degraded|Offline|No data)$/,
      { timeout: 15000 }
    );
    await expect(page.getByTestId("uptime-figure")).toHaveText(
      /^\d+\.\d{2}%$/,
      { timeout: 15000 }
    );
    await expect(page.getByTestId("uptime-label")).toHaveText(
      "uptime over the last 30 days"
    );
    await expect(page.getByTestId("outage-summary")).toHaveText(
      /^(Down for .+|Degraded for .+|No outages in this period)\.$/,
      { timeout: 15000 }
    );
    await expect(page.getByTestId("rail-latency")).toContainText(
      /\d+(\.\d+)?\s*ms/,
      { timeout: 15000 }
    );
    await expect(page.getByTestId("rail-latency")).toContainText(
      /95th percentile \d/
    );
    await expect(page.getByTestId("rail-loss")).toContainText(
      /\d+(\.\d+)?\s*%/,
      { timeout: 15000 }
    );
    await expect(page.getByTestId("rail-jitter")).toContainText(
      /\d+(\.\d+)?\s*ms/,
      { timeout: 15000 }
    );
    await expect(page.getByTestId("rail-download")).toContainText(
      /\d+(\.\d+)?\s*Mbps/,
      { timeout: 15000 }
    );
    await expect(page.getByTestId("rail-download")).toContainText(
      /Median of \d+ tests?/
    );
    await expect(page.getByTestId("rail-upload")).toContainText(
      /\d+(\.\d+)?\s*Mbps/
    );
  });

  test("the availability ribbon renders a cell for every bucket of the range", async ({
    page,
  }) => {
    // The ribbon only renders once it has a window to draw cells across, so
    // visibility here proves the fetch settled.
    const ribbon = page.getByTestId("availability-ribbon");
    await expect(ribbon).toBeVisible({ timeout: 15000 });
    await expect(ribbon).toHaveAttribute(
      "aria-label",
      /^Each cell is one hour, from /
    );

    const cells = page.locator('[data-testid^="connectivity-segment-"]');
    expect(await cells.count()).toBeGreaterThan(24);

    const uptimeText =
      (await page.getByTestId("uptime-figure").textContent()) ?? "";
    expect(Number(uptimeText.match(/^([\d.]+)/)?.[1])).toBeGreaterThan(0);
  });

  test("hovering a ribbon cell shows a floating tooltip without shifting the page", async ({
    page,
  }) => {
    const ribbon = page.getByTestId("availability-ribbon");
    await expect(ribbon).toBeVisible({ timeout: 15000 });

    // The incidents card sits under the ribbon and sizes the page once it
    // loads, so let it settle before measuring anything below.
    await expect(page.getByTestId("incident-log")).toBeVisible({
      timeout: 15000,
    });

    await expect(page.getByRole("tooltip")).toHaveCount(0);

    // A heading further down the page: if the tooltip pushed content in
    // normal document flow rather than floating over the ribbon, this would
    // move when the tooltip appears.
    const belowFold = page.getByRole("heading", {
      name: "Network quality",
      exact: true,
    });
    // Measured from the top-left of the document, not the viewport: the hover
    // below scrolls the ribbon into view, which moves every viewport-relative
    // box without anything having shifted in the page.
    const documentBox = () =>
      belowFold.evaluate((element) => {
        const { left, top, width, height } = element.getBoundingClientRect();
        return {
          left: left + window.scrollX,
          top: top + window.scrollY,
          width,
          height,
        };
      });
    const boxBefore = await documentBox();

    // A 30-day ribbon has cells about a pixel wide, so the pointer goes to
    // a position along the ribbon rather than to one cell's centre.
    const box = await ribbon.boundingBox();
    expect(box).not.toBeNull();
    await ribbon.hover({
      position: { x: (box?.width ?? 0) * 0.9, y: (box?.height ?? 0) / 2 },
    });

    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    // Which grey label a cell with no readings gets depends on whether the
    // earliest-timestamp fetch has landed, so every status is acceptable.
    await expect(tooltip).toHaveText(
      /(\d+(\.\d+)?% (of the time )?(up|degraded|down)|No data|Before monitoring started)\.$/
    );

    expect(await documentBox()).toEqual(boxBefore);

    await page.mouse.move(0, 0);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  });

  test("the arrow keys step a tooltip along the ribbon from the keyboard", async ({
    page,
  }) => {
    const ribbon = page.getByTestId("availability-ribbon");
    await expect(ribbon).toBeVisible({ timeout: 15000 });

    await ribbon.focus();
    await expect(page.getByRole("tooltip")).toHaveCount(0);

    await page.keyboard.press("End");
    await expect(page.getByRole("tooltip")).toContainText("(this hour)");

    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("tooltip")).toBeVisible();
    await expect(page.getByRole("tooltip")).not.toContainText("(this hour)");

    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  });

  test("network quality charts render onto their canvases", async ({
    page,
  }) => {
    // Seed writes a ping every 15m across the last 24h, well within the
    // default 30-day range, so every chart has settled, seeded data behind it.
    for (const label of [
      "Latency chart",
      "Packet loss chart",
      "Jitter chart",
    ]) {
      const canvas = page.locator(`[aria-label="${label}"] canvas`);
      await expect(canvas).toBeVisible({ timeout: 15000 });
      const box = await canvas.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThan(0);
      expect(box?.height ?? 0).toBeGreaterThan(0);
    }
  });

  test("speed test history renders a chart and non-placeholder stats", async ({
    page,
  }) => {
    // The seeded speedtests span the last 24h, well within the default
    // 30-day range, so the stats resolve from more than a single sample.
    await expect(page.locator('[aria-label="Speed chart"] canvas')).toBeVisible(
      { timeout: 15000 }
    );

    for (const label of [
      "Avg download",
      "Avg upload",
      "Max download",
      "Max upload",
    ]) {
      const statLabel = page.getByText(label, { exact: true });
      await expect(statLabel).toBeVisible({ timeout: 15000 });
      // The value renders as the label's next sibling paragraph.
      const statValue = statLabel.locator("xpath=following-sibling::p[1]");
      await expect(statValue).toHaveText(/^\d+(\.\d+)?\s*Mbps$/, {
        timeout: 15000,
      });
    }
  });
});

test.describe("API Health", () => {
  test("health endpoint should return ok", async ({ request }) => {
    const response = await request.get("http://localhost:3001/api/health/live");
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.status).toBe("ok");
  });

  test("readiness endpoint should return ok", async ({ request }) => {
    const response = await request.get(
      "http://localhost:3001/api/health/ready"
    );
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.status).toBe("ok");
  });
});

test.describe("Metrics API with Seeded Data", () => {
  test("should fetch ping metrics", async ({ request }) => {
    const now = new Date();
    const windowStart = new Date(now.getTime() - 25 * 60 * 60 * 1000);

    const response = await request.get("http://localhost:3001/api/metrics", {
      params: {
        startTime: windowStart.toISOString(),
        endTime: now.toISOString(),
        granularity: "15m",
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();

    expect(Array.isArray(body.data)).toBeTruthy();
    expect(body.data.length).toBeGreaterThan(0);

    // /api/metrics returns both ping and speedtest rows; verify a ping row
    // matches the MetricSchema contract (speedtest rows carry no packet_loss).
    const pingMetric = body.data.find(
      (m: { source?: string }) => m.source === "ping"
    );
    expect(pingMetric).toBeDefined();
    expect(pingMetric).toHaveProperty("timestamp");
    expect(pingMetric).toHaveProperty("source", "ping");
    expect(pingMetric).toHaveProperty("latency");
    expect(pingMetric).toHaveProperty("jitter");
    expect(pingMetric).toHaveProperty("packet_loss");

    expect(body.meta).toHaveProperty("count", body.data.length);
  });

  test("should fetch speedtest history", async ({ request }) => {
    const now = new Date();
    const windowStart = new Date(now.getTime() - 25 * 60 * 60 * 1000);

    const response = await request.get(
      "http://localhost:3001/api/speedtest/history",
      {
        params: {
          startTime: windowStart.toISOString(),
          endTime: now.toISOString(),
        },
      }
    );

    expect(response.ok()).toBeTruthy();
    const body = await response.json();

    expect(Array.isArray(body.data)).toBeTruthy();
    expect(body.data.length).toBeGreaterThan(0);

    const firstSpeedtest = body.data[0];
    expect(firstSpeedtest).toHaveProperty("timestamp");
    expect(firstSpeedtest).toHaveProperty("download_speed");
    expect(firstSpeedtest).toHaveProperty("upload_speed");
    expect(firstSpeedtest).toHaveProperty("isp");
  });

  test("should fetch connectivity status", async ({ request }) => {
    const now = new Date();
    const windowStart = new Date(now.getTime() - 25 * 60 * 60 * 1000);

    const response = await request.get(
      "http://localhost:3001/api/connectivity-status",
      {
        params: {
          startTime: windowStart.toISOString(),
          endTime: now.toISOString(),
          granularity: "5m",
        },
      }
    );

    expect(response.ok()).toBeTruthy();
    const body = await response.json();

    expect(Array.isArray(body.data)).toBeTruthy();
    expect(body.data.length).toBeGreaterThan(0);

    const firstStatus = body.data[0];
    expect(firstStatus).toHaveProperty("timestamp");
    expect(firstStatus).toHaveProperty("status");
    expect(firstStatus).toHaveProperty("upPercentage");
  });
});

// Needs the e2e backend's empty WAN_MONITOR_PASSWORD (sign-in disabled).
test("sends no Authorization header while sign-in is disabled", async ({
  page,
}) => {
  const apiRequests: Array<Request> = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) {
      apiRequests.push(request);
    }
  });

  await page.goto("/");
  await expect(page.getByTestId("connection-status")).toHaveText(
    /^(Online|Degraded|Offline|No data)$/,
    { timeout: 15000 }
  );
  await expect(page.locator('[aria-label="Latency chart"] canvas')).toBeVisible(
    { timeout: 10000 }
  );

  expect(
    apiRequests.map((request) => new URL(request.url()).pathname)
  ).toContain("/api/metrics");
  const withAuthorization = await Promise.all(
    apiRequests.map(async (request) => ({
      path: new URL(request.url()).pathname,
      authorization: (await request.allHeaders()).authorization,
    }))
  );
  expect(
    withAuthorization.filter(({ authorization }) => authorization !== undefined)
  ).toEqual([]);
});
