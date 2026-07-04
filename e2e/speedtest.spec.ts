import { expect, test } from "@playwright/test";

/**
 * E2E: "Run Speed Test" button triggers the backend and updates the UI.
 *
 * The backend runs with SPEEDTEST_STUB=true (see playwright.config.ts), so the
 * speed test executes offline and returns deterministic results:
 *   download = 500 Mbps, upload = 100 Mbps
 * These values sit well outside the seeded ranges (100-125 down, 10-20 up) so a
 * stubbed result is unambiguous in both API assertions and the rendered cards.
 */

const STUB_DOWNLOAD_MBPS = 500;
const STUB_UPLOAD_MBPS = 100;

test.describe("Run Speed Test", () => {
  test.beforeEach(async ({ page }) => {
    // The server reports "live" before its QuestDB connection is established.
    // Wait for readiness (DB connected) so the speed test's live write is not
    // silently dropped by racing the still-connecting DB layer.
    await expect
      .poll(
        async () =>
          (
            await page.request.get("http://localhost:3001/api/health/ready")
          ).status(),
        { timeout: 30000 }
      )
      .toBe(200);

    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /wan monitor/i })
    ).toBeVisible({ timeout: 10000 });
  });

  test("triggers POST /speedtest/trigger, shows success toast, and updates history", async ({
    page,
  }) => {
    const triggerResponsePromise = page.waitForResponse(
      (res) =>
        res.url().includes("/speedtest/trigger") &&
        res.request().method() === "POST",
      { timeout: 30000 }
    );

    await page.getByRole("button", { name: /run speed test/i }).click();

    // Backend is called and returns the deterministic stub result.
    const triggerResponse = await triggerResponsePromise;
    expect(triggerResponse.status()).toBe(200);
    const triggerBody = await triggerResponse.json();
    expect(triggerBody.success).toBe(true);
    expect(triggerBody.result.downloadMbps).toBe(STUB_DOWNLOAD_MBPS);
    expect(triggerBody.result.uploadMbps).toBe(STUB_UPLOAD_MBPS);

    // Success toast appears with the download/upload summary.
    await expect(page.getByText("Speed test complete")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.getByText("Download: 500.0 Mbps, Upload: 100.0 Mbps")
    ).toBeVisible();

    // History updates: the persisted result surfaces in the UI. The dashboard
    // freezes its query window's endTime when the time range is selected, so a
    // just-written (now-stamped) row falls after endTime until the window is
    // recomputed. Reload to recompute endTime, then poll "Refresh now" so the
    // assertion is robust against QuestDB's async WAL commit.
    await page.reload();
    await expect(
      page.getByRole("heading", { name: /wan monitor/i })
    ).toBeVisible({ timeout: 10000 });

    const downloadSpeedValue = page
      .getByRole("heading", { name: "Download Speed", exact: true })
      .locator("xpath=following-sibling::p");

    await expect(async () => {
      await page.getByRole("button", { name: "Refresh now" }).click();
      await expect(downloadSpeedValue).toContainText("500.0", {
        timeout: 3000,
      });
    }).toPass({ timeout: 20000 });
  });
});
