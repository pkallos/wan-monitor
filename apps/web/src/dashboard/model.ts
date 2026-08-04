import {
  ConnectivityStatusPointSchema,
  LiveConnectivityStatusSchema,
} from "@shared/api/routes/connectivity-status";
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

const LiveConnectivityData = S.Struct({
  status: LiveConnectivityStatusSchema,
  maybeLastSampleAtMs: S.Option(S.Number),
});
export const LiveConnectivityAsyncData = AsyncData.Schema(
  LiveConnectivityData,
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
  speedtestHistory: SpeedtestHistoryAsyncData.schema,
  connectivityStatus: ConnectivityStatusAsyncData.schema,
  liveConnectivity: LiveConnectivityAsyncData.schema,
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
  speedtestHistory: SpeedtestHistoryAsyncData.Idle(),
  connectivityStatus: ConnectivityStatusAsyncData.Idle(),
  liveConnectivity: LiveConnectivityAsyncData.Idle(),
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
