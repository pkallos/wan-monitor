import { expect, type Page, test } from "@playwright/test";

// Chakra stores the active colour mode here; it is the source of truth for
// persistence and is re-read on every page load.
const STORAGE_KEY = "chakra-ui-color-mode";

const readStoredMode = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);

test.describe("Theme persistence", () => {
  // Pin the emulated OS preference to light so "default theme" is deterministic
  // regardless of the machine/CI runner running the suite.
  test.use({ colorScheme: "light" });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /wan monitor/i })
    ).toBeVisible({ timeout: 10000 });
  });

  test("persists the selected color mode across page reloads", async ({
    page,
  }) => {
    const themeToggle = page.getByRole("button", {
      name: /toggle (dark mode|light mode|color mode)/i,
    });

    // Default theme follows the (pinned light) OS preference. Chakra applies a
    // chakra-ui-light / chakra-ui-dark class to <body>, our stable UI signal.
    await expect(page.locator("body")).toHaveClass(/chakra-ui-light/);
    await expect.poll(() => readStoredMode(page)).not.toBe("dark");

    // Toggle to dark mode -> UI updates.
    await themeToggle.click();
    await expect(page.locator("body")).toHaveClass(/chakra-ui-dark/);
    await expect.poll(() => readStoredMode(page)).toBe("dark");

    // Reload -> dark mode persists.
    await page.reload();
    await expect(
      page.getByRole("heading", { name: /wan monitor/i })
    ).toBeVisible({ timeout: 10000 });
    await expect(page.locator("body")).toHaveClass(/chakra-ui-dark/);
    expect(await readStoredMode(page)).toBe("dark");

    // Toggle back to light mode -> UI updates.
    await themeToggle.click();
    await expect(page.locator("body")).toHaveClass(/chakra-ui-light/);
    await expect.poll(() => readStoredMode(page)).toBe("light");

    // Reload -> light mode persists.
    await page.reload();
    await expect(
      page.getByRole("heading", { name: /wan monitor/i })
    ).toBeVisible({ timeout: 10000 });
    await expect(page.locator("body")).toHaveClass(/chakra-ui-light/);
    expect(await readStoredMode(page)).toBe("light");
  });
});
