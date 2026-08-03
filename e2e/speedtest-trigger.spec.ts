import { expect, type Page, test } from "@playwright/test";

/**
 * The "Run Speed Test" button in the Speed Test History card, end to end.
 *
 * `POST /api/speedtest/trigger` is always stubbed with `page.route`: the real
 * endpoint runs an actual speedtest against the internet, which is slow and
 * non-deterministic. Stubbing also lets us hold the response open to observe
 * the pending "Running…" state, which is otherwise a race.
 *
 * The trigger endpoint answers 200 with a `success` discriminant rather than an
 * HTTP error status, so the "already running" case is a 200 body carrying
 * `SPEED_TEST_ALREADY_RUNNING` (see `SpeedTestResponse` in
 * `packages/shared/src/api/routes/speedtest.ts`). A non-2xx status is a
 * separate, generic failure path, covered by the last test here.
 */

const TRIGGER_ROUTE = "**/api/speedtest/trigger";
const METRICS_PATH = "/api/metrics";

const triggerButton = (page: Page) =>
  page.getByRole("button", { name: /^(Run Speed Test|Running…)$/ });

const successBody = JSON.stringify({
  success: true,
  timestamp: new Date().toISOString(),
  result: { downloadMbps: 512.5, uploadMbps: 42.5, pingMs: 8 },
});

const alreadyRunningBody = JSON.stringify({
  success: false,
  timestamp: new Date().toISOString(),
  error: {
    code: "SPEED_TEST_ALREADY_RUNNING",
    message: "A speed test is already running",
  },
});

/** Load the dashboard and wait for it to settle into an interactive state. */
const openDashboard = async (page: Page): Promise<void> => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "WAN Monitor" })).toBeVisible({
    timeout: 10_000,
  });
  await expect(triggerButton(page)).toBeEnabled();
};

test.describe("Speed test trigger", () => {
  test("shows a disabled Running… state while the trigger is in flight, then a success toast", async ({
    page,
  }) => {
    const triggerRequests: string[] = [];
    // Gates the stubbed response so the in-flight UI state is observable
    // instead of resolving before the first assertion can run.
    let releaseResponse!: () => void;
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });

    await page.route(TRIGGER_ROUTE, async (route) => {
      triggerRequests.push(route.request().method());
      await responseGate;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: successBody,
      });
    });

    const metricsRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes(METRICS_PATH)) {
        metricsRequests.push(request.url());
      }
    });

    await openDashboard(page);
    // Let the initial load settle so the refetch assertion below can't be
    // satisfied by a still-in-flight startup request.
    await page.waitForLoadState("networkidle");
    const metricsBeforeTrigger = metricsRequests.length;

    await triggerButton(page).click();

    // The POST actually left the browser.
    await expect
      .poll(() => triggerRequests, { timeout: 10_000 })
      .toEqual(["POST"]);

    // While pending, the button relabels and blocks a second submission.
    await expect(triggerButton(page)).toHaveText("Running…");
    await expect(triggerButton(page)).toBeDisabled();

    releaseResponse();

    // A success toast reports the result and the button becomes usable again.
    await expect(page.getByText("Speed test complete")).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByText("Download: 512.5 Mbps, Upload: 42.5 Mbps")
    ).toBeVisible();
    await expect(triggerButton(page)).toHaveText("Run Speed Test");
    await expect(triggerButton(page)).toBeEnabled();

    // A successful trigger refetches metrics so the new sample shows up.
    await expect
      .poll(() => metricsRequests.length, { timeout: 10_000 })
      .toBeGreaterThan(metricsBeforeTrigger);
  });

  test("shows a warning toast and does not refetch when a speed test is already running", async ({
    page,
  }) => {
    await page.route(TRIGGER_ROUTE, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: alreadyRunningBody,
      })
    );

    const metricsRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes(METRICS_PATH)) {
        metricsRequests.push(request.url());
      }
    });

    await openDashboard(page);
    await page.waitForLoadState("networkidle");
    const metricsBeforeTrigger = metricsRequests.length;

    await triggerButton(page).click();

    // The rejection surfaces as a toast carrying the server's message.
    await expect(page.getByText("Speed test in progress")).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByText("A speed test is already running")
    ).toBeVisible();

    // The button recovers so the user can retry.
    await expect(triggerButton(page)).toHaveText("Run Speed Test");
    await expect(triggerButton(page)).toBeEnabled();

    // No new sample exists, so a failed trigger must not refetch. Auto-refresh
    // ticks every 30s, well past this assertion's window.
    expect(metricsRequests.length).toBe(metricsBeforeTrigger);
  });

  test("shows an error toast when the trigger request fails", async ({
    page,
  }) => {
    await page.route(TRIGGER_ROUTE, (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify("Internal error"),
      })
    );

    await openDashboard(page);
    await triggerButton(page).click();

    await expect(page.getByText("Speed test failed")).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByText("Something went wrong running the speed test.")
    ).toBeVisible();
    await expect(triggerButton(page)).toBeEnabled();
  });
});
