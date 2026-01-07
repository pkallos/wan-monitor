import { expect, test } from "@playwright/test";

test.describe("E2E Infrastructure Smoke Tests", () => {
  test("server health endpoint responds", async ({ request }) => {
    const response = await request.get("http://localhost:3001/api/health/live");
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.status).toBe("ok");
  });

  test("can load dashboard page", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/WAN Monitor/i, { timeout: 15000 });
  });
});
