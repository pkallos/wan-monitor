import { expect, type Page, type Route, test } from "@playwright/test";

// The shared E2E backend runs with auth disabled (WAN_MONITOR_PASSWORD="") so
// the dashboard specs can render without a login. To exercise the auth flow we
// mock the four /api/auth/* endpoints at the browser level, simulating a server
// where WAN_MONITOR_PASSWORD is set. Data endpoints still hit the real seeded
// server, so the dashboard renders normally once authenticated.

const VALID_USERNAME = "admin";
const VALID_PASSWORD = "test-password";
const FAKE_TOKEN = "e2e-fake-jwt-token";

// Proxy-generated error pages: bodies the API client can't decode.
const PROXY_RESPONSES = [
  { name: "503 with an empty body", status: 503 },
  {
    name: "503 text/html",
    status: 503,
    contentType: "text/html",
    body: "<html><body>no available server</body></html>",
  },
  {
    name: "503 text/plain",
    status: 503,
    contentType: "text/plain",
    body: "no available server",
  },
  {
    name: "401 text/html",
    status: 401,
    contentType: "text/html",
    body: "<html><body>unauthorized</body></html>",
  },
  {
    name: "400 text/html",
    status: 400,
    contentType: "text/html",
    body: "<html><body>bad request</body></html>",
  },
] as const;

const fulfillProxyResponse = (
  route: Route,
  response: { status: number; contentType?: string; body?: string }
) =>
  route.fulfill({
    status: response.status,
    contentType: response.contentType,
    body: response.body,
  });

const openMenu = (page: Page) =>
  page.getByRole("button", { name: "Menu" }).click();

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
      body: JSON.stringify({ _tag: "Unauthorized", message: "Invalid token" }),
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
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
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

    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

    // The dashboard must not be reachable without authenticating.
    await expect(page.getByRole("button", { name: "Menu" })).toHaveCount(0);
  });

  test("shows an error message for invalid credentials", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

    await login(page, VALID_USERNAME, "wrong-password");

    await expect(page.getByRole("alert")).toBeVisible();

    // We stay on the login page and never reach the dashboard.
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Menu" })).toHaveCount(0);
  });

  test("logs in with valid credentials and shows the dashboard", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

    await login(page, VALID_USERNAME, VALID_PASSWORD);

    // Dashboard renders and the login form is gone.
    await expect(
      page.getByRole("heading", { name: "WAN Monitor" })
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole("button", { name: "Refresh now" })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toHaveCount(0);

    // The Log out item in the overflow menu carries the authenticated username.
    await openMenu(page);
    await expect(
      page.getByRole("menuitem", { name: `Log out (${VALID_USERNAME})` })
    ).toBeVisible();
  });

  test("logs out and returns to the login page", async ({ page }) => {
    await page.goto("/");
    await login(page, VALID_USERNAME, VALID_PASSWORD);

    await expect(page.getByRole("button", { name: "Menu" })).toBeVisible({
      timeout: 10_000,
    });
    await openMenu(page);
    await page
      .getByRole("menuitem", { name: `Log out (${VALID_USERNAME})` })
      .click();

    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Menu" })).toHaveCount(0);
  });

  test("restores the authenticated session on reload", async ({ page }) => {
    await page.goto("/");
    await login(page, VALID_USERNAME, VALID_PASSWORD);
    await expect(page.getByRole("button", { name: "Menu" })).toBeVisible({
      timeout: 10_000,
    });

    // On reload the app re-checks status, finds the stored token, and verifies
    // it via /api/auth/me before restoring the dashboard.
    await page.reload();

    await expect(page.getByRole("button", { name: "Menu" })).toBeVisible({
      timeout: 10_000,
    });
    await openMenu(page);
    await expect(
      page.getByRole("menuitem", { name: `Log out (${VALID_USERNAME})` })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toHaveCount(0);
  });
});

test.describe("Authentication flow (the server's answer cannot be read)", () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthEnabled(page);
  });

  for (const response of PROXY_RESPONSES) {
    test(`keeps the form and says sign-in failed on a ${response.name} login response`, async ({
      page,
    }) => {
      await page.route("**/api/auth/login", (route) =>
        fulfillProxyResponse(route, response)
      );
      await page.goto("/");
      await login(page, VALID_USERNAME, VALID_PASSWORD);

      await expect(page.getByRole("alert")).toHaveText("Sign-in failed.");
      await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
      await expect(
        page.getByText(/Foldkit encountered an unrecoverable error/)
      ).toBeHidden();
    });
  }

  for (const response of PROXY_RESPONSES) {
    test(`says the server cannot be reached and keeps the stored token on a ${response.name} token check`, async ({
      page,
    }) => {
      await page.addInitScript((token) => {
        localStorage.setItem("wan_monitor_token", token);
      }, FAKE_TOKEN);
      await page.route("**/api/auth/me", (route) =>
        fulfillProxyResponse(route, response)
      );
      await page.goto("/");

      await expect(page.getByRole("alert")).toHaveText(
        "Cannot reach the server."
      );
      await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
      await expect(
        page.getByText(/Foldkit encountered an unrecoverable error/)
      ).toBeHidden();
      expect(
        await page.evaluate(() => localStorage.getItem("wan_monitor_token"))
      ).toBe(FAKE_TOKEN);
    });
  }
});
