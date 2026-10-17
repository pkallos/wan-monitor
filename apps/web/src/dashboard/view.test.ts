import { Menu, Popover } from "@foldkit/ui";
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
  FetchLiveConnectivity,
  FetchMetrics,
  FetchSpeedtestHistory,
  SaveSettings,
} from "@/dashboard/command";
import {
  formatDateRangeLabel,
  getDateRangeWindow,
  Preset,
} from "@/dashboard/dateRange";
import {
  CompletedApplyTheme,
  CompletedSaveSettings,
  CompletedSyncJitterChart,
  CompletedSyncLatencyChart,
  CompletedSyncPacketLossChart,
  CompletedSyncSpeedChart,
  FailedFetchConnectivityStatus,
  FailedFetchLiveConnectivity,
  SucceededFetchConnectivityStatus,
  SucceededFetchLiveConnectivity,
  SucceededFetchMetrics,
  SucceededFetchSpeedtestHistory,
  SucceededMountJitterChart,
  SucceededMountLatencyChart,
  SucceededMountPacketLossChart,
  SucceededMountSpeedChart,
} from "@/dashboard/message";
import {
  ConnectivityStatusAsyncData,
  initModel,
  LiveConnectivityAsyncData,
  MetricsAsyncData,
  SpeedtestHistoryAsyncData,
  SpeedtestTriggerAsyncData,
} from "@/dashboard/model";
import { update } from "@/dashboard/update";
import { view as dashboardView } from "@/dashboard/view";
import { defaultSettings } from "@/storage";

const NOW_MS = Date.parse("2026-07-28T12:00:00.000Z");
const DEFAULT_DATE_RANGE = Preset({ preset: "last30d" });
const DEFAULT_REQUEST = {
  dateRange: DEFAULT_DATE_RANGE,
  maybeEarliestDataMs: Option.none<number>(),
};

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

const acknowledgeAllChartMounts = () =>
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
    [MountSpeedChart, SucceededMountSpeedChart({ hostId: SPEED_CHART_HOST_ID })]
  );

const liveConnectivity = (
  status: "up" | "degraded" | "down" | "noInfo",
  maybeLastSampleAtMs = Option.some(NOW_MS - 30_000)
) =>
  LiveConnectivityAsyncData.Success({
    data: { status, maybeLastSampleAtMs },
  });

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
      Scene.expect(Scene.role("status", { name: "Loading latency" })).toExist(),
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
      Scene.expect(Scene.text("Last test · none yet")).not.toExist()
    );
  });

  test("says no speed test has run once the history has loaded empty", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given({
        ...initModel(defaultSettings()),
        speedtestHistory: SpeedtestHistoryAsyncData.Success({ data: [] }),
      }),
      acknowledgeAllChartMounts(),
      resolveAllChartSyncs(),
      Scene.expect(Scene.text("Last test · none yet")).toExist()
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

  test("shows the status headline and the hero figures", () => {
    const model = {
      ...initModel(defaultSettings()),
      liveConnectivity: liveConnectivity("up"),
      speedtestHistory: SpeedtestHistoryAsyncData.Success({
        data: [
          {
            timestamp: "2026-07-26T00:01:00.000Z",
            download_speed: 123.4,
            upload_speed: 12.3,
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
      Scene.expect(Scene.text("Connection is healthy.")).toExist(),
      Scene.expect(Scene.text("Online")).toExist(),
      Scene.expect(Scene.testId("hero-speed")).toContainText("123 / 12.3"),
      Scene.expect(Scene.testId("hero-speed")).toContainText("Mbps"),
      Scene.expect(Scene.testId("hero-availability")).toExist(),
      Scene.expect(Scene.testId("hero-latency")).toExist()
    );
  });

  test("shows the availability and average latency the loaded data produces", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given({
        ...initModel(defaultSettings()),
        metrics: MetricsAsyncData.Success({
          data: [
            {
              timestamp: "2026-07-26T00:00:00.000Z",
              source: "ping",
              latency: 10,
            },
            {
              timestamp: "2026-07-26T00:01:00.000Z",
              source: "ping",
              latency: 30,
            },
          ],
        }),
        connectivityStatus: ConnectivityStatusAsyncData.Success({
          data: {
            points: [],
            maybeUptimePercentage: Option.some(99.6),
            maybeAvailabilityPercentage: Option.some(99.9),
            coveragePercentage: 100,
            startTimeMs: 0,
            endTimeMs: 3_600_000,
            granularity: "1m" as const,
          },
        }),
      }),
      acknowledgeAllChartMounts(),
      resolveAllChartSyncs(),
      Scene.expect(Scene.testId("hero-availability")).toContainText("99.9"),
      Scene.expect(Scene.testId("hero-latency")).toContainText("20.0"),
      Scene.expect(Scene.testId("hero-latency")).toContainText("avg"),
      Scene.expect(Scene.text("99.6% uptime over the last 30 days.")).toExist()
    );
  });

  test("sums up a degraded or down connection in plain words", () => {
    for (const [status, headline] of [
      ["degraded", "Connection is degraded."],
      ["down", "Connection is down."],
      ["noInfo", "No recent data."],
    ] as const) {
      Scene.scene(
        { update: boundUpdate, view },
        Scene.given({
          ...initModel(defaultSettings()),
          liveConnectivity: liveConnectivity(status),
        }),
        acknowledgeAllChartMounts(),
        Scene.expect(Scene.text(headline)).toExist()
      );
    }
  });

  test("says how long ago the last sample was taken", () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW_MS);
    try {
      Scene.scene(
        { update: boundUpdate, view },
        Scene.given({
          ...initModel(defaultSettings()),
          liveConnectivity: liveConnectivity("up"),
        }),
        acknowledgeAllChartMounts(),
        Scene.expect(Scene.text("last sample 30s ago")).toExist()
      );
    } finally {
      vi.restoreAllMocks();
    }
  });

  test.each([
    ["up", "Online"],
    ["degraded", "Degraded"],
    ["down", "Offline"],
    ["noInfo", "No Data"],
  ] as const)("renders the %s live status as %s", (status, label) => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given({
        ...initModel(defaultSettings()),
        liveConnectivity: liveConnectivity(status),
      }),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.text(label)).toExist()
    );
  });

  test.each([
    ["up", "text-up"],
    ["degraded", "text-deg-text"],
    ["down", "text-down"],
    ["noInfo", "text-ink-2"],
  ] as const)(
    "pairs the %s live status word with an icon in the %s tone",
    (status, toneClass) => {
      Scene.scene(
        { update: boundUpdate, view },
        Scene.given({
          ...initModel(defaultSettings()),
          liveConnectivity: liveConnectivity(status),
        }),
        acknowledgeAllChartMounts(),
        Scene.expect(
          Scene.selector(`span.${toneClass} svg[aria-hidden="true"]`)
        ).toExist()
      );
    }
  );

  test("shows the latest speed test in the hero without a status icon", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given({
        ...initModel(defaultSettings()),
        speedtestHistory: SpeedtestHistoryAsyncData.Success({
          data: [
            {
              timestamp: "2026-07-26T00:01:00.000Z",
              download_speed: 123.4,
              upload_speed: 12.3,
              latency: 8,
            },
          ],
        }),
      }),
      acknowledgeAllChartMounts(),
      resolveAllChartSyncs(),
      Scene.expect(Scene.testId("hero-speed")).toContainText("123 / 12.3"),
      Scene.expect(Scene.testId("hero-speed")).not.toContainText("Online")
    );
  });

  test("shows Checking… until the first live response lands", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given({
        ...initModel(defaultSettings()),
        liveConnectivity: LiveConnectivityAsyncData.Loading(),
      }),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.text("Checking…")).toExist(),
      Scene.expect(Scene.text("No Data")).not.toExist()
    );
  });

  test("renders a failed live fetch as No Data, never as an outage", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given({
        ...initModel(defaultSettings()),
        liveConnectivity: LiveConnectivityAsyncData.Failure({
          error: "network error",
        }),
      }),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.text("No Data")).toExist(),
      Scene.expect(Scene.text("Offline")).not.toExist()
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
      Scene.expect(Scene.text("Comcast")).toExist(),
      Scene.expect(Scene.text("1.2.3.4", { exact: false })).toExist()
    );
  });

  test("falls back to Unknown ISP with no speed test data", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(initModel(defaultSettings())),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.text("Unknown ISP")).toExist()
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
        },
      }),
    };

    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(model),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.text("Uptime: 100.0%")).toExist(),
      Scene.expect(Scene.role("alert")).toContainText(
        "Availability: network error"
      )
    );
  });

  test("renders one connectivity segment per distinct status and hovering shows its tooltip", () => {
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

  test("shows average/max download and upload speed stats", () => {
    const model = {
      ...initModel(defaultSettings()),
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
      Scene.expect(Scene.text("Avg Download")).toExist(),
      Scene.expect(Scene.text("150.0 Mbps")).toExist(),
      Scene.expect(Scene.text("Avg Upload")).toExist(),
      Scene.expect(Scene.text("30.0 Mbps")).toExist(),
      Scene.expect(Scene.text("Max Download")).toExist(),
      Scene.expect(Scene.text("200.0 Mbps")).toExist(),
      Scene.expect(Scene.text("Max Upload")).toExist(),
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

  test("clicking pause toggles the button label to Resume and persists it", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(initModel(defaultSettings())),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.role("button", { name: "Pause" })).toExist(),
      Scene.click(Scene.role("button", { name: "Pause" })),
      Scene.Command.resolve(SaveSettings, CompletedSaveSettings()),
      Scene.expect(Scene.role("button", { name: "Resume" })).toExist()
    );
  });

  test("going idle shows a distinct resume label, and clicking it resumes without a manual pause", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given({ ...initModel(defaultSettings()), isIdle: true }),
      acknowledgeAllChartMounts(),
      Scene.expect(
        Scene.role("button", { name: "Resume (paused, inactive)" })
      ).toExist(),
      Scene.click(Scene.role("button", { name: "Resume (paused, inactive)" })),
      Scene.expect(Scene.role("button", { name: "Pause" })).toExist()
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
      Scene.expect(Scene.text("Live updates paused")).toExist()
    );
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(initModel(defaultSettings())),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.text("Live updates paused")).not.toExist()
    );
  });

  test("keys the availability timeline with a pattern-backed legend", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(initModel(defaultSettings())),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.text("Up")).toExist(),
      Scene.expect(Scene.text("Down")).toExist(),
      Scene.expect(Scene.text("No data")).toExist(),
      Scene.expect(Scene.selector("span.pattern-hatch")).toExist(),
      Scene.expect(Scene.selector("span.pattern-dots")).toExist()
    );
  });

  test("ends the speed tests card with the last test and the run button", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given({
        ...initModel(defaultSettings()),
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
      Scene.expect(Scene.text("Fremont, CA", { exact: false })).toExist(),
      Scene.expect(Scene.text("941 / 917")).toExist(),
      Scene.expect(Scene.role("button", { name: "Run Speed Test" })).toExist()
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
          },
        })
      ),
      Scene.Command.resolveAll(
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
    vi.spyOn(Date, "now").mockReturnValue(NOW_MS);

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
