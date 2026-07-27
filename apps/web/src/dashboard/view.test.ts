import { Option } from "effect";
import { Scene } from "foldkit";
import { describe, test } from "vitest";
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
  FetchMetrics,
  FetchSpeedtestHistory,
  SaveTheme,
} from "@/dashboard/command";
import {
  CompletedSaveTheme,
  CompletedSyncJitterChart,
  CompletedSyncLatencyChart,
  CompletedSyncPacketLossChart,
  CompletedSyncSpeedChart,
  SucceededFetchConnectivityStatus,
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
  MetricsAsyncData,
  SpeedtestHistoryAsyncData,
  SpeedtestTriggerAsyncData,
} from "@/dashboard/model";
import { update } from "@/dashboard/update";
import { view as dashboardView } from "@/dashboard/view";

const context = { token: "abc123" };
const boundUpdate = (
  model: Parameters<typeof update>[0],
  message: Parameters<typeof update>[1]
) => update(model, message, context);

// Scene.scene's `view` is a plain (model) => Html function; the dashboard
// view also takes viewInputs (the Logout button, supplied by its auth
// parent in production), so tests stand in a no-op placeholder for it.
const view = (model: Parameters<typeof dashboardView>[0]) =>
  dashboardView(model, { renderLogoutButton: () => null });

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
      Scene.with(initModel()),
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
      Scene.with(model),
      acknowledgeAllChartMounts(),
      resolveAllChartSyncs(),
      Scene.expect(Scene.testId("last-updated")).toContainText(/^Updated/),
      Scene.expect(Scene.role("status", { name: "Refreshing" })).toExist()
    );
  });

  test("shows the connectivity, download, and upload summary cards", () => {
    const model = {
      ...initModel(),
      metrics: MetricsAsyncData.Success({
        data: [
          {
            timestamp: "2026-07-26T00:01:00.000Z",
            source: "ping" as const,
            connectivity_status: "up",
          },
        ],
      }),
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
      Scene.with(model),
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
      Scene.with(model),
      acknowledgeAllChartMounts(),
      resolveAllChartSyncs(),
      Scene.expect(Scene.text("Comcast")).toExist(),
      Scene.expect(Scene.text("1.2.3.4", { exact: false })).toExist()
    );
  });

  test("falls back to Unknown ISP with no speed test data", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.with(initModel()),
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
      Scene.with(model),
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
      Scene.with(model),
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
      Scene.with(model),
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
      Scene.with(model),
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
      Scene.with(model),
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
      Scene.with(model),
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
      Scene.with(model),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.testId("connectivity-segment-0")).toExist(),
      Scene.expect(Scene.testId("connectivity-segment-1")).toExist(),
      Scene.expect(Scene.role("tooltip")).not.toExist(),
      Scene.hover(Scene.testId("connectivity-segment-1")),
      Scene.expect(Scene.role("tooltip")).toHaveText(/Down/)
    );
  });

  test("shows a disabled Running… state while the speed test trigger is pending", () => {
    const model = {
      ...initModel(),
      speedtestTrigger: SpeedtestTriggerAsyncData.Loading(),
    };

    Scene.scene(
      { update: boundUpdate, view },
      Scene.with(model),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.role("button", { name: "Running…" })).toExist(),
      Scene.expect(Scene.role("button", { name: "Running…" })).toBeDisabled()
    );
  });

  test("renders a chart host for the latency chart and mounts it", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.with(initModel()),
      Scene.expect(Scene.label("Latency chart")).toExist(),
      acknowledgeAllChartMounts()
    );
  });

  test("renders a chart host for the packet loss chart and mounts it", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.with(initModel()),
      Scene.expect(Scene.label("Packet loss chart")).toExist(),
      acknowledgeAllChartMounts()
    );
  });

  test("renders a chart host for the jitter chart and mounts it", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.with(initModel()),
      Scene.expect(Scene.label("Jitter chart")).toExist(),
      acknowledgeAllChartMounts()
    );
  });

  test("renders a chart host for the speed chart and mounts it", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.with(initModel()),
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
      Scene.with(model),
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
      Scene.with(initModel()),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.role("region")).toExist()
    );
  });

  test("clicking Refresh now force-reloads all three series", () => {
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

    Scene.scene(
      { update: boundUpdate, view },
      Scene.with(model),
      acknowledgeAllChartMounts(),
      resolveAllChartSyncs(),
      Scene.expect(Scene.role("button", { name: "Refresh now" })).toExist(),
      Scene.click(Scene.role("button", { name: "Refresh now" })),
      Scene.Command.expectHas(
        FetchMetrics({ token: "abc123", timeRange: "1h" })
      ),
      Scene.Command.expectHas(
        FetchSpeedtestHistory({ token: "abc123", timeRange: "1h" })
      ),
      Scene.Command.expectHas(
        FetchConnectivityStatus({ token: "abc123", timeRange: "1h" })
      ),
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
        ]
      ),
      resolveAllChartSyncs()
    );
  });

  test("clicking pause toggles the button label to Resume", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.with(initModel()),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.role("button", { name: "Pause" })).toExist(),
      Scene.click(Scene.role("button", { name: "Pause" })),
      Scene.expect(Scene.role("button", { name: "Resume" })).toExist()
    );
  });

  test("going idle shows a distinct resume label, and clicking it resumes without a manual pause", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.with({ ...initModel(), isIdle: true }),
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
      Scene.with(initModel()),
      acknowledgeAllChartMounts(),
      Scene.expect(Scene.role("button", { name: "Dark mode" })).toExist(),
      Scene.expect(Scene.testId("dashboard-root")).not.toHaveClass("dark"),
      Scene.click(Scene.role("button", { name: "Dark mode" })),
      Scene.Command.resolve(SaveTheme, CompletedSaveTheme()),
      Scene.expect(Scene.role("button", { name: "Light mode" })).toExist(),
      Scene.expect(Scene.testId("dashboard-root")).toHaveClass("dark")
    );
  });

  test("clicking a time range button changes the selected range", () => {
    Scene.scene(
      { update: boundUpdate, view },
      Scene.with(initModel()),
      acknowledgeAllChartMounts(),
      Scene.click(Scene.role("button", { name: "24 Hours" })),
      Scene.Command.expectHas(
        FetchMetrics({ token: "abc123", timeRange: "24h" })
      ),
      Scene.Command.expectHas(
        FetchSpeedtestHistory({ token: "abc123", timeRange: "24h" })
      ),
      Scene.Command.expectHas(
        FetchConnectivityStatus({ token: "abc123", timeRange: "24h" })
      ),
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
        ]
      ),
      resolveAllChartSyncs(),
      Scene.expect(Scene.role("button", { name: "24 Hours" })).toHaveAttr(
        "aria-pressed",
        "true"
      )
    );
  });
});
