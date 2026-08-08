import { ConnectivityStatusPointSchema } from "@shared/api/routes/connectivity-status";
import { GranularitySchema, MetricSchema } from "@shared/api/routes/metrics";
import { SpeedMetricSchema } from "@shared/api/routes/speedtest";
import { Option, Schema as S } from "effect";
import { AsyncData } from "foldkit";
import { DateRangeSelection, Preset } from "@/dashboard/dateRange";
import * as DateRangePicker from "@/dashboard/dateRangePicker";
import { Theme } from "@/dashboard/theme";
import { Toast } from "@/dashboard/toast";

export const MetricsAsyncData = AsyncData.Schema(
  S.Array(MetricSchema),
  S.String
);
export const SpeedtestHistoryAsyncData = AsyncData.Schema(
  S.Array(SpeedMetricSchema),
  S.String
);

// A chart paints the window its data was fetched for. Relative presets like
// "last30d" resolve against the wall clock, so resolving one a second time at
// paint time yields a different absolute window — and, for ranges that grow
// with wall-clock time, sometimes a different `granularityForRange` bucket —
// which re-buckets the same rows onto a shifted grid.
const TimelineWindow = S.Struct({
  startTimeMs: S.Number,
  endTimeMs: S.Number,
  granularity: GranularitySchema,
});

// The speed chart's fetch requests raw rows below the speedtest aggregation
// threshold, so its window carries no granularity in that case.
const SpeedtestTimelineWindow = S.Struct({
  startTimeMs: S.Number,
  endTimeMs: S.Number,
  maybeGranularity: S.Option(GranularitySchema),
});

const ConnectivityStatusData = S.Struct({
  points: S.Array(ConnectivityStatusPointSchema),
  uptimePercentage: S.Number,
  startTimeMs: S.Number,
  endTimeMs: S.Number,
  granularity: GranularitySchema,
});
export const ConnectivityStatusAsyncData = AsyncData.Schema(
  ConnectivityStatusData,
  S.String
);

const SpeedtestTriggerResult = S.Struct({
  downloadMbps: S.Number,
  uploadMbps: S.Number,
  pingMs: S.Number,
});
export const SpeedtestTriggerAsyncData = AsyncData.Schema(
  SpeedtestTriggerResult,
  S.String
);

export const Model = S.Struct({
  dateRange: DateRangeSelection,
  dateRangePicker: DateRangePicker.Model,
  isPaused: S.Boolean,
  isIdle: S.Boolean,
  metrics: MetricsAsyncData.schema,
  maybeMetricsWindow: S.Option(TimelineWindow),
  speedtestHistory: SpeedtestHistoryAsyncData.schema,
  maybeSpeedtestWindow: S.Option(SpeedtestTimelineWindow),
  connectivityStatus: ConnectivityStatusAsyncData.schema,
  speedtestTrigger: SpeedtestTriggerAsyncData.schema,
  maybeLatencyChartHostId: S.Option(S.String),
  maybePacketLossChartHostId: S.Option(S.String),
  maybeJitterChartHostId: S.Option(S.String),
  maybeSpeedChartHostId: S.Option(S.String),
  hoveredSegmentIndex: S.Option(S.Number),
  maybeTheme: S.Option(Theme),
  maybeLastUpdatedMs: S.Option(S.Number),
  maybeEarliestDataMs: S.Option(S.Number),
  toast: Toast.Model,
});
export type Model = typeof Model.Type;

export const initModel = (): Model => ({
  dateRange: Preset({ preset: "last30d" }),
  dateRangePicker: DateRangePicker.init({ id: "date-range-picker" }),
  isPaused: false,
  isIdle: false,
  metrics: MetricsAsyncData.Idle(),
  maybeMetricsWindow: Option.none(),
  speedtestHistory: SpeedtestHistoryAsyncData.Idle(),
  maybeSpeedtestWindow: Option.none(),
  connectivityStatus: ConnectivityStatusAsyncData.Idle(),
  speedtestTrigger: SpeedtestTriggerAsyncData.Idle(),
  maybeLatencyChartHostId: Option.none(),
  maybePacketLossChartHostId: Option.none(),
  maybeJitterChartHostId: Option.none(),
  maybeSpeedChartHostId: Option.none(),
  hoveredSegmentIndex: Option.none(),
  maybeTheme: Option.none(),
  maybeLastUpdatedMs: Option.none(),
  maybeEarliestDataMs: Option.none(),
  toast: Toast.init({ id: "dashboard-toast" }),
});
