import type { Page } from "@playwright/test";

/**
 * Stubs every dashboard data endpoint at the network boundary with the bodies
 * the server returns for an empty table (see `getConnectivityStatusHandler`:
 * zero rows yields `data: []` with `uptimePercentage` and
 * `availabilityPercentage` null and zero coverage). Nothing reaches the shared
 * database, so a spec using it stays correct at any worker count, and the live
 * monitor's own ping rows cannot drift into the window mid-assertion.
 *
 * Keep the stubbed meta in sync with `ConnectivityStatusMeta`; a missing field
 * fails decoding and the dashboard renders the error branch instead of the
 * empty state.
 */

const fulfillJson = (body: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify(body),
});

const emptyRange = {
  latencyP50: null,
  latencyP95: null,
  avgPacketLoss: null,
  avgJitter: null,
  uptimePercentage: null,
  availabilityPercentage: null,
  coveragePercentage: 0,
};

const emptyWindow = { uptimePercentage: null };

export type EmptyApiOptions = Readonly<{
  /** What `/api/metrics/earliest` reports: null for a database that never held a sample. */
  earliestTimestamp?: string | null;
}>;

export const stubEmptyApi = async (
  page: Page,
  { earliestTimestamp = null }: EmptyApiOptions = {}
): Promise<void> => {
  const emptyMeta = {
    startTime: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    endTime: new Date().toISOString(),
    count: 0,
  };

  // A glob's `*` never crosses a `/`, so this has to be routed separately
  // from `**/api/metrics*` below or it falls through to the real seed.
  await page.route("**/api/metrics/earliest*", (route) =>
    route.fulfill(fulfillJson({ timestamp: earliestTimestamp }))
  );
  await page.route("**/api/metrics*", (route) =>
    route.fulfill(fulfillJson({ data: [], meta: emptyMeta }))
  );
  await page.route("**/api/speedtest/history*", (route) =>
    route.fulfill(fulfillJson({ data: [], meta: emptyMeta }))
  );
  // Same glob caveat as `/api/metrics/earliest` above: `*` never crosses a
  // `/`, so the live endpoint needs its own route or it falls through.
  await page.route("**/api/connectivity-status/live*", (route) =>
    route.fulfill(
      fulfillJson({ status: "noInfo", lastSampleAt: null, windowSeconds: 60 })
    )
  );
  // `*` never crosses a `/`, so the summary and outage paths are routed on
  // their own; the stubs hold the summary-backed cards empty like the rest.
  await page.route("**/api/summary*", (route) =>
    route.fulfill(
      fulfillJson({
        range: emptyRange,
        previous: emptyRange,
        windows: {
          last24h: emptyWindow,
          last7d: emptyWindow,
          last30d: emptyWindow,
        },
        hosts: [],
        speed: {
          downloadMedian: null,
          uploadMedian: null,
          count: 0,
        },
        meta: {
          startTime: emptyMeta.startTime,
          endTime: emptyMeta.endTime,
        },
      })
    )
  );
  // Host configuration, not database state, but stubbed so that no data
  // endpoint reaches the real backend.
  await page.route("**/api/ping/hosts*", (route) =>
    route.fulfill(
      fulfillJson({
        hosts: ["8.8.8.8", "1.1.1.1"],
        pingIntervalSeconds: 30,
        speedtestIntervalSeconds: 3600,
      })
    )
  );
  await page.route("**/api/connectivity-status/outages*", (route) =>
    route.fulfill(
      fulfillJson({
        data: [],
        meta: { ...emptyMeta, totalCount: 0 },
      })
    )
  );
  await page.route("**/api/connectivity-status*", (route) =>
    route.fulfill(
      fulfillJson({
        data: [],
        meta: {
          ...emptyMeta,
          uptimePercentage: null,
          availabilityPercentage: null,
          expectedBuckets: 288,
          observedBuckets: 0,
          coveragePercentage: 0,
          observedCycles: 0,
          expectedSampleIntervalSeconds: 30,
        },
      })
    )
  );
};
