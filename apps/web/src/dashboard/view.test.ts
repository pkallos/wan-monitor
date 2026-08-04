import { Popover } from "@foldkit/ui";
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
  FetchConnectivityStatus,
  FetchLiveConnectivity,
  FetchMetrics,
  FetchSpeedtestHistory,
  SaveTheme,
} from "@/dashboard/command";
import {
  formatDateRangeLabel,
  getDateRangeWindow,
  Preset,
} from "@/dashboard/dateRange";
import {
  CompletedSaveTheme,
  CompletedSyncJitterChart,
  CompletedSyncLatencyChart,
  CompletedSyncPacketLossChart,
  CompletedSyncSpeedChart,
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

const NOW_MS = Date.parse("2026-07-28T12:00:00.000Z");
const DEFAULT_DATE_RANGE = Preset({ preset: "last30d" });

const context = { token: "abc123", now: () => NOW_MS };
const boundUpdate = (
  model: Parameters<typeof update>[0],
  message: Parameters<typeof update>[1]
) => update(model, message, context);

// The dashboard view takes viewInputs (the Logout button, supplied by its
// auth parent in production); tests stand in a no-op placeholder for it.
const view = Scene.withViewInputs(dashboardView, {
  renderLogoutButton: () => null,
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

const resolveAllChartSyncs = () =>
  Scene.Command.resolveAll(
    [SyncLatencyChart, CompletedSyncLatencyChart()],
    [SyncPacketLossChart, CompletedSyncPacketLossChart()],
    [SyncJitterChart, CompletedSyncJitterChart()],
    [SyncSpeedChart, CompletedSyncSpeedChart()]
  );

describe("dashboard view", () => {
  test("shows a loading indicator while metrics are idle", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(initModel()),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.text("Loading metrics…")).toExist()
    );
  });

  test("shows when the data was last updated, and a spinner while refreshing", () => {
    const model = {
      ...initModel(),
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

  test("shows the connectivity, download, and upload summary cards", () => {
    const model = {
      ...initModel(),
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
      Scene.expect(Scene.text("Connectivity")).toExist(),
      Scene.expect(Scene.text("Online")).toExist(),
      Scene.expect(Scene.text("Download Speed")).toExist(),
      Scene.expect(Scene.text("123.4 Mbps")).toExist(),
      Scene.expect(Scene.text("Upload Speed")).toExist(),
      Scene.expect(Scene.text("12.3 Mbps")).toExist()
    );
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
        ...initModel(),
        liveConnectivity: liveConnectivity(status),
      }),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.text(label)).toExist()
    );
  });

  test("shows Checking… until the first live response lands", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given({
        ...initModel(),
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
        ...initModel(),
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
      ...initModel(),
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
      ...initModel(),
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
      Scene.given(initModel()),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.text("Unknown ISP")).toExist()
    );
  });

  test("shows an alert with the error when metrics fail", () => {
    const model = {
      ...initModel(),
      metrics: MetricsAsyncData.Failure({ error: "network error" }),
    };

    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(model),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.role("alert")).toHaveText(
        "Metrics error: network error"
      )
    );
  });

  test("shows an alert with the error when speed test history fails", () => {
    const model = {
      ...initModel(),
      speedtestHistory: SpeedtestHistoryAsyncData.Failure({
        error: "network error",
      }),
    };

    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(model),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.role("alert")).toHaveText(
        "Speed test history error: network error"
      )
    );
  });

  test("shows an alert with the error when connectivity status fails", () => {
    const model = {
      ...initModel(),
      connectivityStatus: ConnectivityStatusAsyncData.Failure({
        error: "network error",
      }),
    };

    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(model),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.role("alert")).toHaveText(
        "Connectivity status error: network error"
      )
    );
  });

  test("shows an alert with the error when a metrics refresh fails but stale data still renders", () => {
    const model = {
      ...initModel(),
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
      Scene.expect(Scene.role("alert")).toHaveText(
        "Metrics error: network error"
      )
    );
  });

  test("shows an alert with the error when a speed test history refresh fails but stale data still renders", () => {
    const model = {
      ...initModel(),
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
      Scene.expect(Scene.role("alert")).toHaveText(
        "Speed test history error: network error"
      )
    );
  });

  test("shows an alert with the error when a connectivity status refresh fails but stale data still renders", () => {
    const model = {
      ...initModel(),
      connectivityStatus: ConnectivityStatusAsyncData.Stale({
        error: "network error",
        data: {
          points: [],
          uptimePercentage: 100,
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
      Scene.expect(Scene.role("alert")).toHaveText(
        "Connectivity status error: network error"
      )
    );
  });

  test("renders one connectivity segment per distinct status and hovering shows its tooltip", () => {
    const startTimeMs = Date.parse("2026-07-26T10:00:00.000Z");
    const model = {
      ...initModel(),
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
          uptimePercentage: 50,
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
      Scene.expect(Scene.testId("connectivity-segment-0")).toExist(),
      Scene.expect(Scene.testId("connectivity-segment-1")).toExist(),
      Scene.expect(Scene.role("tooltip")).not.toExist(),
      Scene.hover(Scene.testId("connectivity-segment-1")),
      Scene.expect(Scene.role("tooltip")).toHaveText(/Down/)
    );
  });

  test("tapping a connectivity segment shows its tooltip, and tapping it again dismisses it", () => {
    const startTimeMs = Date.parse("2026-07-26T10:00:00.000Z");
    const model = {
      ...initModel(),
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
          uptimePercentage: 50,
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
      ...initModel(),
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
      Scene.given(initModel()),
      Scene.expect(Scene.label("Latency chart")).toExist(),
      acknowledgeAllChartMounts()
    );
  });

  test("renders a chart host for the packet loss chart and mounts it", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(initModel()),
      Scene.expect(Scene.label("Packet loss chart")).toExist(),
      acknowledgeAllChartMounts()
    );
  });

  test("renders a chart host for the jitter chart and mounts it", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(initModel()),
      Scene.expect(Scene.label("Jitter chart")).toExist(),
      acknowledgeAllChartMounts()
    );
  });

  test("renders a chart host for the speed chart and mounts it", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(initModel()),
      Scene.expect(Scene.label("Speed chart")).toExist(),
      acknowledgeAllChartMounts()
    );
  });

  test("shows average/max download and upload speed stats", () => {
    const model = {
      ...initModel(),
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
      Scene.given(initModel()),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.role("region")).toExist()
    );
  });

  test("clicking Refresh now force-reloads every series", () => {
    const model = {
      ...initModel(),
      metrics: MetricsAsyncData.Success({ data: [] }),
      speedtestHistory: SpeedtestHistoryAsyncData.Success({ data: [] }),
      connectivityStatus: ConnectivityStatusAsyncData.Success({
        data: {
          points: [],
          uptimePercentage: 100,
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
        [FetchMetrics, SucceededFetchMetrics({ metrics: [], nowMs: 0 })],
        [
          FetchSpeedtestHistory,
          SucceededFetchSpeedtestHistory({ history: [] }),
        ],
        [
          FetchConnectivityStatus,
          SucceededFetchConnectivityStatus({
            points: [],
            uptimePercentage: 100,
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

  test("clicking pause toggles the button label to Resume", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(initModel()),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.role("button", { name: "Pause" })).toExist(),
      Scene.click(Scene.role("button", { name: "Pause" })),
      Scene.expect(Scene.role("button", { name: "Resume" })).toExist()
    );
  });

  test("going idle shows a distinct resume label, and clicking it resumes without a manual pause", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given({ ...initModel(), isIdle: true }),
      acknowledgeAllChartMounts(),
      Scene.expect(
        Scene.role("button", { name: "Resume (paused, inactive)" })
      ).toExist(),
      Scene.click(Scene.role("button", { name: "Resume (paused, inactive)" })),
      Scene.expect(Scene.role("button", { name: "Pause" })).toExist()
    );
  });

  test("clicking the theme toggle switches to dark mode, applies the dark class, and persists it", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.given(initModel()),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.role("button", { name: "Dark mode" })).toExist(),
      Scene.expect(Scene.testId("dashboard-root")).not.toHaveClass("dark"),
      Scene.click(Scene.role("button", { name: "Dark mode" })),
      Scene.Command.resolve(SaveTheme, CompletedSaveTheme()),
      Scene.expect(Scene.role("button", { name: "Light mode" })).toExist(),
      Scene.expect(Scene.testId("dashboard-root")).toHaveClass("dark")
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
      ...initModel(),
      metrics: MetricsAsyncData.Success({ data: [] }),
      speedtestHistory: SpeedtestHistoryAsyncData.Success({ data: [] }),
      connectivityStatus: ConnectivityStatusAsyncData.Success({
        data: {
          points: [],
          uptimePercentage: 100,
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
          [Popover.AnchorPopover, Popover.CompletedAnchorPopover()],
          [
            Popover.PortalPopoverBackdrop,
            Popover.CompletedPortalPopoverBackdrop(),
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
          [FetchMetrics, SucceededFetchMetrics({ metrics: [], nowMs: NOW_MS })],
          [
            FetchSpeedtestHistory,
            SucceededFetchSpeedtestHistory({ history: [] }),
          ],
          [
            FetchConnectivityStatus,
            SucceededFetchConnectivityStatus({
              points: [],
              uptimePercentage: 100,
              startTimeMs: 0,
              endTimeMs: 3_600_000,
              granularity: "1m",
            }),
          ]
        ),
        resolveAllChartSyncs(),
        Scene.Command.resolve(
          Popover.FocusButton,
          Popover.CompletedFocusButton()
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
