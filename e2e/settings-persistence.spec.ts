import { expect, type Page, test } from "@playwright/test";

// Theme, date range, and pause all live in this one blob; it is the source
// of truth for persistence and is re-read (via Flags) on every page load.
const STORAGE_KEY = "wan_monitor_settings";

const readStoredSettings = (page: Page) =>
  page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  }, STORAGE_KEY);

const html = (page: Page) => page.locator("html");

const chooseTheme = async (page: Page, name: "Light" | "Dark" | "System") => {
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("menuitem", { name }).click();
};

// Matches only a standalone "dark" class token on `<html>`.
const DARK_CLASS = /(?:^|\s)dark(?:\s|$)/;

test.describe("Settings persistence", () => {
  // Pin the emulated OS preference to light so "default theme" is deterministic
  // regardless of the machine/CI runner running the suite.
  test.use({ colorScheme: "light" });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "WAN Monitor" })
    ).toBeVisible({ timeout: 10000 });
  });

  test("persists the selected theme across page reloads, and light mode actually repaints", async ({
    page,
  }) => {
    // Default theme is "system", which follows the (pinned light) OS
    // preference, so nothing has been stored yet.
    await expect(html(page)).not.toHaveClass(DARK_CLASS);
    await expect
      .poll(async () => (await readStoredSettings(page))?.theme)
      .not.toBe("dark");

    // Choose dark mode -> the whole page (not just the dashboard's root div)
    // goes dark, since `<html>` is the class's one owner.
    await chooseTheme(page, "Dark");
    await expect(html(page)).toHaveClass(DARK_CLASS);
    await expect
      .poll(async () => (await readStoredSettings(page))?.theme)
      .toBe("dark");

    // Reload -> dark mode persists, and the boot script paints it before the
    // app even loads.
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "WAN Monitor" })
    ).toBeVisible({ timeout: 10000 });
    await expect(html(page)).toHaveClass(DARK_CLASS);
    expect((await readStoredSettings(page)).theme).toBe("dark");

    // Switch back to light within the same session. Assert an actual painted
    // color, not just the class: `<html>` is the class's one owner, so this
    // is the check that would catch it silently staying stuck on `<html>`.
    const heading = page.getByRole("heading", { name: "WAN Monitor" });
    const darkColor = await heading.evaluate(
      (el) => getComputedStyle(el).color
    );

    await chooseTheme(page, "Light");
    await expect(html(page)).not.toHaveClass(DARK_CLASS);
    await expect
      .poll(async () => (await readStoredSettings(page))?.theme)
      .toBe("light");
    await expect
      .poll(() => heading.evaluate((el) => getComputedStyle(el).color))
      .not.toBe(darkColor);

    // Reload -> light mode persists.
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "WAN Monitor" })
    ).toBeVisible({ timeout: 10000 });
    await expect(html(page)).not.toHaveClass(DARK_CLASS);
    expect((await readStoredSettings(page)).theme).toBe("light");
  });

  test("the menu marks the active theme and System follows the OS live", async ({
    page,
  }) => {
    await chooseTheme(page, "Light");
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(
      page.getByRole("menuitem", { name: "Light (selected)" })
    ).toBeVisible();
    await page.keyboard.press("Escape");

    await chooseTheme(page, "System");
    await expect
      .poll(async () => (await readStoredSettings(page))?.theme)
      .toBe("system");
    await expect(html(page)).not.toHaveClass(DARK_CLASS);

    // No reload: the OS flips and the page follows.
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(html(page)).toHaveClass(DARK_CLASS);
    await page.emulateMedia({ colorScheme: "light" });
    await expect(html(page)).not.toHaveClass(DARK_CLASS);

    // An explicit choice ignores the OS.
    await chooseTheme(page, "Light");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(html(page)).not.toHaveClass(DARK_CLASS);
  });

  test("persists the selected date range across page reloads", async ({
    page,
  }) => {
    const trigger = page.locator("#date-range-picker-button");
    const initialLabel = await trigger.textContent();

    await trigger.click();
    await page.getByRole("button", { name: "Last 7 days" }).click();
    await page.getByRole("button", { name: "Apply" }).click();

    await expect.poll(() => trigger.textContent()).not.toBe(initialLabel);
    await expect
      .poll(async () => (await readStoredSettings(page))?.dateRange)
      .toEqual({ _tag: "Preset", preset: "last7d" });

    const appliedLabel = await trigger.textContent();

    await page.reload();
    await expect(
      page.getByRole("heading", { name: "WAN Monitor" })
    ).toBeVisible({ timeout: 10000 });
    await expect(trigger).toHaveText(appliedLabel ?? "");
    expect((await readStoredSettings(page)).dateRange).toEqual({
      _tag: "Preset",
      preset: "last7d",
    });
  });

  test("persists auto-refresh pause across page reloads", async ({ page }) => {
    const pauseButton = page.getByRole("button", {
      name: "Pause auto-refresh",
    });
    await pauseButton.click();

    const resumeButton = page.getByRole("button", {
      name: "Resume auto-refresh",
    });
    await expect(resumeButton).toBeVisible();
    await expect
      .poll(async () => (await readStoredSettings(page))?.isPaused)
      .toBe(true);

    await page.reload();
    await expect(
      page.getByRole("heading", { name: "WAN Monitor" })
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByRole("button", { name: "Resume auto-refresh" })
    ).toBeVisible();
    expect((await readStoredSettings(page)).isPaused).toBe(true);
  });
});

test.describe("Settings persistence — first visit follows the OS theme", () => {
  // Unlike the suite above, this pins the emulated OS preference to dark on
  // purpose: `defaultSettings()` (the app's hydrated default) has to agree
  // with `index.html`'s boot-script fallback, or a fresh dark-OS visit paints
  // dark and then repaints light once the app hydrates a mismatched default.
  test.use({ colorScheme: "dark" });

  test("a fresh visit with no stored settings stays dark after hydration", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "WAN Monitor" })
    ).toBeVisible({ timeout: 10000 });

    // The boot script paints this before any module loads; the assertion
    // that matters is that it's still true once the app has taken over —
    // otherwise the hydrated default silently overrode the OS preference.
    await expect(html(page)).toHaveClass(DARK_CLASS);

    // "System" is the stored default, so the menu shows it as the active one.
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(
      page.getByRole("menuitem", { name: "System (selected)" })
    ).toBeVisible();
  });
});
