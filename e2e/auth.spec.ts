import { expect, type Page, test } from "@playwright/test";

// The shared E2E backend runs with auth disabled (WAN_MONITOR_PASSWORD="") so
// the dashboard specs can render without a login. To exercise the auth flow we
// mock the four /api/auth/* endpoints at the browser level, simulating a server
// where WAN_MONITOR_PASSWORD is set. Data endpoints still hit the real seeded
// server, so the dashboard renders normally once authenticated.

const VALID_USERNAME = "admin";
const VALID_PASSWORD = "test-password";
const FAKE_TOKEN = "e2e-fake-jwt-token";

async function mockAuthEnabled(page: Page): Promise<void> {
  await page.route("**/api/auth/status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ authRequired: true }),
    })
  );

  await page.route("**/api/auth/login", async (route) => {
    const body = route.request().postDataJSON() as {
      username?: string;
      password?: string;
    };

    if (
      body?.username === VALID_USERNAME &&
      body?.password === VALID_PASSWORD
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          token: FAKE_TOKEN,
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          username: VALID_USERNAME,
        }),
      });
      return;
    }

    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify("Invalid username or password"),
    });
  });

  await page.route("**/api/auth/me", async (route) => {
    const authHeader = route.request().headers().authorization;

    if (authHeader === `Bearer ${FAKE_TOKEN}`) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          username: VALID_USERNAME,
          authenticated: true,
        }),
      });
      return;
    }

    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify("Unauthorized"),
    });
  });

  await page.route("**/api/auth/logout", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        message: "Logged out successfully",
      }),
    })
  );
}

async function login(
  page: Page,
  username: string,
  password: string
): Promise<void> {
  await page.getByPlaceholder("Enter username").fill(username);
  await page.getByPlaceholder("Enter password").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
}

test.describe("Authentication flow (auth enabled)", () => {
  test.beforeEach(async ({ page }) => {
    // Routes must be registered before the app boots so the initial auth check
    // (fired on mount) hits the mocks.
    await mockAuthEnabled(page);
  });

  test("redirects to the login page when there is no session", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(
      page.getByText("Sign in to access the dashboard")
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();

    // The dashboard must not be reachable without authenticating.
    await expect(page.getByRole("button", { name: "Logout" })).toHaveCount(0);
  });

  test("shows an error message for invalid credentials", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();

    await login(page, VALID_USERNAME, "wrong-password");

    await expect(page.getByRole("alert")).toBeVisible();

    // We stay on the login page and never reach the dashboard.
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Logout" })).toHaveCount(0);
  });

  test("logs in with valid credentials and shows the dashboard", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();

    await login(page, VALID_USERNAME, VALID_PASSWORD);

    // Dashboard renders and the login form is gone.
    await expect(
      page.getByRole("heading", { name: /wan monitor/i })
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole("button", { name: "Refresh now" })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign In" })).toHaveCount(0);

    // The logout control surfaces the authenticated username in its label.
    const logoutButton = page.getByRole("button", { name: "Logout" });
    await expect(logoutButton).toBeVisible();
    await logoutButton.hover();
    await expect(page.getByText(`Logout (${VALID_USERNAME})`)).toBeVisible();
  });

  test("logs out and returns to the login page", async ({ page }) => {
    await page.goto("/");
    await login(page, VALID_USERNAME, VALID_PASSWORD);

    const logoutButton = page.getByRole("button", { name: "Logout" });
    await expect(logoutButton).toBeVisible({ timeout: 10_000 });

    await logoutButton.click();

    await expect(
      page.getByText("Sign in to access the dashboard")
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Logout" })).toHaveCount(0);
  });

  test("restores the authenticated session on reload", async ({ page }) => {
    await page.goto("/");
    await login(page, VALID_USERNAME, VALID_PASSWORD);
    await expect(page.getByRole("button", { name: "Logout" })).toBeVisible({
      timeout: 10_000,
    });

    // On reload the app re-checks status, finds the stored token, and verifies
    // it via /api/auth/me before restoring the dashboard.
    await page.reload();

    await expect(page.getByRole("button", { name: "Logout" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("button", { name: "Sign In" })).toHaveCount(0);
  });
});
