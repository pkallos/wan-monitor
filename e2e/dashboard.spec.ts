import { expect, type Page, test } from "@playwright/test";

test.describe("WAN Monitor Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("should load the dashboard without authentication (when auth disabled)", async ({
    page,
  }) => {
    // Wait for dashboard to load (look for heading)
    await expect(
      page.getByRole("heading", { name: /wan monitor/i })
    ).toBeVisible({ timeout: 10000 });
  });

  test("should display metric cards", async ({ page }) => {
    // Wait for page to load
    await expect(
      page.getByRole("heading", { name: /wan monitor/i })
    ).toBeVisible({ timeout: 10000 });

    // Top-row metric cards render their titles as headings. Use exact names
    // so "Connectivity" does not also match the "Connectivity Status" heading.
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
      page.getByRole("heading", { name: /wan monitor/i })
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

  test("should display date range selector", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /wan monitor/i })
    ).toBeVisible({ timeout: 10000 });

    // Time range buttons use human-readable labels from TIME_RANGE_LABELS.
    await expect(page.getByRole("button", { name: "1 Hour" })).toBeVisible();
    await expect(page.getByRole("button", { name: "24 Hours" })).toBeVisible();
    await expect(page.getByRole("button", { name: "7 Days" })).toBeVisible();
    await expect(page.getByRole("button", { name: "30 Days" })).toBeVisible();
  });

  test("should allow changing time range", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /wan monitor/i })
    ).toBeVisible({ timeout: 10000 });

    // Click on the 7 Days button
    await page.getByRole("button", { name: "7 Days" }).click();

    // Wait for data to refresh
    await page.waitForTimeout(1000);

    // Verify charts still render (data should update)
    const svgCharts = page.locator("svg.recharts-surface");
    await expect(svgCharts.first()).toBeVisible();
  });

  test("should have theme toggle", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /wan monitor/i })
    ).toBeVisible({ timeout: 10000 });

    // Look for theme toggle button (moon/sun icon)
    const themeToggle = page.getByRole("button", {
      name: /toggle (dark mode|light mode|color mode)/i,
    });
    await expect(themeToggle).toBeVisible();
  });

  test("should toggle dark mode", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /wan monitor/i })
    ).toBeVisible({ timeout: 10000 });

    // Chakra persists the active color mode in localStorage. Assert the mode
    // flips after clicking the toggle rather than sniffing computed styles,
    // which is far less flaky across theme implementations.
    const readMode = () =>
      page.evaluate(() => localStorage.getItem("chakra-ui-color-mode"));
    const initialMode = await readMode();

    const themeToggle = page.getByRole("button", {
      name: /toggle (dark mode|light mode|color mode)/i,
    });
    await themeToggle.click();

    await expect.poll(readMode).not.toBe(initialMode);
  });

  test("should have pause/play button for auto-refresh", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /wan monitor/i })
    ).toBeVisible({ timeout: 10000 });

    // Look for pause/play button
    const pausePlayButton = page.getByRole("button", {
      name: /(pause|play) auto-refresh/i,
    });
    await expect(pausePlayButton).toBeVisible();
  });

  test("should display last updated timestamp", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /wan monitor/i })
    ).toBeVisible({ timeout: 10000 });

    // Scope to the "Updated …s/m ago" indicator specifically. A bare /ago/i
    // also matches the MetricCard "as of …ago" subtitles (Connectivity,
    // Download, Upload), which is a strict-mode violation.
    await expect(page.getByText(/updated .*ago/i)).toBeVisible({
      timeout: 15000,
    });
  });

  test("should have manual refresh button", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /wan monitor/i })
    ).toBeVisible({ timeout: 10000 });

    // Use the exact accessible name so this does not also match the
    // "Pause auto-refresh" button (strict-mode violation on /refresh/i).
    const refreshButton = page.getByRole("button", { name: "Refresh now" });
    await expect(refreshButton).toBeVisible();
  });

  test("should display resolved ISP information when speedtest data exists", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: /wan monitor/i })
    ).toBeVisible({ timeout: 10000 });

    // Widen the range so the latest speedtest (and its ISP) is in view.
    await page.getByRole("button", { name: "24 Hours" }).click();

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
      page.getByRole("heading", { name: /wan monitor/i })
    ).toBeVisible({ timeout: 10000 });
  });

  // Locate a top metric card by its (case-sensitive) heading, returning the
  // card container so we can assert on the value it renders.
  const metricCard = (page: Page, title: string) =>
    page.getByRole("heading", { name: title, exact: true }).locator("..");

  test("top metric cards show non-placeholder seeded values", async ({
    page,
  }) => {
    // The seed anchors the most recent ping and speedtest at "now", so even the
    // default 1h window has data behind every top card.

    // Connectivity resolves to a real status, never a placeholder.
    await expect(metricCard(page, "Connectivity")).toContainText(
      /Online|Offline/,
      { timeout: 15000 }
    );

    // A digit immediately before "Mbps" proves a real reading; the empty state
    // renders "-Mbps", which this pattern rejects.
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
    // The timeline exposes role="img" only when it has segments to draw; the
    // empty state is a plain box, so visibility here proves data rendered.
    await expect(
      page.getByRole("img", { name: "Connectivity status timeline" })
    ).toBeVisible({ timeout: 15000 });

    // Uptime is always rendered, so assert it resolved to a real, non-zero
    // percentage rather than the 0.00% no-data value.
    const uptime = page.getByText(/^Uptime: \d+\.\d+%$/);
    await expect(uptime).toBeVisible({ timeout: 15000 });
    const uptimeText = (await uptime.textContent()) ?? "";
    const uptimePct = Number(uptimeText.match(/([\d.]+)%/)?.[1]);
    expect(uptimePct).toBeGreaterThan(0);
  });

  test("network quality charts render seeded data lines", async ({ page }) => {
    // Seed writes a ping every 15m across the last 24h. The 7-day view buckets
    // at 15m granularity, so those points align into continuous line paths
    // (shorter ranges bucket to 1m/5m and leave the sparse points isolated).
    await page.getByRole("button", { name: "7 Days" }).click();

    for (const label of ["Latency (ms)", "Packet Loss (%)", "Jitter (ms)"]) {
      // Scope to the chart via its visible section label, then read recharts'
      // own line path — no test-only markup on the components.
      const curve = page
        .getByText(label, { exact: true })
        .locator("..")
        .locator(".recharts-line-curve")
        .first();
      await expect(curve).toBeAttached({ timeout: 15000 });
      // A drawn multi-point path starts with a MoveTo and carries draw
      // commands; an isolated/empty series would be absent or a trivial "M x,y".
      await expect
        .poll(async () => (await curve.getAttribute("d"))?.length ?? 0, {
          timeout: 15000,
        })
        .toBeGreaterThan(20);
    }
  });

  test("speed test history renders seeded lines and stats", async ({
    page,
  }) => {
    // The 6 seeded speedtests span the last 24h; widen to 24h so both the
    // download and upload lines have multiple points to draw.
    await page.getByRole("button", { name: "24 Hours" }).click();

    // The heading sits inside a header row (HStack); its grandparent is the
    // section box that also holds the chart and stats.
    const speedSection = page
      .getByRole("heading", { name: "Speed Test History" })
      .locator("../..");

    const curve = speedSection.locator(".recharts-line-curve").first();
    await expect(curve).toBeAttached({ timeout: 15000 });
    await expect
      .poll(async () => (await curve.getAttribute("d"))?.length ?? 0, {
        timeout: 15000,
      })
      .toBeGreaterThan(20);

    // Each Stat pairs a label with a number; scope by the label and assert the
    // number resolves to a value, not the "-" fallback.
    for (const label of [
      "Avg Download",
      "Avg Upload",
      "Max Download",
      "Max Upload",
    ]) {
      const stat = speedSection
        .locator(".chakra-stat")
        .filter({ hasText: label });
      await expect(stat.locator(".chakra-stat__number")).toHaveText(
        /^\d+(\.\d+)?\s*Mbps/,
        { timeout: 15000 }
      );
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

    // Should have data array
    expect(Array.isArray(body.data)).toBeTruthy();

    // Should have data (at least some points)
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

    // Should have data array
    expect(Array.isArray(body.data)).toBeTruthy();

    // Should have speedtest data
    expect(body.data.length).toBeGreaterThan(0);

    // Verify data structure matches the SpeedMetricSchema contract
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

    // Should have data array
    expect(Array.isArray(body.data)).toBeTruthy();

    // Should have seeded data
    expect(body.data.length).toBeGreaterThan(0);

    // Verify data structure matches the ConnectivityStatusPointSchema contract
    const firstStatus = body.data[0];
    expect(firstStatus).toHaveProperty("timestamp");
    expect(firstStatus).toHaveProperty("status");
    expect(firstStatus).toHaveProperty("upPercentage");
  });
});
