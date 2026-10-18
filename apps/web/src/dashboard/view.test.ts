import { Menu, Popover, RadioGroup } from "@foldkit/ui";
import { Option } from "effect";
import { Scene } from "foldkit";
import { describe, test, vi } from "vitest";
import {
  JITTER_CHART_HOST_ID,
  LATENCY_CHART_HOST_ID,
  MountJitterChart,
  MountLatencyChart,
  MountPacketLossChart,
  MountSpeedChart,
  PACKET_LOSS_CHART_HOST_ID,
  SPEED_CHART_HOST_ID,
  SyncJitterChart,
  SyncLatencyChart,
  SyncPacketLossChart,
  SyncSpeedChart,
} from "@/dashboard/charts/command";
import {
  ApplyTheme,
  FetchConnectivityStatus,
  FetchEarliestData,
  FetchHostLatency,
  FetchLiveConnectivity,
  FetchMetrics,
  FetchOutages,
  FetchPingHosts,
  FetchSpeedtestHistory,
  FetchSummary,
  SaveSettings,
} from "@/dashboard/command";
import {
  Custom,
  formatDateRangeLabel,
  getDateRangeWindow,
  Preset,
} from "@/dashboard/dateRange";
import { formatClock, formatDateTime } from "@/dashboard/format";
import type { Message, OutMessage } from "@/dashboard/message";
import {
  CompletedApplyTheme,
  CompletedSaveSettings,
  CompletedSyncJitterChart,
  CompletedSyncLatencyChart,
  CompletedSyncPacketLossChart,
  CompletedSyncSpeedChart,
  FailedFetchConnectivityStatus,
  FailedFetchHostLatency,
  FailedFetchLiveConnectivity,
  FailedFetchOutages,
  FailedFetchPingHosts,
  FailedFetchSummary,
  MeasuredRibbon,
  SucceededFetchConnectivityStatus,
  SucceededFetchEarliestData,
  SucceededFetchLiveConnectivity,
  SucceededFetchMetrics,
  SucceededFetchSpeedtestHistory,
  SucceededMountJitterChart,
  SucceededMountLatencyChart,
  SucceededMountPacketLossChart,
  SucceededMountSpeedChart,
  TickedClock,
  TickedRefresh,
} from "@/dashboard/message";
import {
  ConnectivityStatusAsyncData,
  HostLatencyAsyncData,
  LiveConnectivityAsyncData,
  MetricsAsyncData,
  type Model,
  OutagesAsyncData,
  PingHostsAsyncData,
  initModel as realInitModel,
  SpeedtestHistoryAsyncData,
  SpeedtestTriggerAsyncData,
  SummaryAsyncData,
} from "@/dashboard/model";
import { DEFAULT_RIBBON_WIDTH_PX } from "@/dashboard/ribbon";
import { MeasureRibbon } from "@/dashboard/ribbonMeasure";
import {
  DEFAULT_REQUEST,
  hostsResponse,
  loadedInsights,
  outageFixture,
  outagesData,
  outagesResponse,
  rangeSummary,
  summaryData,
  summaryResponse,
  withTimeZone,
} from "@/dashboard/testFixtures";
import { update } from "@/dashboard/update";
import { view as dashboardView } from "@/dashboard/view";
import { defaultSettings } from "@/storage";

const NOW_MS = Date.parse("2026-07-28T12:00:00.000Z");
const initModel = (settings: Parameters<typeof realInitModel>[0]) =>
  realInitModel(settings, NOW_MS);

const DEFAULT_DATE_RANGE = Preset({ preset: "last30d" });

// Each fetch resolves its window once and reports it back on the success
// message; these stand in for the 30-day default the dashboard opens with.
const METRICS_WINDOW = {
  startTimeMs: NOW_MS - 30 * 24 * 60 * 60 * 1000,
  endTimeMs: NOW_MS,
  granularity: "1h" as const,
};
const SPEEDTEST_WINDOW = {
  startTimeMs: METRICS_WINDOW.startTimeMs,
  endTimeMs: METRICS_WINDOW.endTimeMs,
};

const LOADED_WINDOWS = {
  maybeMetricsWindow: Option.some({
    ...METRICS_WINDOW,
    request: DEFAULT_REQUEST,
  }),
  maybeSpeedtestWindow: Option.some({
    ...SPEEDTEST_WINDOW,
    request: DEFAULT_REQUEST,
  }),
};

const context = { token: "abc123", now: () => NOW_MS };
const boundUpdate = (
  model: Parameters<typeof update>[0],
  message: Parameters<typeof update>[1]
) => update(model, message, context);

// The dashboard view takes viewInputs (the signed-in username, supplied by
// its auth parent in production); tests stand in "no session" for it.
const view = Scene.withViewInputs(dashboardView, {
  maybeUsername: Option.none(),
})();

// The ribbon, and so its measuring Mount, only renders once its data lands.
const resolveRibbonMeasure =
  (widthPx: number) =>
  (simulation: Scene.SceneSimulation<Model, Message, OutMessage>) =>
    simulation.mounts.some(({ name }) => name === MeasureRibbon.name)
      ? Scene.Mount.resolve(
          MeasureRibbon,
          MeasuredRibbon({ widthPx })
        )(simulation)
      : simulation;

const acknowledgeAllChartMounts =
  (ribbonWidthPx = DEFAULT_RIBBON_WIDTH_PX) =>
  (simulation: Scene.SceneSimulation<Model, Message, OutMessage>) =>
    resolveRibbonMeasure(ribbonWidthPx)(
      Scene.Mount.resolveAll(
        [
          MountLatencyChart,
          SucceededMountLatencyChart({ hostId: LATENCY_CHART_HOST_ID }),
        ],
        [
          MountPacketLossChart,
          SucceededMountPacketLossChart({ hostId: PACKET_LOSS_CHART_HOST_ID }),
        ],
        [
          MountJitterChart,
          SucceededMountJitterChart({ hostId: JITTER_CHART_HOST_ID }),
        ],
        [
          MountSpeedChart,
          SucceededMountSpeedChart({ hostId: SPEED_CHART_HOST_ID }),
        ]
      )(simulation)
    );

const liveConnectivity = (
  status: "up" | "degraded" | "down" | "noInfo",
  maybeLastSampleAtMs = Option.some(NOW_MS - 30_000)
) =>
  LiveConnectivityAsyncData.Success({
    data: { status, maybeLastSampleAtMs },
  });

// What Refresh now and Retry fetch beyond the range-scoped series: the host
// list, and the earliest datapoint while it is unknown.
const REFRESH_EXTRA_RESOLVERS = [
  [
    FetchEarliestData,
    SucceededFetchEarliestData({ earliestMs: Option.none() }),
  ],
] as const;

const ENTER_INSIGHT_RESOLVERS = [
  [
    FetchSummary,
    FailedFetchSummary({ error: "skip", request: DEFAULT_REQUEST }),
  ],
  [
    FetchOutages,
    FailedFetchOutages({ error: "skip", request: DEFAULT_REQUEST }),
  ],
  [FetchPingHosts, FailedFetchPingHosts({ error: "skip" })],
] as const;

const RANGE_INSIGHT_RESOLVERS = [
  [
    FetchSummary,
    FailedFetchSummary({ error: "skip", request: DEFAULT_REQUEST }),
  ],
  [
    FetchOutages,
    FailedFetchOutages({ error: "skip", request: DEFAULT_REQUEST }),
  ],
] as const;

const resolveMenuMounts = () => [
  Scene.Mount.resolveAll(
    [Menu.AnchorMenu, Menu.Message.CompletedAnchorMenu()],
    [Menu.PortalMenuBackdrop, Menu.Message.CompletedPortalMenuBackdrop()]
  ),
  Scene.Command.resolveAll([
    Menu.FocusItems,
    Menu.Message.CompletedFocusItems(),
  ]),
];

const resolveAllChartSyncs = () =>
  Scene.Command.resolveAll(
    [SyncLatencyChart, CompletedSyncLatencyChart()],
    [SyncPacketLossChart, CompletedSyncPacketLossChart()],
    [SyncJitterChart, CompletedSyncJitterChart()],
    [SyncSpeedChart, CompletedSyncSpeedChart()]
  );

describe("dashboard view", () => {
  test("shows skeletons in place of numbers and charts while data is idle", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(initModel(defaultSettings())),
      acknowledgeAllChartMounts(),
      Scene.expect(
        Scene.role("status", { name: "Loading latency p50" })
      ).toExist(),
      Scene.expect(
        Scene.role("status", { name: "Loading packet loss" })
      ).toExist(),
      Scene.expect(
        Scene.role("status", { name: "Loading latency chart" })
      ).toExist(),
      Scene.expect(
        Scene.role("status", { name: "Loading speed chart" })
      ).toExist(),
      Scene.expect(
        Scene.role("status", { name: "Loading availability" })
      ).toExist(),
      Scene.expect(Scene.text("Loading metrics…")).not.toExist()
    );
  });

  test("drops the skeletons once every series has settled", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given({
        ...initModel(defaultSettings()),
        ...loadedInsights(),
        ...LOADED_WINDOWS,
        metrics: MetricsAsyncData.Success({ data: [] }),
        speedtestHistory: SpeedtestHistoryAsyncData.Success({ data: [] }),
        connectivityStatus: ConnectivityStatusAsyncData.Success({
          data: {
            points: [],
            maybeUptimePercentage: Option.none(),
            maybeAvailabilityPercentage: Option.none(),
            coveragePercentage: 0,
            startTimeMs: 0,
            endTimeMs: 3_600_000,
            granularity: "1m" as const,
            request: DEFAULT_REQUEST,
          },
        }),
      }),
      acknowledgeAllChartMounts(),
      resolveAllChartSyncs(),
      Scene.expect(Scene.role("status", { name: /^Loading/ })).not.toExist()
    );
  });

  test("does not claim there are no speed tests until the history has loaded", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(initModel(defaultSettings())),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.text("No tests in this range.")).not.toExist()
    );
  });

  test("says no speed test has run once the history has loaded empty", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given({
        ...initModel(defaultSettings()),
        ...LOADED_WINDOWS,
        speedtestHistory: SpeedtestHistoryAsyncData.Success({ data: [] }),
      }),
      acknowledgeAllChartMounts(),
      resolveAllChartSyncs(),
      Scene.expect(Scene.text("No tests in this range.")).toExist()
    );
  });

  test("shows when the data was last updated, and a spinner while refreshing", () => {
    const model = {
      ...initModel(defaultSettings()),
      metrics: MetricsAsyncData.Refreshing({ data: [] }),
      maybeLastUpdatedMs: Option.some(Date.parse("2026-07-26T00:00:00.000Z")),
    };

    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(model),
      acknowledgeAllChartMounts(),
      resolveAllChartSyncs(),
      Scene.expect(Scene.testId("last-updated")).toContainText(/^Updated/),
      Scene.expect(Scene.role("status", { name: "Refreshing" })).toExist()
    );
  });

  test("shows the live status and the stat rail", () => {
    const model = {
      ...initModel(defaultSettings()),
      ...loadedInsights(),
      liveConnectivity: liveConnectivity("up"),
    };

    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(model),
      acknowledgeAllChartMounts(),
      resolveAllChartSyncs(),
      Scene.expect(Scene.testId("connection-status")).toContainText("Online"),
      Scene.expect(Scene.testId("rail-latency")).toExist(),
      Scene.expect(Scene.testId("rail-loss")).toExist(),
      Scene.expect(Scene.testId("rail-jitter")).toExist(),
      Scene.expect(Scene.testId("rail-download")).toContainText("941"),
      Scene.expect(Scene.testId("rail-upload")).toContainText("Mbps")
    );
  });

  test("falls back to the connectivity window's uptime until the summary lands", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given({
        ...initModel(defaultSettings()),
        connectivityStatus: ConnectivityStatusAsyncData.Success({
          data: {
            points: [],
            maybeUptimePercentage: Option.some(99.6),
            maybeAvailabilityPercentage: Option.some(99.9),
            coveragePercentage: 100,
            startTimeMs: 0,
            endTimeMs: 3_600_000,
            granularity: "1m" as const,
            request: DEFAULT_REQUEST,
          },
        }),
      }),
      acknowledgeAllChartMounts(),
      resolveAllChartSyncs(),
      Scene.expect(Scene.testId("uptime-figure")).toHaveText("99.60%"),
      Scene.expect(Scene.testId("uptime-label")).toHaveText(
        "uptime over the last 30 days"
      )
    );
  });

  test("says how long ago the last sample was taken", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given({
        ...initModel(defaultSettings()),
        liveConnectivity: liveConnectivity("up"),
      }),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.testId("last-sample")).toHaveText(
        "Last checked 30 seconds ago"
      )
    );
  });

  test.each([
    ["up", "Online"],
    ["degraded", "Degraded"],
    ["down", "Offline"],
    ["noInfo", "No data"],
  ] as const)("renders the %s live status as %s", (status, label) => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given({
        ...initModel(defaultSettings()),
        liveConnectivity: liveConnectivity(status),
      }),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.testId("connection-status")).toContainText(label)
    );
  });

  describe("announcing the live status", () => {
    const RUNNING = outageFixture({
      start: "2026-07-28T11:30:00.000Z",
      end: "2026-07-28T12:00:00.000Z",
      durationSeconds: 1800,
      status: "down",
    });

    test("puts the pill and the open incident in one polite status region", () => {
      Scene.scene(
        { update: boundUpdate, view },
        Scene.given({
          ...initModel(defaultSettings()),
          ...loadedInsights(),
          liveConnectivity: liveConnectivity("down"),
          outages: OutagesAsyncData.Success({
            data: outagesData(outagesResponse([RUNNING])),
          }),
        }),
        acknowledgeAllChartMounts(),
        resolveAllChartSyncs(),
        Scene.expect(Scene.testId("live-status")).toHaveAttr("role", "status"),
        Scene.inside(
          Scene.testId("live-status"),
          Scene.expect(Scene.testId("connection-status")).toContainText(
            "Offline"
          ),
          Scene.expect(Scene.testId("open-incident")).toExist()
        )
      );
    });

    test("keeps the region mounted while the status changes from Online to Offline", () => {
      Scene.scene(
        { update: boundUpdate, view },
        Scene.given({
          ...initModel(defaultSettings()),
          ...loadedInsights(),
          liveConnectivity: liveConnectivity("up"),
        }),
        acknowledgeAllChartMounts(),
        Scene.expect(Scene.testId("live-status")).toExist(),
        Scene.click(Scene.role("button", { name: "Refresh now" })),
        Scene.Command.resolveAll(
          ...ENTER_INSIGHT_RESOLVERS,
          ...REFRESH_EXTRA_RESOLVERS,
          [
            FetchMetrics,
            SucceededFetchMetrics({
              metrics: [],
              nowMs: NOW_MS,
              ...METRICS_WINDOW,
              request: DEFAULT_REQUEST,
            }),
          ],
          [
            FetchSpeedtestHistory,
            SucceededFetchSpeedtestHistory({
              history: [],
              ...SPEEDTEST_WINDOW,
              request: DEFAULT_REQUEST,
            }),
          ],
          [
            FetchConnectivityStatus,
            FailedFetchConnectivityStatus({
              error: "skip",
              request: DEFAULT_REQUEST,
            }),
          ],
          [
            FetchLiveConnectivity,
            SucceededFetchLiveConnectivity({
              status: "down",
              maybeLastSampleAtMs: Option.none(),
            }),
          ]
        ),
        resolveAllChartSyncs(),
        Scene.expect(Scene.testId("live-status")).toHaveAttr("role", "status"),
        Scene.inside(
          Scene.testId("live-status"),
          Scene.expect(Scene.testId("connection-status")).toContainText(
            "Offline"
          )
        )
      );
    });
  });

  describe("a live status the latest fetch could not confirm", () => {
    const staleStatus = (status: "up" | "degraded" | "down") =>
      LiveConnectivityAsyncData.Stale({
        error: "Request failed",
        data: { status, maybeLastSampleAtMs: Option.some(NOW_MS - 120_000) },
      });
    const RUNNING = outageFixture({
      start: "2026-07-28T11:30:00.000Z",
      end: "2026-07-28T12:00:00.000Z",
      durationSeconds: 1800,
      status: "down",
    });

    test("reads No data, not the status the failed fetch could not confirm", () => {
      Scene.scene(
        { update: boundUpdate, view },
        Scene.given({
          ...initModel(defaultSettings()),
          liveConnectivity: staleStatus("up"),
        }),
        acknowledgeAllChartMounts(),
        Scene.expect(Scene.testId("connection-status")).toHaveText("No data"),
        Scene.expect(Scene.testId("last-sample")).not.toExist()
      );
    });

    test("names no open incident from a status it could not confirm", () => {
      Scene.scene(
        { update: boundUpdate, view },
        Scene.given({
          ...initModel(defaultSettings()),
          ...loadedInsights(),
          liveConnectivity: staleStatus("down"),
          outages: OutagesAsyncData.Success({
            data: outagesData(outagesResponse([RUNNING])),
          }),
        }),
        acknowledgeAllChartMounts(),
        resolveAllChartSyncs(),
        Scene.expect(Scene.testId("open-incident")).not.toExist()
      );
    });

    test("keeps the known status while a refresh is in flight", () => {
      Scene.scene(
        { update: boundUpdate, view },
        Scene.given({
          ...initModel(defaultSettings()),
          liveConnectivity: LiveConnectivityAsyncData.Refreshing({
            data: { status: "up", maybeLastSampleAtMs: Option.none() },
          }),
        }),
        acknowledgeAllChartMounts(),
        Scene.expect(Scene.testId("connection-status")).toHaveText("Online")
      );
    });
  });

  test.each([
    ["up", "border-up"],
    ["degraded", "border-deg"],
    ["down", "border-down"],
    ["noInfo", "border-nodata"],
  ] as const)(
    "pairs the %s live status word with a glyph and the %s tone",
    (status, toneClass) => {
      Scene.scene(
        { update: boundUpdate, view },
        Scene.given({
          ...initModel(defaultSettings()),
          liveConnectivity: liveConnectivity(status),
        }),
        acknowledgeAllChartMounts(),
        Scene.expect(Scene.testId("connection-status")).toHaveClass(toneClass),
        Scene.expect(
          Scene.selector(
            '[data-testid="connection-status"] svg[aria-hidden="true"]'
          )
        ).toExist()
      );
    }
  );

  describe("open incident", () => {
    const RUNNING = outageFixture({
      start: "2026-07-28T11:30:00.000Z",
      end: "2026-07-28T12:00:00.000Z",
      durationSeconds: 1800,
      status: "degraded",
      affectedHosts: ["8.8.8.8"],
      maxPacketLoss: 30,
    });
    const withLog = (
      status: "up" | "degraded" | "down",
      outages: ReadonlyArray<ReturnType<typeof outageFixture>>
    ) => ({
      ...initModel(defaultSettings()),
      ...loadedInsights(),
      liveConnectivity: liveConnectivity(status),
      outages: OutagesAsyncData.Success({
        data: outagesData(outagesResponse(outages)),
      }),
    });

    test("names when it began, the failing hosts and the worst loss while the connection is degraded", () => {
      Scene.scene(
        { update: boundUpdate, view },
        Scene.given(withLog("degraded", [RUNNING])),
        acknowledgeAllChartMounts(),
        resolveAllChartSyncs(),
        Scene.expect(Scene.testId("open-incident")).toContainText(
          formatClock(Date.parse(RUNNING.start))
        ),
        Scene.expect(Scene.testId("open-incident")).toContainText(
          ", 8.8.8.8 has lost up to 30% of packets."
        )
      );
    });

    test("allows the newest cycle to be as late as two of the configured ping intervals", () => {
      const endedNineMinutesAgo = outageFixture({
        start: "2026-07-28T11:30:00.000Z",
        end: "2026-07-28T11:51:00.000Z",
        status: "down",
      });
      const slowMonitor = PingHostsAsyncData.Success({
        data: { ...hostsResponse(), pingIntervalSeconds: 300 },
      });

      Scene.scene(
        { update: boundUpdate, view },
        Scene.given({
          ...withLog("down", [endedNineMinutesAgo]),
          pingHosts: slowMonitor,
        }),
        acknowledgeAllChartMounts(),
        resolveAllChartSyncs(),
        Scene.expect(Scene.testId("open-incident")).toExist()
      );
      Scene.scene(
        { update: boundUpdate, view },
        Scene.given(withLog("down", [endedNineMinutesAgo])),
        acknowledgeAllChartMounts(),
        resolveAllChartSyncs(),
        Scene.expect(Scene.testId("open-incident")).not.toExist()
      );
    });

    test("is absent once the connection is back up", () => {
      Scene.scene(
        { update: boundUpdate, view },
        Scene.given(withLog("up", [RUNNING])),
        acknowledgeAllChartMounts(),
        resolveAllChartSyncs(),
        Scene.expect(Scene.testId("open-incident")).not.toExist()
      );
    });

    test("is absent when the newest incident has already ended", () => {
      Scene.scene(
        { update: boundUpdate, view },
        Scene.given(withLog("down", [outageFixture()])),
        acknowledgeAllChartMounts(),
        resolveAllChartSyncs(),
        Scene.expect(Scene.testId("open-incident")).not.toExist()
      );
    });
  });

  test("shows Checking… until the first live response lands", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given({
        ...initModel(defaultSettings()),
        liveConnectivity: LiveConnectivityAsyncData.Loading(),
      }),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.testId("connection-status")).toHaveText("Checking…")
    );
  });

  test("renders a failed live fetch as No data, never as an outage", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given({
        ...initModel(defaultSettings()),
        liveConnectivity: LiveConnectivityAsyncData.Failure({
          error: "network error",
        }),
      }),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.testId("connection-status")).toHaveText("No data"),
      Scene.expect(Scene.text("Offline")).not.toExist()
    );
  });

  test("keeps reading No data across refresh ticks while the live fetch keeps failing", () => {
    const failedLive = {
      ...initModel(defaultSettings()),
      liveConnectivity: LiveConnectivityAsyncData.Failure({
        error: "network error",
      }),
    };

    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(failedLive),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.testId("connection-status")).toHaveText("No data"),
      Scene.Subscription.emit(TickedRefresh()),
      Scene.expect(Scene.testId("connection-status")).toHaveText("No data"),
      Scene.Command.resolve(
        FetchLiveConnectivity,
        FailedFetchLiveConnectivity({ error: "network error" })
      ),
      Scene.expect(Scene.testId("connection-status")).toHaveText("No data"),
      Scene.Subscription.emit(TickedRefresh()),
      Scene.expect(Scene.testId("connection-status")).toHaveText("No data"),
      Scene.Command.resolve(
        FetchLiveConnectivity,
        FailedFetchLiveConnectivity({ error: "network error" })
      )
    );
  });

  test("keeps the stat rail's failure line while a refresh tick retries the summary", () => {
    const failedSummary = {
      ...initModel(defaultSettings()),
      summary: SummaryAsyncData.Failure({ error: "db down" }),
    };

    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(failedSummary),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.text("Could not load the range summary.")).toExist(),
      Scene.Subscription.emit(TickedRefresh()),
      Scene.expect(Scene.text("Could not load the range summary.")).toExist(),
      Scene.expect(
        Scene.role("status", { name: "Loading latency p50" })
      ).not.toExist(),
      Scene.Command.resolve(
        FetchSummary,
        FailedFetchSummary({ error: "db down", request: DEFAULT_REQUEST })
      ),
      Scene.expect(Scene.text("Could not load the range summary.")).toExist()
    );
  });

  test("says no samples yet only when the monitor reported none, not when the live fetch failed", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given({
        ...initModel(defaultSettings()),
        liveConnectivity: liveConnectivity("noInfo", Option.none()),
      }),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.testId("last-sample")).toHaveText("No samples yet")
    );
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given({
        ...initModel(defaultSettings()),
        liveConnectivity: LiveConnectivityAsyncData.Failure({
          error: "network error",
        }),
      }),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.testId("last-sample")).not.toExist(),
      Scene.expect(Scene.text("No samples yet")).not.toExist()
    );
  });

  // The metrics endpoint can return a speedtest row as the newest row in a
  // bucket, carrying no connectivity_status at all. The card must not care:
  // it reads the live endpoint, not model.metrics.
  test("ignores model.metrics entirely, even when its newest row is a speedtest", () => {
    const model = {
      ...initModel(defaultSettings()),
      metrics: MetricsAsyncData.Success({
        data: [
          {
            timestamp: "2026-07-28T11:59:59.000Z",
            source: "speedtest" as const,
            download_speed: 123.4,
          },
          {
            timestamp: "2026-07-28T11:59:58.000Z",
            source: "ping" as const,
            connectivity_status: "up",
          },
        ],
      }),
      liveConnectivity: liveConnectivity("up"),
    };

    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(model),
      acknowledgeAllChartMounts(),
      resolveAllChartSyncs(),
      Scene.expect(Scene.text("Online")).toExist(),
      Scene.expect(Scene.text("Offline")).not.toExist()
    );
  });

  test("shows the resolved ISP and external IP from the latest speed test", () => {
    const model = {
      ...initModel(defaultSettings()),
      speedtestHistory: SpeedtestHistoryAsyncData.Success({
        data: [
          {
            timestamp: "2026-07-26T00:01:00.000Z",
            download_speed: 100,
            upload_speed: 10,
            latency: 8,
            isp: "Comcast",
            external_ip: "1.2.3.4",
          },
        ],
      }),
    };

    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(model),
      acknowledgeAllChartMounts(),
      resolveAllChartSyncs(),
      Scene.expect(Scene.text("Comcast, public IP 1.2.3.4")).toExist()
    );
  });

  test("falls back to ISP unknown with no speed test data", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given({
        ...initModel(defaultSettings()),
        speedtestHistory: SpeedtestHistoryAsyncData.Success({ data: [] }),
      }),
      acknowledgeAllChartMounts(),
      resolveAllChartSyncs(),
      Scene.expect(Scene.text("ISP unknown")).toExist()
    );
  });

  test("shows an alert with the error when metrics fail", () => {
    const model = {
      ...initModel(defaultSettings()),
      metrics: MetricsAsyncData.Failure({ error: "network error" }),
    };

    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(model),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.role("alert")).toContainText("Metrics: network error")
    );
  });

  test("shows an alert with the error when speed test history fails", () => {
    const model = {
      ...initModel(defaultSettings()),
      speedtestHistory: SpeedtestHistoryAsyncData.Failure({
        error: "network error",
      }),
    };

    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(model),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.role("alert")).toContainText(
        "Speed tests: network error"
      )
    );
  });

  test("shows an alert with the error when connectivity status fails", () => {
    const model = {
      ...initModel(defaultSettings()),
      connectivityStatus: ConnectivityStatusAsyncData.Failure({
        error: "network error",
      }),
    };

    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(model),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.role("alert")).toContainText(
        "Availability: network error"
      )
    );
  });

  test("shows an alert with the error when the live status fails", () => {
    const model = {
      ...initModel(defaultSettings()),
      liveConnectivity: LiveConnectivityAsyncData.Failure({
        error: "network error",
      }),
    };

    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(model),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.role("alert")).toContainText(
        "Live status: network error"
      )
    );
  });

  test("shows an alert with the error when a metrics refresh fails but stale data still renders", () => {
    const model = {
      ...initModel(defaultSettings()),
      metrics: MetricsAsyncData.Stale({
        error: "network error",
        data: [
          { timestamp: "2026-07-26T00:00:00.000Z", source: "ping" as const },
        ],
      }),
    };

    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(model),
      acknowledgeAllChartMounts(),
      resolveAllChartSyncs(),
      Scene.expect(Scene.role("alert")).toContainText("Metrics: network error")
    );
  });

  test("shows an alert with the error when a speed test history refresh fails but stale data still renders", () => {
    const model = {
      ...initModel(defaultSettings()),
      speedtestHistory: SpeedtestHistoryAsyncData.Stale({
        error: "network error",
        data: [
          {
            timestamp: "2026-07-26T00:01:00.000Z",
            download_speed: 100,
            upload_speed: 10,
            latency: 8,
          },
        ],
      }),
    };

    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(model),
      acknowledgeAllChartMounts(),
      resolveAllChartSyncs(),
      Scene.expect(Scene.role("alert")).toContainText(
        "Speed tests: network error"
      )
    );
  });

  test("shows an alert with the error when a connectivity status refresh fails but stale data still renders", () => {
    const model = {
      ...initModel(defaultSettings()),
      connectivityStatus: ConnectivityStatusAsyncData.Stale({
        error: "network error",
        data: {
          points: [],
          maybeUptimePercentage: Option.some(100),
          maybeAvailabilityPercentage: Option.some(100),
          coveragePercentage: 100,
          startTimeMs: 0,
          endTimeMs: 3_600_000,
          granularity: "1m" as const,
          request: DEFAULT_REQUEST,
        },
      }),
    };

    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(model),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.testId("uptime-figure")).toContainText("100.00"),
      Scene.expect(Scene.role("alert")).toContainText(
        "Availability: network error"
      )
    );
  });

  test("draws a cell per bucket filled by its status, and hovering one shows its tooltip", () => {
    const startTimeMs = Date.parse("2026-07-26T10:00:00.000Z");
    const model = {
      ...initModel(defaultSettings()),
      connectivityStatus: ConnectivityStatusAsyncData.Success({
        data: {
          points: [
            {
              timestamp: "2026-07-26T10:00:00.000Z",
              status: "up" as const,
              upPercentage: 100,
              downPercentage: 0,
              degradedPercentage: 0,
            },
            {
              timestamp: "2026-07-26T10:05:00.000Z",
              status: "down" as const,
              upPercentage: 0,
              downPercentage: 80,
              degradedPercentage: 20,
            },
          ],
          maybeUptimePercentage: Option.some(50),
          maybeAvailabilityPercentage: Option.some(50),
          coveragePercentage: 100,
          startTimeMs,
          endTimeMs: startTimeMs + 10 * 60 * 1000,
          granularity: "5m" as const,
          request: DEFAULT_REQUEST,
        },
      }),
    };

    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(model),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.testId("connectivity-segment-0")).toHaveClass("bg-up"),
      Scene.expect(Scene.testId("connectivity-segment-1")).toHaveClass(
        "bg-down"
      ),
      Scene.expect(Scene.role("tooltip")).not.toExist(),
      Scene.hover(Scene.testId("connectivity-segment-1")),
      Scene.expect(Scene.role("tooltip")).toHaveText(/Down/)
    );
  });

  test("tapping a connectivity segment shows its tooltip, and tapping it again dismisses it", () => {
    const startTimeMs = Date.parse("2026-07-26T10:00:00.000Z");
    const model = {
      ...initModel(defaultSettings()),
      connectivityStatus: ConnectivityStatusAsyncData.Success({
        data: {
          points: [
            {
              timestamp: "2026-07-26T10:00:00.000Z",
              status: "up" as const,
              upPercentage: 100,
              downPercentage: 0,
              degradedPercentage: 0,
            },
            {
              timestamp: "2026-07-26T10:05:00.000Z",
              status: "down" as const,
              upPercentage: 0,
              downPercentage: 80,
              degradedPercentage: 20,
            },
          ],
          maybeUptimePercentage: Option.some(50),
          maybeAvailabilityPercentage: Option.some(50),
          coveragePercentage: 100,
          startTimeMs,
          endTimeMs: startTimeMs + 10 * 60 * 1000,
          granularity: "5m" as const,
          request: DEFAULT_REQUEST,
        },
      }),
    };

    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(model),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.role("tooltip")).not.toExist(),
      Scene.click(Scene.testId("connectivity-segment-1")),
      Scene.expect(Scene.role("tooltip")).toHaveText(/Down/),
      Scene.click(Scene.testId("connectivity-segment-1")),
      Scene.expect(Scene.role("tooltip")).not.toExist()
    );
  });

  test("shows a disabled Running… state while the speed test trigger is pending", () => {
    const model = {
      ...initModel(defaultSettings()),
      speedtestTrigger: SpeedtestTriggerAsyncData.Loading(),
    };

    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(model),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.role("button", { name: "Running…" })).toExist(),
      Scene.expect(Scene.role("button", { name: "Running…" })).toBeDisabled()
    );
  });

  test("renders a chart host for the latency chart and mounts it", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(initModel(defaultSettings())),
      Scene.expect(Scene.label("Latency chart")).toExist(),
      acknowledgeAllChartMounts()
    );
  });

  test("renders a chart host for the packet loss chart and mounts it", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(initModel(defaultSettings())),
      Scene.expect(Scene.label("Packet loss chart")).toExist(),
      acknowledgeAllChartMounts()
    );
  });

  test("renders a chart host for the jitter chart and mounts it", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(initModel(defaultSettings())),
      Scene.expect(Scene.label("Jitter chart")).toExist(),
      acknowledgeAllChartMounts()
    );
  });

  test("renders a chart host for the speed chart and mounts it", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(initModel(defaultSettings())),
      Scene.expect(Scene.label("Speed chart")).toExist(),
      acknowledgeAllChartMounts()
    );
  });

  describe("the charts as assistive technology reads them", () => {
    const point = (minute: number, fields: object) => ({
      timestamp: new Date(Date.UTC(2026, 6, 28, 10, minute)).toISOString(),
      source: "ping" as const,
      ...fields,
    });
    const loaded = (overrides: Partial<Model>): Model => ({
      ...initModel(defaultSettings()),
      ...loadedInsights(),
      ...LOADED_WINDOWS,
      ...overrides,
    });

    test("each canvas is an image named by what it plots, with its figures for the range", () => {
      const model = loaded({
        metrics: MetricsAsyncData.Success({
          data: [
            point(0, {
              latency: 30,
              latency_p50: 20,
              latency_p95: 80,
              packet_loss: 0,
              jitter: 1,
            }),
            point(5, {
              latency: 50,
              latency_p50: 40,
              latency_p95: 120,
              packet_loss: 1,
              jitter: 3,
            }),
          ],
        }),
        speedtestHistory: SpeedtestHistoryAsyncData.Success({
          data: [
            {
              timestamp: "2026-07-26T00:01:00.000Z",
              download_speed: 100,
              upload_speed: 20,
            },
            {
              timestamp: "2026-07-26T00:02:00.000Z",
              download_speed: 200,
              upload_speed: 40,
            },
          ],
        }),
      });

      Scene.scene(
        { update: boundUpdate, view },
        Scene.given(model),
        acknowledgeAllChartMounts(),
        resolveAllChartSyncs(),
        Scene.expect(
          Scene.role("img", {
            name: "For the last 30 days. Bucket median latency averages 30.0 ms and the highest 95th percentile is 120.0 ms.",
          })
        ).toExist(),
        Scene.expect(
          Scene.role("img", {
            name: "For the last 30 days. Bucket packet loss averages 0.50% and is highest at 1.00%.",
          })
        ).toExist(),
        Scene.expect(
          Scene.role("img", {
            name: "For the last 30 days. Bucket jitter averages 2.00 ms and is highest at 3.00 ms.",
          })
        ).toExist(),
        Scene.expect(
          Scene.role("img", {
            name: "For the last 30 days. Download averages 150.0 Mbps and peaks at 200.0 Mbps. Upload averages 30.0 Mbps and peaks at 40.0 Mbps.",
          })
        ).toExist(),
        Scene.expectAll(Scene.all.testId("chart-notice")).toHaveCount(0)
      );
    });

    const noticeIn = (chart: string, text: string) =>
      Scene.inside(
        Scene.label(chart),
        Scene.expect(Scene.testId("chart-notice")).toContainText(text)
      );

    test("with nothing to plot, each chart says so in its name and over its plot", () => {
      const model = loaded({
        metrics: MetricsAsyncData.Success({ data: [] }),
        speedtestHistory: SpeedtestHistoryAsyncData.Success({ data: [] }),
      });

      Scene.scene(
        { update: boundUpdate, view },
        Scene.given(model),
        acknowledgeAllChartMounts(),
        resolveAllChartSyncs(),
        Scene.expect(
          Scene.role("img", {
            name: "For the last 30 days. No data in this range.",
          })
        ).toExist(),
        Scene.expect(
          Scene.role("img", {
            name: "For the last 30 days. No data in this range.",
          })
        ).toExist(),
        noticeIn("Latency chart", "No data in this range."),
        noticeIn("Packet loss chart", "No data in this range."),
        noticeIn("Jitter chart", "No data in this range."),
        noticeIn("Speed chart", "No data in this range.")
      );
    });

    test("one bucket is too little for the line and bar charts to draw", () => {
      const model = loaded({
        metrics: MetricsAsyncData.Success({
          data: [point(0, { latency: 30, packet_loss: 0, jitter: 1 })],
        }),
        speedtestHistory: SpeedtestHistoryAsyncData.Success({ data: [] }),
      });

      Scene.scene(
        { update: boundUpdate, view },
        Scene.given(model),
        acknowledgeAllChartMounts(),
        resolveAllChartSyncs(),
        noticeIn("Latency chart", "Not enough data to draw a line."),
        noticeIn("Packet loss chart", "Not enough data to draw a chart."),
        noticeIn("Jitter chart", "Not enough data to draw a line.")
      );
    });

    test("a failed load replaces the plot's axes with a message", () => {
      const model = loaded({
        metrics: MetricsAsyncData.Failure({ error: "db down" }),
        speedtestHistory: SpeedtestHistoryAsyncData.Failure({
          error: "db down",
        }),
      });

      Scene.scene(
        { update: boundUpdate, view },
        Scene.given(model),
        acknowledgeAllChartMounts(),
        noticeIn("Latency chart", "Could not load the chart."),
        noticeIn("Packet loss chart", "Could not load the chart."),
        noticeIn("Jitter chart", "Could not load the chart."),
        noticeIn("Speed chart", "Could not load the chart.")
      );
    });

    describe("with another range's data left in place", () => {
      const rows = [
        point(0, { latency: 30, packet_loss: 0, jitter: 1 }),
        point(5, { latency: 50, packet_loss: 1, jitter: 3 }),
      ];
      const tests = [
        {
          timestamp: "2026-07-26T00:01:00.000Z",
          download_speed: 100,
          upload_speed: 20,
        },
      ];
      const last24h = Preset({ preset: "last24h" });

      test("a failed fetch for the new range covers the charts instead of labelling the old figures", () => {
        const model = loaded({
          dateRange: last24h,
          metrics: MetricsAsyncData.Stale({ data: rows, error: "db down" }),
          speedtestHistory: SpeedtestHistoryAsyncData.Stale({
            data: tests,
            error: "db down",
          }),
        });

        Scene.scene(
          { update: boundUpdate, view },
          Scene.given(model),
          acknowledgeAllChartMounts(),
          resolveAllChartSyncs(),
          Scene.expect(
            Scene.role("img", {
              name: "For the last 24 hours. Could not load the chart.",
            })
          ).toExist(),
          noticeIn("Latency chart", "Could not load the chart."),
          noticeIn("Packet loss chart", "Could not load the chart."),
          noticeIn("Jitter chart", "Could not load the chart."),
          noticeIn("Speed chart", "Could not load the chart."),
          Scene.expect(Scene.text("Could not load speed tests.")).not.toExist(),
          Scene.expect(Scene.text(/100(\.0)? Mbps/)).not.toExist()
        );
      });

      test("a fetch still running for the new range puts the skeleton over the charts", () => {
        const model = loaded({
          dateRange: last24h,
          metrics: MetricsAsyncData.Refreshing({ data: rows }),
          speedtestHistory: SpeedtestHistoryAsyncData.Refreshing({
            data: tests,
          }),
        });

        Scene.scene(
          { update: boundUpdate, view },
          Scene.given(model),
          acknowledgeAllChartMounts(),
          resolveAllChartSyncs(),
          Scene.expect(
            Scene.role("img", { name: "For the last 24 hours. Loading." })
          ).toExist(),
          Scene.expect(
            Scene.role("status", { name: "Loading latency chart" })
          ).toExist(),
          Scene.expect(
            Scene.role("status", { name: "Loading packet loss chart" })
          ).toExist(),
          Scene.expect(
            Scene.role("status", { name: "Loading speed chart" })
          ).toExist(),
          Scene.expect(Scene.text(/100(\.0)? Mbps/)).not.toExist(),
          Scene.expectAll(Scene.all.testId("chart-notice")).toHaveCount(0)
        );
      });
    });

    test("no message is drawn over a chart while its first load is pending", () => {
      Scene.scene(
        { update: boundUpdate, view },
        Scene.given(initModel(defaultSettings())),
        acknowledgeAllChartMounts(),
        Scene.expectAll(Scene.all.testId("chart-notice")).toHaveCount(0)
      );
    });
  });

  test("shows average/max download and upload speed stats", () => {
    const model = {
      ...initModel(defaultSettings()),
      ...LOADED_WINDOWS,
      speedtestHistory: SpeedtestHistoryAsyncData.Success({
        data: [
          {
            timestamp: "2026-07-26T00:01:00.000Z",
            download_speed: 100,
            upload_speed: 20,
            latency: 8,
          },
          {
            timestamp: "2026-07-26T00:02:00.000Z",
            download_speed: 200,
            upload_speed: 40,
            latency: 8,
          },
        ],
      }),
    };

    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(model),
      acknowledgeAllChartMounts(),
      resolveAllChartSyncs(),
      Scene.expect(Scene.text("Avg download")).toExist(),
      Scene.expect(Scene.text("150.0 Mbps")).toExist(),
      Scene.expect(Scene.text("Avg upload")).toExist(),
      Scene.expect(Scene.text("30.0 Mbps")).toExist(),
      Scene.expect(Scene.text("Max download")).toExist(),
      Scene.expect(Scene.text("200.0 Mbps")).toExist(),
      Scene.expect(Scene.text("Max upload")).toExist(),
      Scene.expect(Scene.text("40.0 Mbps")).toExist()
    );
  });

  test("renders an empty toast region ready to receive notifications", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(initModel(defaultSettings())),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.role("region")).toExist()
    );
  });

  test("clicking Refresh now force-reloads every series", () => {
    const model = {
      ...initModel(defaultSettings()),
      metrics: MetricsAsyncData.Success({ data: [] }),
      speedtestHistory: SpeedtestHistoryAsyncData.Success({ data: [] }),
      connectivityStatus: ConnectivityStatusAsyncData.Success({
        data: {
          points: [],
          maybeUptimePercentage: Option.some(100),
          maybeAvailabilityPercentage: Option.some(100),
          coveragePercentage: 100,
          startTimeMs: 0,
          endTimeMs: 3_600_000,
          granularity: "1m" as const,
          request: DEFAULT_REQUEST,
        },
      }),
      liveConnectivity: liveConnectivity("up"),
    };

    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(model),
      acknowledgeAllChartMounts(),
      resolveAllChartSyncs(),
      Scene.expect(Scene.role("button", { name: "Refresh now" })).toExist(),
      Scene.click(Scene.role("button", { name: "Refresh now" })),
      Scene.Command.expectHas(
        FetchMetrics({
          token: "abc123",
          dateRange: DEFAULT_DATE_RANGE,
          maybeEarliestDataMs: Option.none(),
        })
      ),
      Scene.Command.expectHas(
        FetchSpeedtestHistory({
          token: "abc123",
          dateRange: DEFAULT_DATE_RANGE,
          maybeEarliestDataMs: Option.none(),
        })
      ),
      Scene.Command.expectHas(
        FetchConnectivityStatus({
          token: "abc123",
          dateRange: DEFAULT_DATE_RANGE,
          maybeEarliestDataMs: Option.none(),
        })
      ),
      Scene.Command.expectHas(FetchLiveConnectivity({ token: "abc123" })),
      Scene.Command.resolveAll(
        ...ENTER_INSIGHT_RESOLVERS,
        ...REFRESH_EXTRA_RESOLVERS,
        [
          FetchMetrics,
          SucceededFetchMetrics({
            metrics: [],
            nowMs: 0,
            ...METRICS_WINDOW,
            request: DEFAULT_REQUEST,
          }),
        ],
        [
          FetchSpeedtestHistory,
          SucceededFetchSpeedtestHistory({
            history: [],
            ...SPEEDTEST_WINDOW,
            request: DEFAULT_REQUEST,
          }),
        ],
        [
          FetchConnectivityStatus,
          SucceededFetchConnectivityStatus({
            request: DEFAULT_REQUEST,
            points: [],
            maybeUptimePercentage: Option.some(100),
            maybeAvailabilityPercentage: Option.some(100),
            coveragePercentage: 100,
            startTimeMs: 0,
            endTimeMs: 3_600_000,
            granularity: "1m",
          }),
        ],
        [
          FetchLiveConnectivity,
          SucceededFetchLiveConnectivity({
            status: "up",
            maybeLastSampleAtMs: Option.none(),
          }),
        ]
      ),
      resolveAllChartSyncs()
    );
  });

  test("clicking pause toggles the button label to Resume auto-refresh and persists it", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(initModel(defaultSettings())),
      acknowledgeAllChartMounts(),
      Scene.expect(
        Scene.role("button", { name: "Pause auto-refresh" })
      ).toExist(),
      Scene.click(Scene.role("button", { name: "Pause auto-refresh" })),
      Scene.Command.resolve(SaveSettings, CompletedSaveSettings()),
      Scene.expect(
        Scene.role("button", { name: "Resume auto-refresh" })
      ).toExist()
    );
  });

  test("going idle shows a distinct resume label, and clicking it resumes without a manual pause", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given({ ...initModel(defaultSettings()), isIdle: true }),
      acknowledgeAllChartMounts(),
      Scene.expect(
        Scene.role("button", {
          name: "Paused after inactivity. Resume auto-refresh",
        })
      ).toExist(),
      Scene.click(
        Scene.role("button", {
          name: "Paused after inactivity. Resume auto-refresh",
        })
      ),
      Scene.expect(
        Scene.role("button", { name: "Pause auto-refresh" })
      ).toExist()
    );
  });

  // Scene never runs a Command's real effect, only injects its resolved
  // message, so `<html>`'s dark class is covered in command.test.ts and e2e
  // instead — this only covers the model and view.
  test("flags paused auto-refresh in the status line", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given({ ...initModel(defaultSettings()), isPaused: true }),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.text("Auto-refresh paused")).toExist()
    );
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(initModel(defaultSettings())),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.text("Auto-refresh paused")).not.toExist()
    );
  });

  test("keys the availability ribbon with a pattern-backed legend", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(initModel(defaultSettings())),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.text("Up")).toExist(),
      Scene.expect(Scene.text("Down")).toExist(),
      Scene.expect(Scene.text("No data")).toExist(),
      Scene.expect(Scene.selector("span.pattern-hatch")).toExist(),
      Scene.expect(Scene.selector("span.pattern-strike")).toExist(),
      Scene.expect(Scene.selector("span.pattern-nodata")).toExist()
    );
  });

  test("ends the speed tests card with the latest figures and the run button", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given({
        ...initModel(defaultSettings()),
        ...LOADED_WINDOWS,
        speedtestHistory: SpeedtestHistoryAsyncData.Success({
          data: [
            {
              timestamp: "2026-07-26T00:01:00.000Z",
              download_speed: 941.4,
              upload_speed: 917.2,
              latency: 8,
              server_location: "Fremont, CA",
            },
          ],
        }),
      }),
      acknowledgeAllChartMounts(),
      resolveAllChartSyncs(),
      Scene.expect(
        Scene.text(
          /^Latest hourly average, .+: 941 Mbps down, 917 Mbps up \(Fremont, CA\)\.$/
        )
      ).toExist(),
      Scene.expect(Scene.role("button", { name: "Run speed test" })).toExist()
    );
  });

  test("the overflow menu offers Light, Dark and System, checking the active one", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(initModel(defaultSettings())),
      acknowledgeAllChartMounts(),
      Scene.click(Scene.role("button", { name: "Menu" })),
      ...resolveMenuMounts(),
      Scene.expect(Scene.role("menuitem", { name: "Light" })).toExist(),
      Scene.expect(Scene.role("menuitem", { name: "Dark" })).toExist(),
      Scene.expect(Scene.role("menuitem", { name: /^System/ })).toExist(),
      Scene.expect(
        Scene.role("menuitem", { name: "System (selected)" })
      ).toExist(),
      Scene.expect(
        Scene.role("menuitem", { name: "Run speed test" })
      ).toExist(),
      Scene.expect(Scene.role("menuitem", { name: "Log out" })).toExist()
    );
  });

  test("typing a letter in the open menu jumps to the item that starts with it", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(initModel(defaultSettings())),
      acknowledgeAllChartMounts(),
      Scene.click(Scene.role("button", { name: "Menu" })),
      ...resolveMenuMounts(),
      Scene.keydown(Scene.role("menu"), "d"),
      Scene.Command.resolveAll([
        Menu.DelayClearSearch,
        Menu.Message.CompletedDelayClearSearch({ version: 1 }),
      ]),
      Scene.expect(Scene.role("menu")).toHaveAttr(
        "aria-activedescendant",
        "dashboard-menu-item-1"
      ),
      Scene.keydown(Scene.role("menu"), "l"),
      Scene.Command.resolveAll([
        Menu.DelayClearSearch,
        Menu.Message.CompletedDelayClearSearch({ version: 2 }),
      ]),
      Scene.expect(Scene.role("menu")).toHaveAttr(
        "aria-activedescendant",
        "dashboard-menu-item-4"
      )
    );
  });

  test("choosing Dark from the menu applies it, persists it and checks it", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(initModel(defaultSettings())),
      acknowledgeAllChartMounts(),
      Scene.click(Scene.role("button", { name: "Menu" })),
      ...resolveMenuMounts(),
      Scene.click(Scene.role("menuitem", { name: "Dark" })),
      Scene.Mount.expectEnded(Menu.AnchorMenu, Menu.PortalMenuBackdrop),
      Scene.Command.expectHas(ApplyTheme({ theme: "dark" })),
      Scene.Command.resolveAll(
        [ApplyTheme, CompletedApplyTheme()],
        [SaveSettings, CompletedSaveSettings()],
        [Menu.FocusButton, Menu.Message.CompletedFocusButton()]
      ),
      Scene.click(Scene.role("button", { name: "Menu" })),
      Scene.Mount.resolveAll(
        [Menu.AnchorMenu, Menu.Message.CompletedAnchorMenu()],
        [Menu.PortalMenuBackdrop, Menu.Message.CompletedPortalMenuBackdrop()]
      ),
      Scene.Command.resolveAll([
        Menu.FocusItems,
        Menu.Message.CompletedFocusItems(),
      ]),
      Scene.expect(
        Scene.role("menuitem", { name: "Dark (selected)" })
      ).toExist()
    );
  });

  test("the quick range buttons mark the active preset and reload on a change", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(initModel(defaultSettings())),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.role("button", { name: "30d" })).toHaveAttr(
        "aria-pressed",
        "true"
      ),
      Scene.expect(Scene.role("button", { name: "24h" })).toHaveAttr(
        "aria-pressed",
        "false"
      ),
      Scene.click(Scene.role("button", { name: "24h" })),
      Scene.Command.expectHas(
        FetchMetrics({
          token: "abc123",
          dateRange: Preset({ preset: "last24h" }),
          maybeEarliestDataMs: Option.none(),
        })
      ),
      Scene.Command.expectHas(
        SaveSettings({
          settings: {
            theme: "system",
            dateRange: Preset({ preset: "last24h" }),
            isPaused: false,
            latencyView: "all",
          },
        })
      ),
      Scene.Command.resolveAll(
        ...RANGE_INSIGHT_RESOLVERS,
        [
          FetchMetrics,
          SucceededFetchMetrics({
            metrics: [],
            nowMs: NOW_MS,
            ...METRICS_WINDOW,
            request: DEFAULT_REQUEST,
          }),
        ],
        [
          FetchSpeedtestHistory,
          SucceededFetchSpeedtestHistory({
            history: [],
            ...SPEEDTEST_WINDOW,
            request: DEFAULT_REQUEST,
          }),
        ],
        [
          FetchConnectivityStatus,
          FailedFetchConnectivityStatus({
            error: "skip",
            request: DEFAULT_REQUEST,
          }),
        ],
        [SaveSettings, CompletedSaveSettings()]
      ),
      resolveAllChartSyncs(),
      Scene.expect(Scene.role("button", { name: "24h" })).toHaveAttr(
        "aria-pressed",
        "true"
      )
    );
  });

  test("shows one banner for every failed fetch, merging identical errors, with a Retry button", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given({
        ...initModel(defaultSettings()),
        metrics: MetricsAsyncData.Failure({ error: "db down" }),
        speedtestHistory: SpeedtestHistoryAsyncData.Failure({
          error: "db down",
        }),
        connectivityStatus: ConnectivityStatusAsyncData.Failure({
          error: "timeout",
        }),
      }),
      acknowledgeAllChartMounts(),
      Scene.expectAll(Scene.all.role("alert")).toHaveCount(1),
      Scene.expect(Scene.role("alert")).toContainText(
        "Metrics, Speed tests: db down"
      ),
      Scene.expect(Scene.role("alert")).toContainText("Availability: timeout"),
      Scene.expect(Scene.role("button", { name: "Retry" })).toExist()
    );
  });

  test("shows no banner when nothing failed", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(initModel(defaultSettings())),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.role("alert")).not.toExist()
    );
  });

  test("Retry reloads every series", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given({
        ...initModel(defaultSettings()),
        metrics: MetricsAsyncData.Failure({ error: "db down" }),
      }),
      acknowledgeAllChartMounts(),
      Scene.click(Scene.role("button", { name: "Retry" })),
      Scene.Command.expectHas(
        FetchMetrics({
          token: "abc123",
          dateRange: DEFAULT_DATE_RANGE,
          maybeEarliestDataMs: Option.none(),
        })
      ),
      Scene.Command.resolveAll(
        ...ENTER_INSIGHT_RESOLVERS,
        ...REFRESH_EXTRA_RESOLVERS,
        [
          FetchMetrics,
          SucceededFetchMetrics({
            metrics: [],
            nowMs: NOW_MS,
            ...METRICS_WINDOW,
            request: DEFAULT_REQUEST,
          }),
        ],
        [
          FetchSpeedtestHistory,
          SucceededFetchSpeedtestHistory({
            history: [],
            ...SPEEDTEST_WINDOW,
            request: DEFAULT_REQUEST,
          }),
        ],
        [
          FetchConnectivityStatus,
          FailedFetchConnectivityStatus({
            error: "skip",
            request: DEFAULT_REQUEST,
          }),
        ],
        [FetchLiveConnectivity, FailedFetchLiveConnectivity({ error: "skip" })]
      ),
      resolveAllChartSyncs()
    );
  });

  test("opening the date range picker, choosing a preset, and applying it changes the selected range and reloads data", () => {
    const appliedRange = Preset({ preset: "last7d" });
    const initialLabel = formatDateRangeLabel(
      getDateRangeWindow(DEFAULT_DATE_RANGE, NOW_MS)
    );
    const appliedLabel = formatDateRangeLabel(
      getDateRangeWindow(appliedRange, NOW_MS)
    );
    const model = {
      ...initModel(defaultSettings()),
      metrics: MetricsAsyncData.Success({ data: [] }),
      speedtestHistory: SpeedtestHistoryAsyncData.Success({ data: [] }),
      connectivityStatus: ConnectivityStatusAsyncData.Success({
        data: {
          points: [],
          maybeUptimePercentage: Option.some(100),
          maybeAvailabilityPercentage: Option.some(100),
          coveragePercentage: 100,
          startTimeMs: 0,
          endTimeMs: 3_600_000,
          granularity: "1m" as const,
          request: DEFAULT_REQUEST,
        },
      }),
    };

    try {
      Scene.scene(
        { update: boundUpdate, view },
        Scene.given(model),
        acknowledgeAllChartMounts(),
        resolveAllChartSyncs(),
        Scene.expect(Scene.role("button", { name: initialLabel })).toExist(),
        Scene.click(Scene.role("button", { name: initialLabel })),
        Scene.Mount.resolveAll(
          [Popover.AnchorPopover, Popover.Message.CompletedAnchorPopover()],
          [
            Popover.PortalPopoverBackdrop,
            Popover.Message.CompletedPortalPopoverBackdrop(),
          ]
        ),
        Scene.click(Scene.role("button", { name: "Last 7 days" })),
        Scene.expect(Scene.role("button", { name: "Last 7 days" })).toHaveAttr(
          "aria-pressed",
          "true"
        ),
        Scene.click(Scene.role("button", { name: "Apply" })),
        // The ribbon holds the previous range's window, so it gives way to its
        // loading state until the new range answers.
        Scene.Mount.expectEnded(MeasureRibbon),
        Scene.Command.expectHas(
          FetchMetrics({
            token: "abc123",
            dateRange: appliedRange,
            maybeEarliestDataMs: Option.none(),
          })
        ),
        Scene.Command.expectHas(
          FetchSpeedtestHistory({
            token: "abc123",
            dateRange: appliedRange,
            maybeEarliestDataMs: Option.none(),
          })
        ),
        Scene.Command.expectHas(
          FetchConnectivityStatus({
            token: "abc123",
            dateRange: appliedRange,
            maybeEarliestDataMs: Option.none(),
          })
        ),
        Scene.Command.resolveAll(
          ...RANGE_INSIGHT_RESOLVERS,
          [
            FetchMetrics,
            SucceededFetchMetrics({
              metrics: [],
              nowMs: NOW_MS,
              ...METRICS_WINDOW,
              request: DEFAULT_REQUEST,
            }),
          ],
          [
            FetchSpeedtestHistory,
            SucceededFetchSpeedtestHistory({
              history: [],
              ...SPEEDTEST_WINDOW,
              request: DEFAULT_REQUEST,
            }),
          ],
          [
            FetchConnectivityStatus,
            SucceededFetchConnectivityStatus({
              request: DEFAULT_REQUEST,
              points: [],
              maybeUptimePercentage: Option.some(100),
              maybeAvailabilityPercentage: Option.some(100),
              coveragePercentage: 100,
              startTimeMs: 0,
              endTimeMs: 3_600_000,
              granularity: "1m",
            }),
          ]
        ),
        resolveAllChartSyncs(),
        Scene.Command.resolve(SaveSettings, CompletedSaveSettings()),
        Scene.Command.resolve(
          Popover.FocusButton,
          Popover.Message.CompletedFocusButton()
        ),
        Scene.Mount.expectEnded(
          Popover.AnchorPopover,
          Popover.PortalPopoverBackdrop
        ),
        Scene.expect(Scene.role("button", { name: appliedLabel })).toExist()
      );
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("dashboard view: insights", () => {
  const settled = (overrides: Record<string, unknown> = {}) => ({
    ...initModel(defaultSettings()),
    ...LOADED_WINDOWS,
    metrics: MetricsAsyncData.Success({ data: [] }),
    speedtestHistory: SpeedtestHistoryAsyncData.Success({ data: [] }),
    connectivityStatus: ConnectivityStatusAsyncData.Success({
      data: {
        points: [],
        maybeUptimePercentage: Option.some(99.4),
        maybeAvailabilityPercentage: Option.some(99.8),
        coveragePercentage: 100,
        startTimeMs: 0,
        endTimeMs: 3_600_000,
        granularity: "1m" as const,
        request: DEFAULT_REQUEST,
      },
    }),
    liveConnectivity: liveConnectivity("up"),
    ...loadedInsights(),
    ...overrides,
  });

  const showAtRibbonWidth =
    (ribbonWidthPx: number) =>
    (
      model: Model,
      ...steps: ReadonlyArray<Scene.SceneStep<Model, Message, OutMessage>>
    ) =>
      Scene.scene(
        { update: boundUpdate, view },
        Scene.given(model),
        acknowledgeAllChartMounts(ribbonWidthPx),
        resolveAllChartSyncs(),
        ...steps
      );
  const show = showAtRibbonWidth(DEFAULT_RIBBON_WIDTH_PX);

  describe("status and stat rail", () => {
    test("the banner landmark holds the top bar only, and the ribbon and stat rail sit inside main", () => {
      show(
        settled(),
        Scene.inside(
          Scene.role("banner"),
          Scene.expect(
            Scene.role("heading", { name: "WAN Monitor" })
          ).toExist(),
          Scene.expect(Scene.testId("availability-ribbon")).not.toExist(),
          Scene.expect(Scene.testId("live-status")).not.toExist(),
          Scene.expect(
            Scene.role("region", { name: "Range summary" })
          ).not.toExist()
        ),
        Scene.inside(
          Scene.role("main"),
          Scene.expect(Scene.testId("availability-ribbon")).toExist(),
          Scene.expect(Scene.testId("live-status")).toExist(),
          Scene.expect(
            Scene.role("region", { name: "Range summary" })
          ).toExist(),
          Scene.expect(Scene.role("heading", { name: "Incidents" })).toExist()
        )
      );
    });

    test("the stat rail's figures sit under their own heading, not under Availability", () => {
      show(
        settled(),
        Scene.inside(
          Scene.role("region", { name: "Range summary" }),
          Scene.expect(
            Scene.role("heading", { name: "Range summary", level: 2 })
          ).toExist(),
          Scene.expect(
            Scene.role("heading", { name: "Latency p50", level: 3 })
          ).toExist()
        )
      );
    });

    test("the big figure is the range's uptime, labelled with the range it covers", () => {
      show(
        settled(),
        Scene.expect(Scene.testId("uptime-figure")).toHaveText("99.40%"),
        Scene.expect(Scene.testId("uptime-label")).toHaveText(
          "uptime over the last 30 days"
        )
      );
    });

    test("names a custom range by its dates in the uptime label", () => {
      const dateRange = Custom({
        startTime: "2026-07-04T00:00:00.000Z",
        endTime: "2026-07-10T23:59:59.999Z",
      });
      const request = { dateRange, maybeEarliestDataMs: Option.none<number>() };
      withTimeZone("UTC", () => {
        show(
          settled({
            dateRange,
            summary: SummaryAsyncData.Success({
              data: summaryData(summaryResponse(), request),
            }),
            outages: OutagesAsyncData.Success({
              data: outagesData(outagesResponse(), { request }),
            }),
            connectivityStatus: ConnectivityStatusAsyncData.Success({
              data: {
                points: [],
                maybeUptimePercentage: Option.some(99.4),
                maybeAvailabilityPercentage: Option.some(99.8),
                coveragePercentage: 100,
                startTimeMs: 0,
                endTimeMs: 3_600_000,
                granularity: "1h" as const,
                request,
              },
            }),
          }),
          Scene.expect(Scene.testId("uptime-label")).toHaveText(
            "uptime over Jul 4 to Jul 10, 2026"
          )
        );
      });
    });

    describe("the outage summary under the figure", () => {
      const withLog = (
        outages: ReadonlyArray<ReturnType<typeof outageFixture>>,
        isClamped = false
      ) =>
        settled({
          outages: OutagesAsyncData.Success({
            data: outagesData(outagesResponse(outages), { isClamped }),
          }),
        });

      test("names the down and degraded time of the range's log", () => {
        show(
          withLog([
            outageFixture({ durationSeconds: 3060 }),
            outageFixture({ status: "degraded", durationSeconds: 5400 }),
          ]),
          Scene.expect(Scene.testId("outage-summary")).toHaveText(
            "Down for 51 minutes and degraded for 1 hour 30 minutes."
          )
        );
      });

      test("says there were no outages for an empty log", () => {
        show(
          withLog([]),
          Scene.expect(Scene.testId("outage-summary")).toHaveText(
            "No outages in this period."
          )
        );
      });

      test("says so when the log covers only the newest 90 days", () => {
        show(
          withLog([outageFixture({ durationSeconds: 3060 })], true),
          Scene.expect(Scene.testId("outage-summary")).toHaveText(
            "Down for 51 minutes in the newest 90 days."
          )
        );
      });

      test("shows a skeleton line while the log loads", () => {
        show(
          settled({ outages: OutagesAsyncData.Idle() }),
          Scene.expect(Scene.testId("outage-summary")).not.toExist(),
          Scene.expect(
            Scene.role("status", { name: "Loading outage summary" })
          ).toExist()
        );
      });

      test("says the log could not load when its fetch failed", () => {
        show(
          settled({ outages: OutagesAsyncData.Failure({ error: "db down" }) }),
          Scene.inside(
            Scene.role("region", { name: "Live status and range uptime" }),
            Scene.expect(Scene.text("Could not load incidents.")).toExist()
          ),
          Scene.expect(Scene.testId("outage-summary")).not.toExist()
        );
      });
    });

    test("words an incident's phone card as a hosts sentence, then the worst loss", () => {
      show(
        settled({
          outages: OutagesAsyncData.Success({
            data: outagesData(
              outagesResponse([outageFixture({ peakLatency: 44 })])
            ),
          }),
        }),
        Scene.expect(Scene.testId("incident-card-A")).toContainText(
          "All 2 hosts. Max loss 100%, peak latency 44 ms."
        )
      );
    });

    test("has no separate availability figure and no comparison with a previous period", () => {
      show(
        settled(),
        Scene.expect(Scene.testId("availability-figure")).not.toExist(),
        Scene.expect(Scene.text(/available/)).not.toExist(),
        Scene.expect(Scene.text(/prev\./)).not.toExist(),
        Scene.expect(Scene.selector("[data-delta]")).not.toExist()
      );
    });

    test("the latency stat headlines the median and names the 95th percentile", () => {
      show(
        settled(),
        Scene.expect(Scene.testId("rail-latency")).toContainText("14.2 ms"),
        Scene.expect(Scene.testId("rail-latency")).toContainText(
          "95th percentile 31.8 ms"
        )
      );
    });

    test("the packet loss and jitter stats show the server's averages and say what they average over", () => {
      show(
        settled(),
        Scene.expect(Scene.testId("rail-loss")).toContainText("0.50%"),
        Scene.expect(Scene.testId("rail-loss")).toContainText(
          "Averaged over all checks"
        ),
        Scene.expect(Scene.testId("rail-jitter")).toContainText("2.1"),
        Scene.expect(Scene.testId("rail-jitter")).toContainText(
          "Averaged over all checks"
        )
      );
    });

    test("download and upload show the median with the test count", () => {
      show(
        settled(),
        Scene.expect(Scene.testId("rail-download")).toContainText("941"),
        Scene.expect(Scene.testId("rail-download")).toContainText(
          "Median of 24 tests"
        ),
        Scene.expect(Scene.testId("rail-upload")).toContainText("917"),
        Scene.expect(Scene.testId("rail-upload")).toContainText(
          "Median of 24 tests"
        )
      );
    });

    test("says the summary could not load when it fails, leaving the cause to the banner", () => {
      show(
        settled({ summary: SummaryAsyncData.Failure({ error: "db down" }) }),
        Scene.expect(Scene.text("Could not load the range summary.")).toExist(),
        Scene.expect(Scene.testId("rail-latency")).not.toExist(),
        Scene.expect(Scene.role("alert")).toContainText("Summary: db down")
      );
    });

    test("shows a dash, not 0%, for a range that held no ping cycles", () => {
      show(
        settled({
          summary: SummaryAsyncData.Success({
            data: summaryData(
              summaryResponse({
                range: rangeSummary({
                  uptimePercentage: null,
                  availabilityPercentage: null,
                }),
              })
            ),
          }),
          connectivityStatus: ConnectivityStatusAsyncData.Success({
            data: {
              points: [],
              maybeUptimePercentage: Option.none(),
              maybeAvailabilityPercentage: Option.none(),
              coveragePercentage: 0,
              startTimeMs: 0,
              endTimeMs: 3_600_000,
              granularity: "1m" as const,
              request: DEFAULT_REQUEST,
            },
          }),
        }),
        Scene.expect(Scene.testId("uptime-figure")).toHaveText("-"),
        Scene.expect(Scene.testId("uptime-label")).toHaveText(
          "uptime over the last 30 days"
        )
      );
    });

    test("falls back to the connectivity window's uptime when the summary fails", () => {
      show(
        settled({ summary: SummaryAsyncData.Failure({ error: "db down" }) }),
        Scene.expect(Scene.testId("uptime-figure")).toHaveText("99.40%")
      );
    });
  });

  describe("availability ribbon", () => {
    const startTimeMs = Date.parse("2026-07-26T10:00:00.000Z");
    const point = (
      timestamp: string,
      status: "up" | "degraded" | "down",
      shares: [number, number, number]
    ) => ({
      timestamp,
      status,
      upPercentage: shares[0],
      degradedPercentage: shares[1],
      downPercentage: shares[2],
    });
    // Seven hourly cells, 10:00 through 16:00: the 11:00 one degraded, the
    // 13:00 one down, and an incident lettered A that began inside the latter.
    const ribbonModel = (hours = 7) =>
      settled({
        connectivityStatus: ConnectivityStatusAsyncData.Success({
          data: {
            points: [
              point("2026-07-26T11:00:00.000Z", "degraded", [70, 30, 0]),
              point("2026-07-26T13:00:00.000Z", "down", [0, 0, 100]),
            ],
            maybeUptimePercentage: Option.some(99.4),
            maybeAvailabilityPercentage: Option.some(99.8),
            coveragePercentage: 100,
            startTimeMs,
            endTimeMs: startTimeMs + hours * 3_600_000 - 1,
            granularity: "1h" as const,
            request: DEFAULT_REQUEST,
          },
        }),
        outages: OutagesAsyncData.Success({
          data: outagesData(
            outagesResponse([
              outageFixture({
                start: "2026-07-26T13:10:00.000Z",
                end: "2026-07-26T13:40:00.000Z",
                durationSeconds: 1800,
              }),
            ])
          ),
        }),
      });

    // Cells with no readings: enough to lay out, for tests of the row layout.
    const emptyRibbonModel = (
      startIso: string,
      count: number,
      granularity: "1m" | "5m" | "1h"
    ) => {
      const intervalMs = { "1m": 60_000, "5m": 300_000, "1h": 3_600_000 }[
        granularity
      ];
      const start = Date.parse(startIso);
      return settled({
        connectivityStatus: ConnectivityStatusAsyncData.Success({
          data: {
            points: [],
            maybeUptimePercentage: Option.none(),
            maybeAvailabilityPercentage: Option.none(),
            coveragePercentage: 100,
            startTimeMs: start,
            endTimeMs: start + count * intervalMs - 1,
            granularity,
            request: DEFAULT_REQUEST,
          },
        }),
      });
    };

    test("draws a cell for every bucket in the range, the one still filling included", () => {
      show(
        ribbonModel(),
        Scene.expect(Scene.testId("connectivity-segment-6")).toExist(),
        Scene.expect(Scene.testId("connectivity-segment-7")).not.toExist()
      );
    });

    test("keys the not-monitored state in the legend only when a cell has it", () => {
      show(
        ribbonModel(),
        Scene.expect(Scene.text("Before monitoring started")).not.toExist()
      );
      show(
        {
          ...ribbonModel(),
          maybeEarliestDataMs: Option.some(
            Date.parse("2026-07-26T12:30:00.000Z")
          ),
        },
        Scene.expect(Scene.text("Before monitoring started")).toExist()
      );
    });

    test("fills each cell by its status", () => {
      show(
        ribbonModel(),
        Scene.expect(Scene.testId("connectivity-segment-0")).toHaveClass(
          "pattern-nodata"
        ),
        Scene.expect(Scene.testId("connectivity-segment-1")).toHaveClass(
          "pattern-hatch"
        ),
        Scene.expect(Scene.testId("connectivity-segment-3")).toHaveClass(
          "pattern-strike"
        )
      );
    });

    test("says how long each cell is in its subtitle, without the incident totals", () => {
      show(
        ribbonModel(),
        Scene.expect(Scene.text("Each cell is one hour.")).toExist(),
        Scene.inside(
          Scene.testId("availability-card"),
          Scene.expect(Scene.text(/30 days|incident|hourly/)).not.toExist()
        )
      );
    });

    test("hovering a cell shows its time span, status and each state's share as sentences", () => {
      withTimeZone("UTC", () => {
        show(
          ribbonModel(),
          Scene.expect(Scene.role("tooltip")).not.toExist(),
          Scene.hover(Scene.testId("connectivity-segment-1")),
          Scene.expect(Scene.role("tooltip")).toContainText(
            "Jul 26, 11 AM to 12 PM."
          ),
          Scene.expect(Scene.role("tooltip")).toContainText(
            "Degraded: 70% of checks up, 30% degraded."
          )
        );
      });
    });

    test("a cell with no readings says it has no data", () => {
      show(
        ribbonModel(),
        Scene.hover(Scene.testId("connectivity-segment-0")),
        Scene.expect(Scene.role("tooltip")).toContainText("No data.")
      );
    });

    test("the arrow keys move the tooltip from cell to cell and Escape closes it", () => {
      show(
        ribbonModel(),
        Scene.keydown(Scene.testId("availability-ribbon"), "ArrowRight"),
        Scene.expect(Scene.role("tooltip")).toContainText("No data"),
        Scene.keydown(Scene.testId("availability-ribbon"), "ArrowRight"),
        Scene.expect(Scene.role("tooltip")).toContainText(
          "Degraded: 70% of checks up, 30% degraded."
        ),
        Scene.keydown(Scene.testId("availability-ribbon"), "End"),
        Scene.expect(Scene.role("tooltip")).toContainText("No data"),
        Scene.keydown(Scene.testId("availability-ribbon"), "Escape"),
        Scene.expect(Scene.role("tooltip")).not.toExist()
      );
    });

    test("is a labelled group that describes the range in words, naming the down and degraded hours", () => {
      withTimeZone("UTC", () => {
        const expected =
          "Each cell is one hour, from Jul 26, 10:00 AM to Jul 26, 5:00 PM. Down: Jul 26, 1:00 PM. Degraded: Jul 26, 11:00 AM. No data: 5 hours.";
        show(
          ribbonModel(),
          Scene.expect(Scene.testId("availability-ribbon")).toHaveAttr(
            "role",
            "group"
          ),
          Scene.expect(Scene.testId("availability-ribbon")).toHaveAttr(
            "aria-label",
            expected
          ),
          Scene.expect(Scene.testId("availability-ribbon-touch")).toHaveAttr(
            "aria-label",
            expected
          )
        );
      });
    });

    test("is one tab stop per layout, with the cells themselves out of the tab order", () => {
      show(
        ribbonModel(),
        Scene.expectAll(
          Scene.all.selector('[data-testid="availability-card"] [tabIndex="0"]')
        ).toHaveCount(2),
        Scene.expect(Scene.testId("availability-ribbon")).toHaveAttr(
          "tabIndex",
          "0"
        ),
        Scene.expect(Scene.testId("availability-ribbon-touch")).toHaveAttr(
          "tabIndex",
          "0"
        ),
        Scene.expectAll(
          Scene.all.selector('[data-testid^="ribbon-day-cell-"][tabIndex="-1"]')
        ).toHaveCount(7),
        Scene.expectAll(
          Scene.all.selector('[data-testid^="connectivity-segment-"][tabIndex]')
        ).toBeEmpty()
      );
    });

    test("announces the cell an arrow key lands on, and goes quiet on Escape", () => {
      show(
        ribbonModel(),
        Scene.expect(Scene.testId("ribbon-announcement")).toHaveAttr(
          "role",
          "status"
        ),
        Scene.expect(Scene.testId("ribbon-announcement")).toBeEmpty(),
        Scene.keydown(Scene.testId("availability-ribbon"), "ArrowRight"),
        Scene.keydown(Scene.testId("availability-ribbon"), "ArrowRight"),
        Scene.expect(Scene.testId("ribbon-announcement")).toContainText(
          "Degraded: 70% of checks up, 30% degraded."
        ),
        Scene.keydown(Scene.testId("availability-ribbon-touch"), "ArrowRight"),
        Scene.expect(Scene.testId("ribbon-announcement")).toContainText(
          "No data"
        ),
        Scene.keydown(Scene.testId("availability-ribbon-touch"), "Escape"),
        Scene.expect(Scene.testId("ribbon-announcement")).toBeEmpty()
      );
    });

    test("announces a tapped cell on the phone layout too", () => {
      show(
        ribbonModel(),
        Scene.click(Scene.testId("ribbon-day-cell-3")),
        Scene.expect(Scene.testId("ribbon-announcement")).toContainText(
          "Down: 100% of checks down."
        )
      );
    });

    test("puts a lettered chip over the cell an incident began in, and clicking it selects that cell", () => {
      show(
        ribbonModel(),
        Scene.expect(Scene.testId("incident-chip-A")).toContainText("A"),
        Scene.expect(Scene.testId("incident-chip-A")).toContainText("30m"),
        Scene.expect(Scene.testId("incident-chip-A")).toHaveAttr(
          "aria-pressed",
          "false"
        ),
        Scene.click(Scene.testId("incident-chip-A")),
        Scene.expect(Scene.testId("incident-chip-A")).toHaveAttr(
          "aria-pressed",
          "true"
        ),
        Scene.expect(Scene.role("tooltip")).toContainText("Down")
      );
    });

    test("words the chip's label for assistive tech with the incident's details", () => {
      show(
        ribbonModel(),
        Scene.expect(Scene.testId("incident-chip-A")).toHaveAttr(
          "aria-label",
          `Incident A: Down, ${formatDateTime("2026-07-26T13:10:00.000Z")} to ${formatDateTime("2026-07-26T13:40:00.000Z")}, 30m. Hosts: All 2 hosts. Max loss 100%. Show on ribbon`
        )
      );
    });

    test("marks a running incident's chip as ongoing", () => {
      show(
        {
          ...ribbonModel(),
          outages: OutagesAsyncData.Success({
            data: outagesData(
              outagesResponse([
                outageFixture({
                  start: "2026-07-28T11:30:00.000Z",
                  end: "2026-07-28T12:00:00.000Z",
                  durationSeconds: 1800,
                  status: "degraded",
                }),
              ])
            ),
          }),
          liveConnectivity: liveConnectivity("degraded"),
          connectivityStatus: ConnectivityStatusAsyncData.Success({
            data: {
              points: [],
              maybeUptimePercentage: Option.some(99.4),
              maybeAvailabilityPercentage: Option.some(99.8),
              coveragePercentage: 100,
              startTimeMs: Date.parse("2026-07-28T10:00:00.000Z"),
              endTimeMs: NOW_MS,
              granularity: "1h" as const,
              request: DEFAULT_REQUEST,
            },
          }),
        },
        Scene.expect(Scene.testId("incident-chip-A")).toContainText("ongoing")
      );
    });

    test("merges chips that would collide into one cluster that pins the first and lists them all", () => {
      const at = (minute: number) =>
        outageFixture({
          start: `2026-07-26T13:${String(minute).padStart(2, "0")}:00.000Z`,
          end: `2026-07-26T13:${String(minute + 5).padStart(2, "0")}:00.000Z`,
          durationSeconds: 300,
        });
      show(
        {
          ...ribbonModel(),
          outages: OutagesAsyncData.Success({
            data: outagesData(
              outagesResponse([at(40), at(30), at(20), at(10)])
            ),
          }),
        },
        Scene.expect(Scene.testId("incident-chip-cluster-A")).toContainText(
          "A–C"
        ),
        Scene.expect(
          Scene.role("button", {
            name: /Incidents A to C: 3 incidents.*A: Down, 5m; B: Down, 5m; C: Down, 5m/,
          })
        ).toExist(),
        Scene.expect(Scene.testId("incident-chip-cluster-A")).not.toHaveHandler(
          "focus"
        ),
        Scene.expect(Scene.testId("incident-chip-cluster-A")).not.toHaveHandler(
          "blur"
        ),
        Scene.click(Scene.testId("incident-chip-cluster-A")),
        Scene.expect(Scene.testId("incident-chip-cluster-A")).toHaveAttr(
          "aria-pressed",
          "true"
        ),
        Scene.expect(Scene.role("tooltip")).toContainText("A: Down, 5m"),
        Scene.expect(Scene.role("tooltip")).toContainText("C: Down, 5m"),
        Scene.expect(Scene.testId("ribbon-announcement")).toContainText(
          /A: Down, 5m; B: Down, 5m; C: Down, 5m$/
        ),
        Scene.expect(Scene.testId("incident-chip-D")).toExist(),
        Scene.click(Scene.testId("incident-chip-cluster-A")),
        Scene.expect(Scene.testId("incident-chip-cluster-A")).toHaveAttr(
          "aria-pressed",
          "false"
        ),
        Scene.expect(Scene.role("tooltip")).not.toExist()
      );
    });

    test("lays chips out against the width the ribbon measured", () => {
      const incidentAt = (hour: number) =>
        outageFixture({
          start: `2026-07-26T${hour}:10:00.000Z`,
          end: `2026-07-26T${hour}:40:00.000Z`,
          durationSeconds: 1800,
        });
      const withIncidents = {
        ...ribbonModel(),
        outages: OutagesAsyncData.Success({
          data: outagesData(
            outagesResponse([incidentAt(14), incidentAt(13), incidentAt(12)])
          ),
        }),
      };

      show(
        withIncidents,
        Scene.expect(Scene.testId("incident-chip-C")).toExist(),
        Scene.expect(Scene.testId("incident-chip-cluster-A")).not.toExist()
      );
      showAtRibbonWidth(200)(
        withIncidents,
        Scene.expect(Scene.testId("incident-chip-cluster-A")).toContainText(
          "A–C"
        ),
        Scene.expect(Scene.testId("incident-chip-C")).not.toExist()
      );
    });

    test("drops the axis labels that would run into Now on a narrow ribbon", () => {
      const endingNow = {
        ...ribbonModel(),
        connectivityStatus: ConnectivityStatusAsyncData.Success({
          data: {
            points: [],
            maybeUptimePercentage: Option.none(),
            maybeAvailabilityPercentage: Option.none(),
            coveragePercentage: 100,
            startTimeMs: Date.parse("2026-07-28T10:00:00.000Z"),
            endTimeMs: NOW_MS + 1,
            granularity: "1h" as const,
            request: DEFAULT_REQUEST,
          },
        }),
      };
      const axisLabels = (...labels: ReadonlyArray<string>) =>
        Scene.inside(
          Scene.testId("availability-card"),
          ...labels.map((label) => Scene.expect(Scene.text(label)).toExist())
        );

      withTimeZone("UTC", () => {
        show(endingNow, axisLabels("11:00 AM", "12:00 PM"));
        showAtRibbonWidth(200)(
          endingNow,
          axisLabels("11:00 AM"),
          Scene.inside(
            Scene.testId("availability-card"),
            Scene.expect(Scene.text("12:00 PM")).not.toExist()
          )
        );
      });
    });

    test("lays a short range out as plain rows of tappable cells for narrow screens", () => {
      show(
        ribbonModel(),
        Scene.expect(Scene.testId("ribbon-wrapped-rows")).toExist(),
        Scene.expect(Scene.testId("ribbon-day-stack")).not.toExist(),
        Scene.expect(Scene.testId("ribbon-day-cell-6")).toExist(),
        Scene.click(Scene.testId("ribbon-day-cell-3")),
        Scene.expect(Scene.testId("ribbon-day-cell-3")).toHaveAttr(
          "aria-pressed",
          "true"
        ),
        Scene.click(Scene.testId("ribbon-day-cell-3")),
        Scene.expect(Scene.testId("ribbon-day-cell-3")).toHaveAttr(
          "aria-pressed",
          "false"
        )
      );
    });

    test("fills phone rows of a shorter bucket with 24 cells each", () => {
      show(
        emptyRibbonModel("2026-07-26T10:00:00.000Z", 60, "5m"),
        Scene.expectAll(Scene.all.testId("ribbon-cell-row")).toHaveCount(3),
        Scene.expectAll(
          Scene.all.selector('[data-testid="ribbon-wrapped-rows"] button')
        ).toHaveCount(60),
        Scene.expect(Scene.testId("ribbon-cell-row")).toHaveStyle(
          "gridTemplateColumns",
          "repeat(24, minmax(0, 1fr))"
        )
      );
    });

    test("stacks a multi-day hourly range into one row per local day, an hour to a cell", () => {
      withTimeZone("UTC", () => {
        show(
          { ...ribbonModel(60), nowMs: Date.parse("2026-08-05T12:00:00.000Z") },
          Scene.expect(Scene.testId("ribbon-day-stack")).toExist(),
          Scene.expect(Scene.testId("ribbon-wrapped-rows")).not.toExist(),
          Scene.expectAll(Scene.all.testId("ribbon-day-row")).toHaveCount(3),
          Scene.expect(Scene.testId("ribbon-day-stack")).toContainText(
            "Tue 28"
          ),
          Scene.expect(Scene.testId("ribbon-day-stack")).toContainText(
            "Mon 27"
          ),
          Scene.expect(Scene.testId("ribbon-day-stack")).toContainText(
            "Sun 26"
          ),
          Scene.expect(Scene.testId("ribbon-cell-row")).toHaveStyle(
            "gridTemplateColumns",
            "repeat(24, minmax(0, 1fr))"
          ),
          Scene.expect(Scene.testId("ribbon-day-cell-59")).toExist(),
          Scene.expect(Scene.testId("ribbon-day-cell-60")).not.toExist()
        );
      });
    });

    test("labels the day rows with a compact hour axis", () => {
      withTimeZone("UTC", () => {
        show(
          ribbonModel(60),
          Scene.inside(
            Scene.testId("ribbon-day-stack"),
            Scene.expect(Scene.text("00")).toExist(),
            Scene.expect(Scene.text("06")).toExist(),
            Scene.expect(Scene.text("12")).toExist(),
            Scene.expect(Scene.text("18")).toExist()
          )
        );
      });
    });

    test("gives a daylight saving day a cell for each of its hours and no false gap", () => {
      withTimeZone("America/Los_Angeles", () => {
        show(
          emptyRibbonModel("2026-10-31T20:00:00.000Z", 40, "1h"),
          Scene.expectAll(Scene.all.testId("ribbon-day-row")).toHaveCount(3),
          Scene.expectAll(
            Scene.all.selector('[data-testid="ribbon-day-stack"] button')
          ).toHaveCount(40),
          Scene.expectAll(Scene.all.testId("ribbon-day-spacer")).toHaveCount(33)
        );
        show(
          emptyRibbonModel("2026-03-07T20:00:00.000Z", 40, "1h"),
          Scene.expectAll(
            Scene.all.selector('[data-testid="ribbon-day-stack"] button')
          ).toHaveCount(40),
          Scene.expectAll(Scene.all.testId("ribbon-day-spacer")).toHaveCount(
            12 + 19
          )
        );
      });
    });

    test("leaves the hours before the range and after its end as empty spacers", () => {
      withTimeZone("UTC", () => {
        show(
          ribbonModel(60),
          Scene.expectAll(Scene.all.testId("ribbon-day-spacer")).toHaveCount(
            12
          ),
          Scene.expect(Scene.testId("ribbon-day-spacer")).not.toHaveClass(
            "pattern-nodata"
          ),
          Scene.expect(Scene.testId("ribbon-day-spacer")).toHaveAttr(
            "aria-hidden",
            "true"
          )
        );
      });
    });
  });

  describe("data fetched for another range", () => {
    // Everything in `settled()` answers the 30 day default; the selection has
    // since moved to 24 hours and no new answer has landed.
    const onAnotherRange = (overrides: Record<string, unknown> = {}) =>
      settled({
        dateRange: Preset({ preset: "last24h" }),
        outages: OutagesAsyncData.Success({
          data: outagesData(
            outagesResponse([
              outageFixture({
                start: "2026-07-26T13:10:00.000Z",
                end: "2026-07-26T13:40:00.000Z",
                durationSeconds: 1800,
              }),
            ])
          ),
        }),
        ...overrides,
      });

    test("the hero figures wait for their own range instead of showing the old one", () => {
      show(
        onAnotherRange(),
        Scene.expect(
          Scene.role("status", { name: "Loading status" })
        ).toExist(),
        Scene.expect(Scene.testId("uptime-figure")).not.toExist(),
        Scene.expect(Scene.testId("availability-figure")).not.toExist()
      );
    });

    test("the stat rail waits for its own range instead of showing the old one", () => {
      show(
        onAnotherRange(),
        Scene.expect(
          Scene.role("status", { name: "Loading latency p50" })
        ).toExist(),
        Scene.expect(Scene.testId("rail-latency")).not.toExist()
      );
    });

    test("the ribbon waits for its own range instead of drawing the old window", () => {
      show(
        onAnotherRange(),
        Scene.expect(
          Scene.role("status", { name: "Loading availability" })
        ).toExist(),
        Scene.expect(Scene.testId("availability-ribbon")).not.toExist()
      );
    });

    test("the ribbon subtitle and chips never use the outage log of another range", () => {
      const startMs = Date.parse("2026-07-26T10:00:00.000Z");
      show(
        onAnotherRange({
          connectivityStatus: ConnectivityStatusAsyncData.Success({
            data: {
              points: [],
              maybeUptimePercentage: Option.none(),
              maybeAvailabilityPercentage: Option.none(),
              coveragePercentage: 100,
              startTimeMs: startMs,
              endTimeMs: startMs + 7 * 3_600_000 - 1,
              granularity: "1h" as const,
              request: {
                dateRange: Preset({ preset: "last24h" }),
                maybeEarliestDataMs: Option.none(),
              },
            },
          }),
        }),
        Scene.expect(Scene.testId("availability-ribbon")).toExist(),
        Scene.expect(Scene.text(/1 incident/)).not.toExist(),
        Scene.expect(Scene.testId("incident-chip-A")).not.toExist()
      );
    });

    describe("the coverage note beside the uptime figure", () => {
      const DAY_MS = 86_400_000;
      const request = {
        dateRange: Preset({ preset: "last24h" }),
        maybeEarliestDataMs: Option.none<number>(),
      };
      const dayWindow = {
        points: [],
        maybeUptimePercentage: Option.some(99.4),
        maybeAvailabilityPercentage: Option.some(99.8),
        coveragePercentage: 50,
        startTimeMs: 0,
        endTimeMs: DAY_MS,
        granularity: "5m" as const,
        request: DEFAULT_REQUEST,
      };

      test("reads nothing while the selected range's window is being fetched", () => {
        show(
          onAnotherRange({
            connectivityStatus: ConnectivityStatusAsyncData.Refreshing({
              data: dayWindow,
            }),
          }),
          Scene.expect(Scene.text(/The monitor has/)).not.toExist()
        );
      });

      test("reads nothing after the selected range's fetch failed", () => {
        show(
          onAnotherRange({
            connectivityStatus: ConnectivityStatusAsyncData.Stale({
              error: "db down",
              data: dayWindow,
            }),
          }),
          Scene.expect(Scene.text(/The monitor has/)).not.toExist()
        );
      });

      test("says how much of the period the monitor has data for, once the window answers the selected range", () => {
        show(
          onAnotherRange({
            connectivityStatus: ConnectivityStatusAsyncData.Success({
              data: { ...dayWindow, request },
            }),
          }),
          Scene.expect(Scene.testId("coverage-note")).toHaveText(
            "The monitor has data for 12 hours of this period, and uptime covers only that time."
          )
        );
      });

      test("says nothing when the monitor covered the whole period", () => {
        show(
          onAnotherRange({
            connectivityStatus: ConnectivityStatusAsyncData.Success({
              data: { ...dayWindow, coveragePercentage: 100, request },
            }),
          }),
          Scene.expect(Scene.testId("coverage-note")).not.toExist()
        );
      });
    });

    test("a figure answering the selected range is shown", () => {
      const request = {
        dateRange: Preset({ preset: "last24h" }),
        maybeEarliestDataMs: Option.none<number>(),
      };
      show(
        onAnotherRange({
          summary: SummaryAsyncData.Success({
            data: summaryData(
              summaryResponse({
                range: rangeSummary({ uptimePercentage: 97.5 }),
              }),
              request
            ),
          }),
        }),
        Scene.expect(Scene.testId("uptime-figure")).toHaveText("97.50%"),
        Scene.expect(Scene.testId("uptime-label")).toHaveText(
          "uptime over the last 24 hours"
        )
      );
    });
  });

  describe("a failed fetch", () => {
    const failed = { error: "db down" };

    test("the incidents card says it could not load, not that there are none", () => {
      show(
        settled({ outages: OutagesAsyncData.Failure(failed) }),
        Scene.expect(Scene.text("Could not load incidents.")).toExist(),
        Scene.expect(Scene.text(/No incidents in/)).not.toExist()
      );
    });

    test("the hosts card says it could not load, not that there is no host data", () => {
      show(
        settled({ summary: SummaryAsyncData.Failure(failed) }),
        Scene.expect(Scene.text("Could not load hosts.")).toExist(),
        Scene.expect(Scene.text("No host data in this range.")).not.toExist()
      );
    });

    test("the availability card says it could not load and draws no ribbon", () => {
      show(
        settled({
          connectivityStatus: ConnectivityStatusAsyncData.Failure(failed),
        }),
        Scene.expect(Scene.text("Could not load availability.")).toExist(),
        Scene.expect(Scene.testId("availability-ribbon")).not.toExist()
      );
    });

    test("the speed card says once, over its chart, that it could not load, not that there are no tests", () => {
      show(
        settled({
          speedtestHistory: SpeedtestHistoryAsyncData.Failure(failed),
        }),
        Scene.inside(
          Scene.label("Speed chart"),
          Scene.expect(Scene.testId("chart-notice")).toContainText(
            "Could not load the chart."
          )
        ),
        Scene.expect(Scene.text("Could not load speed tests.")).not.toExist(),
        Scene.expect(Scene.text("No tests in this range.")).not.toExist(),
        Scene.expect(Scene.text(/- Mbps/)).not.toExist()
      );
    });

    test("a failed refresh for a new range reads as failed, not as the old range's data", () => {
      const staleFor30d = <A>(data: A) => ({ error: "db down", data });
      show(
        settled({
          dateRange: Preset({ preset: "last24h" }),
          summary: SummaryAsyncData.Stale(staleFor30d(summaryData())),
          outages: OutagesAsyncData.Stale(staleFor30d(outagesData())),
        }),
        Scene.expect(Scene.text("Could not load the range summary.")).toExist(),
        Scene.expect(Scene.text("Could not load incidents.")).toExist(),
        Scene.expect(Scene.text("Could not load hosts.")).toExist(),
        Scene.expect(Scene.testId("rail-latency")).not.toExist()
      );
    });

    test("an empty successful answer keeps its empty-state copy", () => {
      show(
        settled({
          summary: SummaryAsyncData.Success({
            data: summaryData(summaryResponse({ hosts: [] })),
          }),
          outages: OutagesAsyncData.Success({ data: outagesData() }),
        }),
        Scene.expect(Scene.text("No host data in this range.")).toExist(),
        Scene.expect(Scene.text("No incidents in this range.")).toExist(),
        Scene.expect(Scene.text(/Could not load/)).not.toExist()
      );
    });
  });

  describe("answers for another range", () => {
    const allTimeRequest = (earliestMs: number) => ({
      dateRange: Preset({ preset: "allTime" }),
      maybeEarliestDataMs: Option.some(earliestMs),
    });
    const onAllTime = (answeredEarliestMs: number, knownEarliestMs: number) =>
      settled({
        dateRange: Preset({ preset: "allTime" }),
        maybeEarliestDataMs: Option.some(knownEarliestMs),
        isEarliestDataSettled: true,
        summary: SummaryAsyncData.Success({
          data: summaryData(
            summaryResponse(),
            allTimeRequest(answeredEarliestMs)
          ),
        }),
        outages: OutagesAsyncData.Success({
          data: outagesData(outagesResponse(), {
            request: allTimeRequest(answeredEarliestMs),
          }),
        }),
      });

    test("an All time answer fetched from another earliest sample is not shown for this one", () => {
      show(
        onAllTime(1_000, 2_000),
        Scene.expect(Scene.testId("rail-latency")).not.toExist(),
        Scene.expect(
          Scene.role("status", { name: "Loading latency p50" })
        ).toExist(),
        Scene.expect(
          Scene.role("status", { name: "Loading incidents" })
        ).toExist(),
        Scene.expect(Scene.testId("incident-log")).not.toExist()
      );
    });

    test("an All time answer fetched from the earliest sample now known is shown", () => {
      show(
        onAllTime(2_000, 2_000),
        Scene.expect(Scene.testId("rail-latency")).toExist(),
        Scene.expect(Scene.testId("incident-log")).toExist()
      );
    });

    test("the 24 hour, 7 day and 30 day uptime stay up while the selected range loads", () => {
      show(
        settled({
          summary: SummaryAsyncData.Success({
            data: summaryData(summaryResponse(), {
              dateRange: Preset({ preset: "last7d" }),
              maybeEarliestDataMs: Option.none(),
            }),
          }),
        }),
        Scene.expect(Scene.testId("rail-latency")).not.toExist(),
        Scene.expect(Scene.testId("uptime-last24h")).toContainText("99.90"),
        Scene.expect(Scene.testId("uptime-last30d")).toContainText("99.60")
      );
    });
  });

  describe("uptime", () => {
    test("shows the 24 hour, 7 day and 30 day windows and says how a check is counted", () => {
      show(
        settled(),
        Scene.expect(Scene.testId("uptime-last24h")).toContainText("99.90"),
        Scene.expect(Scene.testId("uptime-last7d")).toContainText("99.40"),
        Scene.expect(Scene.testId("uptime-last30d")).toContainText("99.60"),
        Scene.expect(
          Scene.text(
            "A check counts as up when every host answers with under 10% packet loss, down when no host answers, and degraded otherwise."
          )
        ).toExist()
      );
    });

    test("sits in the status field as a compact row under the outage summary", () => {
      show(
        settled(),
        Scene.expect(
          Scene.selector(
            '[aria-label="Live status and range uptime"] [data-testid="uptime-last7d"]'
          )
        ).toExist()
      );
    });

    test("carries no change of its own, since the windows are fixed", () => {
      show(
        settled(),
        Scene.expect(
          Scene.selector('[data-testid="uptime-last7d"] p[data-delta]')
        ).not.toExist()
      );
    });
  });

  describe("incidents", () => {
    const logged = (
      outages: ReadonlyArray<ReturnType<typeof outageFixture>>,
      isClamped = false
    ) =>
      settled({
        outages: OutagesAsyncData.Success({
          data: outagesData(outagesResponse(outages), { isClamped }),
        }),
      });

    test("lists each incident in a table, lettered oldest first, newest on top", () => {
      show(
        logged([
          outageFixture({
            start: "2026-07-27T20:00:00.000Z",
            end: "2026-07-27T21:00:00.000Z",
            durationSeconds: 3600,
            status: "degraded",
            affectedHosts: ["8.8.8.8"],
            maxPacketLoss: 25,
            peakLatency: 61.4,
          }),
          outageFixture(),
        ]),
        Scene.expect(Scene.testId("incident-row-B")).toContainText("1h"),
        Scene.expect(Scene.testId("incident-row-B")).toContainText("Degraded"),
        Scene.expect(Scene.testId("incident-row-B")).toContainText("8.8.8.8"),
        Scene.expect(Scene.testId("incident-row-B")).toContainText("25%"),
        Scene.expect(Scene.testId("incident-row-B")).toContainText("61 ms"),
        Scene.expect(Scene.testId("incident-row-A")).toContainText("6m 30s"),
        Scene.expect(Scene.testId("incident-row-A")).toContainText("Down"),
        Scene.expect(Scene.testId("incident-row-A")).toContainText(
          "All 2 hosts"
        ),
        Scene.expect(Scene.testId("incident-row-A")).toContainText("100%"),
        Scene.expect(Scene.testId("incident-row-A")).toContainText("-")
      );
    });

    test("shows the loading state instead of the previous range's incidents until the new range's log lands", () => {
      const previousRange = {
        dateRange: Preset({ preset: "last24h" }),
        maybeEarliestDataMs: Option.none<number>(),
      };
      show(
        settled({
          outages: OutagesAsyncData.Refreshing({
            data: outagesData(outagesResponse([outageFixture()]), {
              request: previousRange,
            }),
          }),
        }),
        Scene.expect(Scene.testId("incident-row-A")).not.toExist(),
        Scene.expect(Scene.testId("incident-log")).not.toExist(),
        Scene.expect(Scene.label("Loading incidents")).toExist()
      );
    });

    test("names its columns", () => {
      show(
        logged([outageFixture()]),
        Scene.expect(Scene.role("columnheader", { name: "Ref" })).toExist(),
        Scene.expect(Scene.role("columnheader", { name: "Start" })).toExist(),
        Scene.expect(Scene.role("columnheader", { name: "End" })).toExist(),
        Scene.expect(
          Scene.role("columnheader", { name: "Duration" })
        ).toExist(),
        Scene.expect(Scene.role("columnheader", { name: "Status" })).toExist(),
        Scene.expect(Scene.role("columnheader", { name: "Hosts" })).toExist(),
        Scene.expect(
          Scene.role("columnheader", { name: "Max loss" })
        ).toExist(),
        Scene.expect(
          Scene.role("columnheader", { name: "Peak latency" })
        ).toExist()
      );
    });

    test("shows a running incident with no end and a duration of Ongoing", () => {
      show(
        {
          ...logged([
            outageFixture({
              start: "2026-07-28T11:30:00.000Z",
              end: "2026-07-28T12:00:00.000Z",
              durationSeconds: 1800,
              status: "degraded",
            }),
          ]),
          liveConnectivity: liveConnectivity("degraded"),
        },
        Scene.expect(Scene.testId("incident-row-A")).toContainText("Ongoing"),
        Scene.expect(Scene.testId("incident-row-A")).not.toContainText("30m")
      );
    });

    test("shows a running incident's missing end as a plain dash", () => {
      show(
        {
          ...logged([
            outageFixture({
              start: "2026-07-28T11:30:00.000Z",
              end: "2026-07-28T12:00:00.000Z",
              durationSeconds: 1800,
              status: "degraded",
              peakLatency: 80,
            }),
          ]),
          liveConnectivity: liveConnectivity("degraded"),
        },
        Scene.expect(Scene.testId("incident-row-A")).toContainText("-"),
        Scene.expect(Scene.testId("incident-row-A")).not.toContainText("—")
      );
    });

    test("words a running incident's phone card as when it began, with no end", () => {
      show(
        {
          ...logged([
            outageFixture({
              start: "2026-07-28T11:30:00.000Z",
              end: "2026-07-28T12:00:00.000Z",
              durationSeconds: 1800,
              status: "degraded",
              peakLatency: 80,
            }),
          ]),
          liveConnectivity: liveConnectivity("degraded"),
        },
        Scene.expect(Scene.testId("incident-card-A")).toContainText(
          `Since ${formatDateTime("2026-07-28T11:30:00.000Z")}`
        ),
        Scene.expect(Scene.testId("incident-card-A")).not.toContainText("–"),
        Scene.expect(Scene.testId("incident-card-A")).not.toContainText("—")
      );
    });

    test("summarises the range under the log in a sentence", () => {
      show(
        logged([outageFixture()]),
        Scene.expect(
          Scene.text(
            "1 incident in the last 30 days: 1 outage lasting 7 minutes."
          )
        ).toExist()
      );
    });

    test("says so when the range had no incidents", () => {
      show(
        logged([]),
        Scene.expect(Scene.text("No incidents in this range.")).toExist(),
        Scene.expect(
          Scene.selector('[data-testid="incident-log"] tbody tr')
        ).not.toExist()
      );
    });

    test("says the window actually covered when a clamped range had no incidents", () => {
      show(
        logged([], true),
        Scene.expect(
          Scene.text("No incidents in the newest 90 days.")
        ).toExist(),
        Scene.expect(Scene.text("No incidents in this range.")).not.toExist()
      );
    });

    test("words the summary as the newest 90 days when the log was clamped, not by the wider range", () => {
      show(
        logged([outageFixture()], true),
        Scene.expect(
          Scene.text(
            "1 incident in the newest 90 days: 1 outage lasting 7 minutes."
          )
        ).toExist(),
        Scene.expect(
          Scene.text(
            "1 incident in the last 30 days: 1 outage lasting 7 minutes."
          )
        ).not.toExist()
      );
    });

    test("labels its table for assistive tech", () => {
      show(
        logged([outageFixture()]),
        Scene.expect(
          Scene.role("table", { name: "Incidents in the selected range" })
        ).toExist()
      );
    });

    test("notes when the log was capped", () => {
      show(
        settled({
          outages: OutagesAsyncData.Success({
            data: outagesData({
              ...outagesResponse([outageFixture()]),
              meta: {
                ...outagesResponse().meta,
                count: 1,
                totalCount: 700,
              },
            }),
          }),
        }),
        Scene.expect(
          Scene.text("Showing the newest 1 of 700 incidents.")
        ).toExist()
      );
    });

    test("shows a skeleton while loading, and leaves a failure to the banner", () => {
      show(
        settled({ outages: OutagesAsyncData.Loading() }),
        Scene.expect(
          Scene.role("status", { name: "Loading incidents" })
        ).toExist()
      );
      show(
        settled({ outages: OutagesAsyncData.Failure({ error: "db down" }) }),
        Scene.expect(Scene.testId("incident-log")).not.toExist(),
        Scene.expect(Scene.role("alert")).toContainText("Incidents: db down")
      );
    });
  });

  describe("hosts", () => {
    test("lists each host with its status word and figures", () => {
      show(
        settled(),
        Scene.expect(Scene.testId("host-row-1.1.1.1")).toContainText("Up"),
        Scene.expect(Scene.testId("host-row-1.1.1.1")).toContainText("12.0 ms"),
        Scene.expect(Scene.testId("host-row-8.8.8.8")).toContainText(
          "Degraded"
        ),
        Scene.expect(Scene.testId("host-row-8.8.8.8")).toContainText("99.10%"),
        Scene.expect(Scene.testId("host-card-8.8.8.8")).toExist()
      );
    });

    test("labels its table for assistive tech", () => {
      show(
        settled(),
        Scene.expect(
          Scene.role("table", { name: "Per-host statistics" })
        ).toExist()
      );
    });

    test("marks each host's last status with a glyph beside its word", () => {
      show(
        settled(),
        Scene.expect(
          Scene.selector('[data-testid="host-row-8.8.8.8"] svg')
        ).toHaveAttr("aria-hidden", "true"),
        Scene.expect(Scene.testId("host-row-8.8.8.8")).toContainText("Degraded")
      );
    });

    test("draws each last status with the glyph shape that carries it without colour", () => {
      const circle = (host: string) =>
        Scene.selector(`[data-testid="host-row-${host}"] svg circle`);
      const strike = (host: string) =>
        Scene.selector(`[data-testid="host-row-${host}"] svg line`);
      show(
        settled({
          summary: SummaryAsyncData.Success({
            data: summaryData(
              summaryResponse({
                hosts: [
                  {
                    ...summaryResponse().hosts[0],
                    host: "up.test",
                    lastStatus: "up",
                  },
                  {
                    ...summaryResponse().hosts[0],
                    host: "deg.test",
                    lastStatus: "degraded",
                  },
                  {
                    ...summaryResponse().hosts[0],
                    host: "down.test",
                    lastStatus: "down",
                  },
                ],
              })
            ),
          }),
          pingHosts: PingHostsAsyncData.Success({
            data: hostsResponse(["up.test", "deg.test", "down.test"]),
          }),
        }),
        Scene.expect(circle("up.test")).toHaveClass("fill-up"),
        Scene.expect(strike("up.test")).not.toExist(),
        Scene.expect(circle("deg.test")).toHaveClass("stroke-deg"),
        Scene.expect(circle("deg.test")).toHaveAttr("fill", "url(#wm-hatch)"),
        Scene.expect(strike("deg.test")).not.toExist(),
        Scene.expect(circle("down.test")).toHaveClass("fill-down"),
        Scene.expect(strike("down.test")).toExist()
      );
    });

    test("lists a configured host the summary has no data for, so every configured host has a row", () => {
      show(
        settled({
          pingHosts: PingHostsAsyncData.Success({
            data: hostsResponse(["1.1.1.1", "8.8.8.8", "cloudflare.com"]),
          }),
        }),
        Scene.expect(
          Scene.text("Each host is pinged every 30 seconds.")
        ).toExist(),
        Scene.expect(Scene.testId("host-row-cloudflare.com")).toContainText(
          "No data"
        ),
        Scene.expect(Scene.testId("host-card-cloudflare.com")).toContainText(
          "No data"
        ),
        Scene.expect(
          Scene.selector('[data-testid="host-row-cloudflare.com"] svg circle')
        ).toHaveClass("stroke-nodata")
      );
    });

    test("captions the card with the ping cadence in words", () => {
      show(
        settled(),
        Scene.expect(
          Scene.text("Each host is pinged every 30 seconds.")
        ).toExist(),
        Scene.expect(Scene.text(/2 hosts/)).not.toExist()
      );
    });

    test("calls the share of answered pings 'Pings answered' in the table and the phone cards", () => {
      show(
        settled(),
        Scene.expect(
          Scene.role("columnheader", { name: "Pings answered" })
        ).toExist(),
        Scene.expect(Scene.text("Pings answered", { exact: true })).toExist(),
        Scene.expect(
          Scene.role("columnheader", { name: "Availability" })
        ).not.toExist()
      );
    });

    test("names its columns in full", () => {
      show(
        settled(),
        Scene.expect(
          Scene.role("columnheader", { name: "p50 latency" })
        ).toExist(),
        Scene.expect(
          Scene.role("columnheader", { name: "p95 latency" })
        ).toExist(),
        Scene.expect(
          Scene.role("columnheader", { name: "Packet loss" })
        ).toExist(),
        Scene.expect(
          Scene.role("columnheader", { name: "Last status" })
        ).toExist()
      );
    });

    test("says so when the range has no host data", () => {
      show(
        settled({
          summary: SummaryAsyncData.Success({
            data: summaryData(summaryResponse({ hosts: [] })),
          }),
        }),
        Scene.expect(Scene.text("No host data in this range.")).toExist()
      );
    });
  });

  describe("network quality", () => {
    test("offers the latency chart as all hosts or per host, with the current view checked", () => {
      show(
        settled(),
        Scene.expect(
          Scene.role("radiogroup", { name: "Latency view" })
        ).toExist(),
        Scene.expect(Scene.role("radio", { name: "All hosts" })).toHaveAttr(
          "aria-checked",
          "true"
        ),
        Scene.expect(Scene.role("radio", { name: "Per host" })).toHaveAttr(
          "aria-checked",
          "false"
        )
      );
    });

    test("the card has no subtitle under its heading", () => {
      show(
        settled(),
        Scene.expect(Scene.text("Ping results from all hosts")).not.toExist()
      );
    });

    test("the all-hosts latency row has a legend naming the median and the 95th percentile range", () => {
      show(
        settled(),
        Scene.expect(Scene.text("Median")).toExist(),
        Scene.expect(Scene.text("95th percentile range")).toExist(),
        Scene.expect(Scene.text("Median per host")).not.toExist()
      );
    });

    test("the per-host latency row names its lines as medians per host, without the band's legend", () => {
      show(
        settled({
          latencyView: "perHost",
          hostLatency: HostLatencyAsyncData.Success({
            data: {
              series: [],
              window: {
                startTimeMs: METRICS_WINDOW.startTimeMs,
                endTimeMs: METRICS_WINDOW.endTimeMs,
                granularity: METRICS_WINDOW.granularity,
                request: DEFAULT_REQUEST,
              },
            },
          }),
        }),
        Scene.expect(Scene.text("Median per host")).toExist(),
        Scene.expect(Scene.text("95th percentile range")).not.toExist()
      );
    });

    test("the chart titles are plain names, with the units left to the axes", () => {
      show(
        settled(),
        Scene.expect(
          Scene.text(/Latency · ms|Packet loss · %|Jitter · ms/)
        ).not.toExist(),
        Scene.expect(Scene.text(/p50 line|p95 band/)).not.toExist(),
        Scene.expect(Scene.text("Latency", { exact: true })).toExist(),
        Scene.expect(Scene.text("Jitter", { exact: true })).toExist()
      );
    });

    test("the latency row keeps describing the all-hosts lines until the host series arrive", () => {
      show(
        settled({ latencyView: "perHost" }),
        Scene.expect(Scene.text("95th percentile range")).toExist()
      );
    });

    test("choosing per host switches the view and saves the choice", () => {
      show(
        settled(),
        Scene.click(Scene.role("radio", { name: "Per host" })),
        Scene.Command.expectHas(
          SaveSettings({
            settings: {
              theme: "system",
              dateRange: DEFAULT_DATE_RANGE,
              isPaused: false,
              latencyView: "perHost",
            },
          })
        ),
        Scene.Command.expectHas(
          FetchHostLatency({
            token: "abc123",
            dateRange: DEFAULT_DATE_RANGE,
            maybeEarliestDataMs: Option.none(),
            hosts: ["1.1.1.1", "8.8.8.8"],
          })
        ),
        Scene.Command.resolveAll(
          [SaveSettings, CompletedSaveSettings()],
          [RadioGroup.FocusOption, RadioGroup.Message.CompletedFocusOption()],
          [
            FetchHostLatency,
            FailedFetchHostLatency({
              error: "skip",
              request: DEFAULT_REQUEST,
            }),
          ]
        ),
        resolveAllChartSyncs(),
        Scene.expect(Scene.role("radio", { name: "Per host" })).toHaveAttr(
          "aria-checked",
          "true"
        )
      );
    });

    test("shows a skeleton over the latency chart while the per-host lines load", () => {
      show(
        settled({
          latencyView: "perHost",
          hostLatency: HostLatencyAsyncData.Loading(),
        }),
        Scene.expect(
          Scene.role("status", { name: "Loading latency chart" })
        ).toExist()
      );
    });

    test("shows no skeleton over the latency chart when there are no hosts to fetch", () => {
      show(
        settled({
          latencyView: "perHost",
          pingHosts: PingHostsAsyncData.Success({
            data: hostsResponse([]),
          }),
        }),
        Scene.expect(
          Scene.role("status", { name: "Loading latency chart" })
        ).not.toExist()
      );
    });

    test("shows no skeleton over the latency chart when the host list failed", () => {
      show(
        settled({
          latencyView: "perHost",
          pingHosts: PingHostsAsyncData.Failure({ error: "db down" }),
        }),
        Scene.expect(
          Scene.role("status", { name: "Loading latency chart" })
        ).not.toExist()
      );
    });

    test("names a per-host fetch that failed in the banner", () => {
      show(
        settled({
          latencyView: "perHost",
          hostLatency: HostLatencyAsyncData.Failure({ error: "db down" }),
        }),
        Scene.expect(Scene.role("alert")).toContainText("Host latency: db down")
      );
    });

    test("offers Reset range only while a brush has narrowed the range", () => {
      show(
        settled(),
        Scene.expect(
          Scene.role("button", { name: "Reset range" })
        ).not.toExist()
      );
      show(
        settled({ maybeRangeBeforeBrush: Option.some(DEFAULT_DATE_RANGE) }),
        Scene.expect(Scene.role("button", { name: "Reset range" })).toExist()
      );
    });

    test("resetting restores the range from before the brush", () => {
      show(
        settled({
          dateRange: Custom({
            startTime: "2026-07-28T06:00:00.000Z",
            endTime: "2026-07-28T08:00:00.000Z",
          }),
          maybeRangeBeforeBrush: Option.some(DEFAULT_DATE_RANGE),
        }),
        Scene.click(Scene.role("button", { name: "Reset range" })),
        Scene.Command.expectHas(
          FetchMetrics({
            token: "abc123",
            dateRange: DEFAULT_DATE_RANGE,
            maybeEarliestDataMs: Option.none(),
          })
        ),
        Scene.Command.resolveAll(
          ...RANGE_INSIGHT_RESOLVERS,
          [
            FetchMetrics,
            SucceededFetchMetrics({
              request: DEFAULT_REQUEST,
              metrics: [],
              nowMs: NOW_MS,
              ...METRICS_WINDOW,
            }),
          ],
          [
            FetchSpeedtestHistory,
            SucceededFetchSpeedtestHistory({
              request: DEFAULT_REQUEST,
              history: [],
              ...SPEEDTEST_WINDOW,
            }),
          ],
          [
            FetchConnectivityStatus,
            FailedFetchConnectivityStatus({
              error: "skip",
              request: DEFAULT_REQUEST,
            }),
          ],
          [SaveSettings, CompletedSaveSettings()]
        ),
        resolveRibbonMeasure(DEFAULT_RIBBON_WIDTH_PX),
        resolveAllChartSyncs(),
        Scene.expect(
          Scene.role("button", { name: "Reset range" })
        ).not.toExist()
      );
    });
  });

  describe("speed card", () => {
    const test509 = {
      timestamp: "2026-07-28T11:00:00.000Z",
      download_speed: 509.1,
      upload_speed: 466,
      server_location: "Fremont, CA",
    };
    const last24h = Preset({ preset: "last24h" });
    const last24hWindow = {
      startTimeMs: NOW_MS - 24 * 60 * 60 * 1000,
      endTimeMs: NOW_MS,
      request: { ...DEFAULT_REQUEST, dateRange: last24h },
    };

    test("the card says how often a test runs, from the configured interval", () => {
      show(
        settled({
          pingHosts: PingHostsAsyncData.Success({
            data: { ...hostsResponse(), speedtestIntervalSeconds: 21_600 },
          }),
        }),
        Scene.expect(Scene.text("A test runs every 6 hours.")).toExist()
      );
      show(
        settled(),
        Scene.expect(Scene.text("A test runs every hour.")).toExist()
      );
    });

    test("a range fetched in hourly buckets calls the newest row an average, not a test", () => {
      show(
        settled({
          speedtestHistory: SpeedtestHistoryAsyncData.Success({
            data: [test509],
          }),
        }),
        Scene.expect(
          Scene.text(
            /^Latest hourly average, Jul 28 at .+: 509 Mbps down, 466 Mbps up \(Fremont, CA\)\.$/
          )
        ).toExist(),
        Scene.expect(Scene.text(/^Last test/)).not.toExist(),
        Scene.expect(
          Scene.text(
            "Over 7 days or more, each point averages an hour of tests."
          )
        ).toExist()
      );
    });

    test("a range fetched as raw tests calls the newest row the last test", () => {
      show(
        settled({
          dateRange: last24h,
          maybeSpeedtestWindow: Option.some(last24hWindow),
          speedtestHistory: SpeedtestHistoryAsyncData.Success({
            data: [test509],
          }),
        }),
        Scene.expect(
          Scene.text(
            /^Last test, Jul 28 at .+: 509 Mbps down, 466 Mbps up \(Fremont, CA\)\.$/
          )
        ).toExist(),
        Scene.expect(Scene.text(/Latest .* average/)).not.toExist(),
        Scene.expect(Scene.text(/each point averages/)).not.toExist()
      );
    });

    test("reads each speed with a space before its unit, down then up", () => {
      show(
        settled({
          speedtestHistory: SpeedtestHistoryAsyncData.Success({
            data: [test509],
          }),
        }),
        Scene.expect(Scene.text(/509 Mbps down, 466 Mbps up/)).toExist()
      );
    });
  });

  describe("footer and banner", () => {
    test("the footer says only when the dashboard last updated", () => {
      show(
        { ...settled(), maybeLastUpdatedMs: Option.some(NOW_MS - 3000) },
        Scene.expect(Scene.testId("last-updated")).toHaveText(
          "Updated 3 seconds ago."
        ),
        Scene.expect(Scene.text(/speed test (hourly|every)/)).not.toExist(),
        Scene.expect(Scene.text(/Coverage/)).not.toExist(),
        Scene.expect(Scene.text(/auto-refresh on/)).not.toExist(),
        Scene.expectAll(
          Scene.all.selector('footer span[aria-hidden="true"]')
        ).toBeEmpty()
      );
    });

    test("the footer leaves a paused dashboard to the header chip", () => {
      show(
        settled({ isPaused: true }),
        Scene.expect(Scene.text("Auto-refresh paused")).toExist(),
        Scene.expect(Scene.text("auto-refresh on")).not.toExist(),
        Scene.expect(Scene.text("auto-refresh paused")).not.toExist()
      );
    });

    test("the footer leaves an idle dashboard to the header chip, not saying it is on", () => {
      show(
        settled({ isIdle: true }),
        Scene.expect(Scene.text("Paused after inactivity")).toExist(),
        Scene.expect(Scene.text("auto-refresh on")).not.toExist(),
        Scene.expect(
          Scene.text("auto-refresh paused after inactivity")
        ).not.toExist()
      );
    });

    test("one banner names every new fetch that failed", () => {
      show(
        settled({
          summary: SummaryAsyncData.Failure({ error: "db down" }),
          pingHosts: PingHostsAsyncData.Failure({ error: "db down" }),
        }),
        Scene.expectAll(Scene.all.role("alert")).toHaveCount(1),
        Scene.expect(Scene.role("alert")).toContainText(
          "Summary, Hosts: db down"
        )
      );
    });
  });
});

describe("dashboard view: the clock", () => {
  const model = {
    ...initModel(defaultSettings()),
    liveConnectivity: liveConnectivity("up"),
    maybeLastUpdatedMs: Option.some(NOW_MS - 3000),
  };

  test("the elapsed times advance on a clock tick, with no other message", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(model),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.testId("last-updated")).toHaveText(
        "Updated 3 seconds ago."
      ),
      Scene.expect(Scene.testId("last-sample")).toHaveText(
        "Last checked 30 seconds ago"
      ),
      Scene.Subscription.emit(TickedClock({ nowMs: NOW_MS + 2000 })),
      Scene.expect(Scene.testId("last-updated")).toHaveText(
        "Updated 5 seconds ago."
      ),
      Scene.expect(Scene.testId("last-sample")).toHaveText(
        "Last checked 32 seconds ago"
      )
    );
  });

  test("the views read the time from the model, not the wall clock", () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW_MS + 3_600_000);
    try {
      Scene.scene(
        { update: boundUpdate, view },
        Scene.given(model),
        acknowledgeAllChartMounts(),
        Scene.expect(Scene.testId("last-updated")).toHaveText(
          "Updated 3 seconds ago."
        ),
        Scene.expect(Scene.testId("last-sample")).toHaveText(
          "Last checked 30 seconds ago"
        )
      );
    } finally {
      vi.restoreAllMocks();
    }
  });
});
