import { Menu } from "@foldkit/ui";
import {
  ConnectivityStatusPointSchema,
  GetOutagesResponse,
  LiveConnectivityStatusSchema,
} from "@shared/api/routes/connectivity-status";
import { GranularitySchema, MetricSchema } from "@shared/api/routes/metrics";
import { GetHostsResponse } from "@shared/api/routes/ping";
import { SpeedMetricSchema } from "@shared/api/routes/speedtest";
import { GetSummaryResponse } from "@shared/api/routes/summary";
import { Schema as S } from "effect";
import { taggedStruct as m } from "foldkit/schema";
import { DateRangeSelection, PresetKey } from "@/dashboard/dateRange";
import * as DateRangePicker from "@/dashboard/dateRangePicker";
import { Toast } from "@/dashboard/toast";

/**
 * The range a fetch was issued for. Every range-scoped response echoes it so
 * `update` can drop an answer for a range the user has since left.
 */
export const RangeRequest = S.Struct({
  dateRange: DateRangeSelection,
  maybeEarliestDataMs: S.Option(S.Number),
});
export type RangeRequest = typeof RangeRequest.Type;

export const SucceededFetchMetrics = m("SucceededFetchMetrics", {
  request: RangeRequest,
  metrics: S.Array(MetricSchema),
  nowMs: S.Number,
  startTimeMs: S.Number,
  endTimeMs: S.Number,
  granularity: GranularitySchema,
});
export const FailedFetchMetrics = m("FailedFetchMetrics", {
  request: RangeRequest,
  error: S.String,
});

export const SucceededFetchSpeedtestHistory = m(
  "SucceededFetchSpeedtestHistory",
  {
    request: RangeRequest,
    history: S.Array(SpeedMetricSchema),
    startTimeMs: S.Number,
    endTimeMs: S.Number,
  }
);
export const FailedFetchSpeedtestHistory = m("FailedFetchSpeedtestHistory", {
  request: RangeRequest,
  error: S.String,
});

export const SucceededFetchConnectivityStatus = m(
  "SucceededFetchConnectivityStatus",
  {
    request: RangeRequest,
    points: S.Array(ConnectivityStatusPointSchema),
    maybeUptimePercentage: S.Option(S.Number),
    maybeAvailabilityPercentage: S.Option(S.Number),
    coveragePercentage: S.Number,
    startTimeMs: S.Number,
    endTimeMs: S.Number,
    granularity: GranularitySchema,
  }
);
export const FailedFetchConnectivityStatus = m(
  "FailedFetchConnectivityStatus",
  { request: RangeRequest, error: S.String }
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

export const SucceededFetchSummary = m("SucceededFetchSummary", {
  summary: GetSummaryResponse,
  request: RangeRequest,
});
export const FailedFetchSummary = m("FailedFetchSummary", {
  error: S.String,
  request: RangeRequest,
});

export const SucceededFetchOutages = m("SucceededFetchOutages", {
  outages: GetOutagesResponse,
  /** The range was wider than the outage log accepts, so only its newest days were asked for. */
  isClamped: S.Boolean,
  /** The clock reading the range was resolved with: "now" as far as the log is concerned. */
  fetchedAtMs: S.Number,
  request: RangeRequest,
});
export const FailedFetchOutages = m("FailedFetchOutages", {
  error: S.String,
  request: RangeRequest,
});

export const SucceededFetchPingHosts = m("SucceededFetchPingHosts", {
  hosts: GetHostsResponse,
});
export const FailedFetchPingHosts = m("FailedFetchPingHosts", {
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
export const ToggledConnectivitySegment = m("ToggledConnectivitySegment", {
  startMs: S.Number,
});
export const ClearedConnectivitySelection = m("ClearedConnectivitySelection");
export const PressedRibbonKey = m("PressedRibbonKey", { key: S.String });
export const MeasuredRibbon = m("MeasuredRibbon", { widthPx: S.Number });

export const SucceededFetchEarliestData = m("SucceededFetchEarliestData", {
  earliestMs: S.Option(S.Number),
});
export const FailedFetchEarliestData = m("FailedFetchEarliestData", {
  error: S.String,
});

export const ChangedSystemTheme = m("ChangedSystemTheme");
export const CompletedApplyTheme = m("CompletedApplyTheme");
export const CompletedSaveSettings = m("CompletedSaveSettings");
export const FailedSaveSettings = m("FailedSaveSettings", { error: S.String });

export const GotMenuMessage = m("GotMenuMessage", {
  message: Menu.Message,
});
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
export const SelectedQuickRange = m("SelectedQuickRange", {
  preset: PresetKey,
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
  SucceededFetchSummary,
  FailedFetchSummary,
  SucceededFetchOutages,
  FailedFetchOutages,
  SucceededFetchPingHosts,
  FailedFetchPingHosts,
  SucceededTriggerSpeedtest,
  FailedTriggerSpeedtest,
  SucceededFetchEarliestData,
  FailedFetchEarliestData,
  HoveredConnectivitySegment,
  UnhoveredConnectivitySegment,
  ToggledConnectivitySegment,
  ClearedConnectivitySelection,
  PressedRibbonKey,
  MeasuredRibbon,
  ChangedSystemTheme,
  CompletedApplyTheme,
  CompletedSaveSettings,
  FailedSaveSettings,
  GotMenuMessage,
  GotToastMessage,
  EnteredDashboard,
  TickedRefresh,
  ClickedTogglePause,
  Interacted,
  WentIdle,
  GotDateRangePickerMessage,
  SelectedQuickRange,
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

/** Sent to the parent when the user picks Log out from the overflow menu. */
export const RequestedLogout = m("RequestedLogout");

export const OutMessage = S.Union([RequestedLogout]);
export type OutMessage = typeof OutMessage.Type;
