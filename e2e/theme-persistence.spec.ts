import { expect, type Page, test } from "@playwright/test";

// The dashboard stores the active theme here; it is the source of truth for
// persistence and is re-read (via a LoadTheme Command) on every page load.
const STORAGE_KEY = "wan_monitor_theme";

const readStoredTheme = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);

const dashboardRoot = (page: Page) => page.getByTestId("dashboard-root");

// Matches only a standalone "dark" class token, not the always-present
// `dark:bg-*`/`dark:text-*` Tailwind variant prefixes.
const DARK_CLASS = /(?:^|\s)dark(?:\s|$)/;

test.describe("Theme persistence", () => {
  // Pin the emulated OS preference to light so "default theme" is deterministic
  // regardless of the machine/CI runner running the suite.
  test.use({ colorScheme: "light" });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "WAN Monitor" })
    ).toBeVisible({ timeout: 10000 });
  });

  test("persists the selected theme across page reloads", async ({ page }) => {
    const themeToggle = page.getByRole("button", {
      name: /^(Dark mode|Light mode)$/,
    });

    // Default theme follows the (pinned light) OS preference. The button is
    // icon-only, so its name lives in the accessible name, not visible text.
    await expect(themeToggle).toHaveAccessibleName("Dark mode");
    await expect(dashboardRoot(page)).not.toHaveClass(DARK_CLASS);
    await expect.poll(() => readStoredTheme(page)).not.toBe("dark");

    // Toggle to dark mode -> UI updates.
    await themeToggle.click();
    await expect(themeToggle).toHaveAccessibleName("Light mode");
    await expect(dashboardRoot(page)).toHaveClass(DARK_CLASS);
    await expect.poll(() => readStoredTheme(page)).toBe("dark");

    // Reload -> dark mode persists.
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "WAN Monitor" })
    ).toBeVisible({ timeout: 10000 });
    await expect(dashboardRoot(page)).toHaveClass(DARK_CLASS);
    expect(await readStoredTheme(page)).toBe("dark");

    // Toggle back to light mode -> UI updates.
    await page
      .getByRole("button", { name: /^(Dark mode|Light mode)$/ })
      .click();
    await expect(dashboardRoot(page)).not.toHaveClass(DARK_CLASS);
    await expect.poll(() => readStoredTheme(page)).toBe("light");

    // Reload -> light mode persists.
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "WAN Monitor" })
    ).toBeVisible({ timeout: 10000 });
    await expect(dashboardRoot(page)).not.toHaveClass(DARK_CLASS);
    expect(await readStoredTheme(page)).toBe("light");
  });
});
