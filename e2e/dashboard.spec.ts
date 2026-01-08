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

  test("should display metric cards with seeded data", async ({ page }) => {
    // Wait for page to load
    await expect(
      page.getByRole("heading", { name: /wan monitor/i })
    ).toBeVisible({ timeout: 10000 });

    // Check for connectivity status card
    await expect(page.getByText(/connectivity/i)).toBeVisible();

    // Check for latency card (seeded data should show values)
    await expect(page.getByText(/latency/i)).toBeVisible();

    // Check for download speed card
    await expect(page.getByText(/download/i)).toBeVisible();

    // Check for upload speed card
    await expect(page.getByText(/upload/i)).toBeVisible();
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

    // Look for time range buttons (24h, 7d, 30d, etc.)
    await expect(page.getByRole("button", { name: "24h" })).toBeVisible();
    await expect(page.getByRole("button", { name: "7d" })).toBeVisible();
    await expect(page.getByRole("button", { name: "30d" })).toBeVisible();
  });

  test("should allow changing time range", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /wan monitor/i })
    ).toBeVisible({ timeout: 10000 });

    // Click on 7d button
    await page.getByRole("button", { name: "7d" }).click();

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

    // Get initial background color
    const body = page.locator("body");
    const initialColor = await body.evaluate(
      (el) => window.getComputedStyle(el).backgroundColor
    );

    // Click theme toggle
    const themeToggle = page.getByRole("button", {
      name: /toggle (dark mode|light mode|color mode)/i,
    });
    await themeToggle.click();

    // Wait for theme to change
    await page.waitForTimeout(500);

    // Background color should have changed
    const newColor = await body.evaluate(
      (el) => window.getComputedStyle(el).backgroundColor
    );
    expect(newColor).not.toBe(initialColor);
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

    // Wait for speedtest data to load
    await page.waitForTimeout(2000);

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
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const response = await request.get("http://localhost:3001/api/metrics", {
      params: {
        start: oneDayAgo.toISOString(),
        end: now.toISOString(),
        granularity: "15m",
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();

    // Should have data array
    expect(Array.isArray(body.data)).toBeTruthy();

    // Should have seeded data (at least some points)
    expect(body.data.length).toBeGreaterThan(0);

    // Verify data structure
    const firstMetric = body.data[0];
    expect(firstMetric).toHaveProperty("timestamp");
    expect(firstMetric).toHaveProperty("avg_latency");
    expect(firstMetric).toHaveProperty("avg_jitter");
    expect(firstMetric).toHaveProperty("avg_packet_loss");
  });

  test("should fetch speedtest history", async ({ request }) => {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const response = await request.get("http://localhost:3001/api/speedtests", {
      params: {
        start: oneDayAgo.toISOString(),
        end: now.toISOString(),
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();

    // Should have data array
    expect(Array.isArray(body.data)).toBeTruthy();

    // Should have seeded speedtest data
    expect(body.data.length).toBeGreaterThan(0);

    // Verify data structure
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
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const response = await request.get(
      "http://localhost:3001/api/connectivity-status",
      {
        params: {
          start: oneDayAgo.toISOString(),
          end: now.toISOString(),
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

    // Verify data structure
    const firstStatus = body.data[0];
    expect(firstStatus).toHaveProperty("timestamp");
    expect(firstStatus).toHaveProperty("status");
  });
});
