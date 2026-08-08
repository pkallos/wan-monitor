import { expect, type Page, test } from "@playwright/test";

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

  test("should display metric cards", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "WAN Monitor" })
    ).toBeVisible({ timeout: 10000 });

    // Top-row metric cards render their titles as headings.
    await expect(
      page.getByRole("heading", { name: "Connectivity", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Download Speed", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Upload Speed", exact: true })
    ).toBeVisible();
  });

  test("should display the dashboard section headings", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "WAN Monitor" })
    ).toBeVisible({ timeout: 10000 });

    await expect(
      page.getByRole("heading", { name: "Connectivity Status", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Network Quality", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Speed Test History", exact: true })
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

    // The theme is persisted here; assert the mode flips after clicking the
    // toggle rather than sniffing computed styles.
    const readMode = () =>
      page.evaluate(() => localStorage.getItem("wan_monitor_theme"));
    const initialMode = await readMode();

    const themeToggle = page.getByRole("button", {
      name: /^(Dark mode|Light mode)$/,
    });
    await themeToggle.click();

    await expect.poll(readMode).not.toBe(initialMode);
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
    // results) the header resolves a real ISP instead of the "Unknown ISP"
    // fallback. We assert the fallback is gone rather than a specific value,
    // since the live monitor's ISP is environment-dependent.
    await expect(page.getByText("Unknown ISP")).toHaveCount(0, {
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

  // Locate a top metric card by its (case-sensitive) heading, returning the
  // card container so we can assert on the value it renders.
  const metricCard = (page: Page, title: string) =>
    page.getByRole("heading", { name: title, exact: true }).locator("..");

  test("top metric cards show non-placeholder seeded values", async ({
    page,
  }) => {
    // The seed anchors the most recent ping and speedtest at "now", so the
    // default date range has data behind every top card.

    // Connectivity resolves to a real status, never the "Checking…" placeholder.
    await expect(metricCard(page, "Connectivity")).toContainText(
      /Online|Degraded|Offline|No Data/,
      { timeout: 15000 }
    );

    // A digit immediately before "Mbps" proves a real reading; the empty state
    // renders "- Mbps", which this pattern rejects.
    await expect(metricCard(page, "Download Speed")).toContainText(
      /\d+(\.\d+)?\s*Mbps/,
      { timeout: 15000 }
    );
    await expect(metricCard(page, "Upload Speed")).toContainText(
      /\d+(\.\d+)?\s*Mbps/,
      { timeout: 15000 }
    );
  });

  test("connectivity status timeline renders seeded data", async ({ page }) => {
    // The timeline exposes role="img" only once it has a window to draw
    // segments across, so visibility here proves the fetch settled.
    await expect(
      page.getByRole("img", { name: "Connectivity status timeline" })
    ).toBeVisible({ timeout: 15000 });

    // Uptime is rendered once data resolves. The line may carry a coverage
    // suffix when the seeded window is shorter than the selected range, so
    // only the leading uptime figure is anchored.
    const uptime = page.getByText(/^Uptime: \d+\.\d+%/);
    await expect(uptime).toBeVisible({ timeout: 15000 });
    const uptimeText = (await uptime.textContent()) ?? "";
    const uptimePct = Number(uptimeText.match(/^Uptime: ([\d.]+)%/)?.[1]);
    expect(uptimePct).toBeGreaterThan(0);
  });

  test("hovering a connectivity segment shows a floating tooltip without shifting the page", async ({
    page,
  }) => {
    await expect(
      page.getByRole("img", { name: "Connectivity status timeline" })
    ).toBeVisible({ timeout: 15000 });

    const segments = page.locator('[data-testid^="connectivity-segment-"]');
    const segmentCount = await segments.count();
    expect(segmentCount).toBeGreaterThan(0);

    await expect(page.getByRole("tooltip")).toHaveCount(0);

    // A heading further down the page: if the tooltip pushed content in
    // normal document flow (the original bug) rather than floating above the
    // bar, this would move when the tooltip appears.
    const belowFold = page.getByRole("heading", {
      name: "Network Quality",
      exact: true,
    });
    const boxBefore = await belowFold.boundingBox();

    // The seed only populates the last 24h within the default 30-day range,
    // so the first segment is always the unmeasured run spanning the rest of
    // the window - wide and reliably hoverable, unlike an arbitrary middle
    // segment, which can be a single narrow bucket easily overlapped by its
    // neighbors.
    await segments.first().hover();

    // Any of the timeline's labels is acceptable here; this test is about the
    // tooltip appearing without shifting the page. Which of the two grey
    // labels the leading run gets depends on whether the earliest-timestamp
    // fetch has landed, so it isn't pinned to one.
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveText(
      /: (Up|Down|Degraded|No Data \(monitor offline\)|Before monitoring started)$/
    );

    const boxAfter = await belowFold.boundingBox();
    expect(boxAfter).toEqual(boxBefore);

    await page.mouse.move(0, 0);
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
      "Avg Download",
      "Avg Upload",
      "Max Download",
      "Max Upload",
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
