import { expect, test } from "@playwright/test";

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

  test("should display charts with seeded data", async ({ page }) => {
    // Wait for dashboard to fully load
    await expect(
      page.getByRole("heading", { name: /wan monitor/i })
    ).toBeVisible({ timeout: 10000 });

    // Wait a bit for charts to render (they load data via API)
    await page.waitForTimeout(2000);

    // Check that chart containers exist (Recharts renders SVGs)
    const svgCharts = page.locator("svg.recharts-surface");
    await expect(svgCharts.first()).toBeVisible({ timeout: 10000 });

    // Should have multiple charts
    const chartCount = await svgCharts.count();
    expect(chartCount).toBeGreaterThan(0);
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

    // Look for "last updated" or "ago" text
    await expect(page.getByText(/ago/i)).toBeVisible({ timeout: 15000 });
  });

  test("should have manual refresh button", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /wan monitor/i })
    ).toBeVisible({ timeout: 10000 });

    // Look for refresh button
    const refreshButton = page.getByRole("button", { name: /refresh/i });
    await expect(refreshButton).toBeVisible();
  });

  test("should show ISP information from seeded speedtest data", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: /wan monitor/i })
    ).toBeVisible({ timeout: 10000 });

    // Seeded speedtests span the last 24h at 4-hour intervals, so widen the
    // range to guarantee the latest one (and its ISP) is in view.
    await page.getByRole("button", { name: "24 Hours" }).click();

    // Should display ISP name from seeded data
    await expect(page.getByText(/testisp/i)).toBeVisible({ timeout: 10000 });
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

    // Should have seeded data (at least some points)
    expect(body.data.length).toBeGreaterThan(0);

    // Verify data structure matches the MetricSchema contract
    const firstMetric = body.data[0];
    expect(firstMetric).toHaveProperty("timestamp");
    expect(firstMetric).toHaveProperty("source");
    expect(firstMetric).toHaveProperty("latency");
    expect(firstMetric).toHaveProperty("jitter");
    expect(firstMetric).toHaveProperty("packet_loss");

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

    // Should have seeded speedtest data
    expect(body.data.length).toBeGreaterThan(0);

    // Verify data structure matches the SpeedMetricSchema contract
    const firstSpeedtest = body.data[0];
    expect(firstSpeedtest).toHaveProperty("timestamp");
    expect(firstSpeedtest).toHaveProperty("download_speed");
    expect(firstSpeedtest).toHaveProperty("upload_speed");
    expect(firstSpeedtest).toHaveProperty("isp");

    // Verify seeded ISP value
    expect(firstSpeedtest.isp).toBe("TestISP");
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
