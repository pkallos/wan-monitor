import {
  ConnectivityStatusPointSchema,
  LiveConnectivityStatusSchema,
} from "@shared/api/routes/connectivity-status";
import { GranularitySchema, MetricSchema } from "@shared/api/routes/metrics";
import { SpeedMetricSchema } from "@shared/api/routes/speedtest";
import { Schema as S } from "effect";
import { m } from "foldkit/message";
import * as DateRangePicker from "@/dashboard/dateRangePicker";
import { Theme } from "@/dashboard/theme";
import { Toast } from "@/dashboard/toast";

export const SucceededFetchMetrics = m("SucceededFetchMetrics", {
  metrics: S.Array(MetricSchema),
  nowMs: S.Number,
});
export const FailedFetchMetrics = m("FailedFetchMetrics", {
  error: S.String,
});

export const SucceededFetchSpeedtestHistory = m(
  "SucceededFetchSpeedtestHistory",
  { history: S.Array(SpeedMetricSchema) }
);
export const FailedFetchSpeedtestHistory = m("FailedFetchSpeedtestHistory", {
  error: S.String,
});

export const SucceededFetchConnectivityStatus = m(
  "SucceededFetchConnectivityStatus",
  {
    points: S.Array(ConnectivityStatusPointSchema),
    maybeUptimePercentage: S.Option(S.Number),
    coveragePercentage: S.Number,
    startTimeMs: S.Number,
    endTimeMs: S.Number,
    granularity: GranularitySchema,
  }
);
export const FailedFetchConnectivityStatus = m(
  "FailedFetchConnectivityStatus",
  { error: S.String }
);

export const SucceededFetchLiveConnectivity = m(
  "SucceededFetchLiveConnectivity",
  {
    status: LiveConnectivityStatusSchema,
    maybeLastSampleAtMs: S.Option(S.Number),
  }
);
export const FailedFetchLiveConnectivity = m("FailedFetchLiveConnectivity", {
  error: S.String,
});

export const SucceededTriggerSpeedtest = m("SucceededTriggerSpeedtest", {
  downloadMbps: S.Number,
  uploadMbps: S.Number,
  pingMs: S.Number,
});
export const FailedTriggerSpeedtest = m("FailedTriggerSpeedtest", {
  message: S.String,
  isAlreadyRunning: S.Boolean,
});

export const HoveredConnectivitySegment = m("HoveredConnectivitySegment", {
  index: S.Number,
});
export const UnhoveredConnectivitySegment = m("UnhoveredConnectivitySegment");

export const SucceededFetchEarliestData = m("SucceededFetchEarliestData", {
  earliestMs: S.Option(S.Number),
});
export const FailedFetchEarliestData = m("FailedFetchEarliestData", {
  error: S.String,
});

export const LoadedTheme = m("LoadedTheme", { theme: Theme });
export const ClickedToggleTheme = m("ClickedToggleTheme");
export const CompletedSaveTheme = m("CompletedSaveTheme");
export const FailedSaveTheme = m("FailedSaveTheme", { error: S.String });

export const GotToastMessage = m("GotToastMessage", {
  message: Toast.Message,
});

export const EnteredDashboard = m("EnteredDashboard");
export const TickedRefresh = m("TickedRefresh");
export const ClickedTogglePause = m("ClickedTogglePause");
export const Interacted = m("Interacted");
export const WentIdle = m("WentIdle");
export const GotDateRangePickerMessage = m("GotDateRangePickerMessage", {
  message: DateRangePicker.Message,
});
export const ClickedTriggerSpeedtest = m("ClickedTriggerSpeedtest");
export const ClickedRefreshNow = m("ClickedRefreshNow");

export const SucceededMountLatencyChart = m("SucceededMountLatencyChart", {
  hostId: S.String,
});
export const FailedMountLatencyChart = m("FailedMountLatencyChart", {
  reason: S.String,
});
export const CompletedSyncLatencyChart = m("CompletedSyncLatencyChart");
export const FailedSyncLatencyChart = m("FailedSyncLatencyChart", {
  reason: S.String,
});

export const SucceededMountPacketLossChart = m(
  "SucceededMountPacketLossChart",
  { hostId: S.String }
);
export const FailedMountPacketLossChart = m("FailedMountPacketLossChart", {
  reason: S.String,
});
export const CompletedSyncPacketLossChart = m("CompletedSyncPacketLossChart");
export const FailedSyncPacketLossChart = m("FailedSyncPacketLossChart", {
  reason: S.String,
});

export const SucceededMountJitterChart = m("SucceededMountJitterChart", {
  hostId: S.String,
});
export const FailedMountJitterChart = m("FailedMountJitterChart", {
  reason: S.String,
});
export const CompletedSyncJitterChart = m("CompletedSyncJitterChart");
export const FailedSyncJitterChart = m("FailedSyncJitterChart", {
  reason: S.String,
});

export const SucceededMountSpeedChart = m("SucceededMountSpeedChart", {
  hostId: S.String,
});
export const FailedMountSpeedChart = m("FailedMountSpeedChart", {
  reason: S.String,
});
export const CompletedSyncSpeedChart = m("CompletedSyncSpeedChart");
export const FailedSyncSpeedChart = m("FailedSyncSpeedChart", {
  reason: S.String,
});

export const Message = S.Union([
  SucceededFetchMetrics,
  FailedFetchMetrics,
  SucceededFetchSpeedtestHistory,
  FailedFetchSpeedtestHistory,
  SucceededFetchConnectivityStatus,
  FailedFetchConnectivityStatus,
  SucceededFetchLiveConnectivity,
  FailedFetchLiveConnectivity,
  SucceededTriggerSpeedtest,
  FailedTriggerSpeedtest,
  SucceededFetchEarliestData,
  FailedFetchEarliestData,
  HoveredConnectivitySegment,
  UnhoveredConnectivitySegment,
  LoadedTheme,
  ClickedToggleTheme,
  CompletedSaveTheme,
  FailedSaveTheme,
  GotToastMessage,
  EnteredDashboard,
  TickedRefresh,
  ClickedTogglePause,
  Interacted,
  WentIdle,
  GotDateRangePickerMessage,
  ClickedTriggerSpeedtest,
  ClickedRefreshNow,
  SucceededMountLatencyChart,
  FailedMountLatencyChart,
  CompletedSyncLatencyChart,
  FailedSyncLatencyChart,
  SucceededMountPacketLossChart,
  FailedMountPacketLossChart,
  CompletedSyncPacketLossChart,
  FailedSyncPacketLossChart,
  SucceededMountJitterChart,
  FailedMountJitterChart,
  CompletedSyncJitterChart,
  FailedSyncJitterChart,
  SucceededMountSpeedChart,
  FailedMountSpeedChart,
  CompletedSyncSpeedChart,
  FailedSyncSpeedChart,
]);
export type Message = typeof Message.Type;
