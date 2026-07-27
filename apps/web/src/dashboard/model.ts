import { ConnectivityStatusPointSchema } from "@shared/api/routes/connectivity-status";
import { GranularitySchema, MetricSchema } from "@shared/api/routes/metrics";
import { SpeedMetricSchema } from "@shared/api/routes/speedtest";
import { Option, Schema as S } from "effect";
import { AsyncData } from "foldkit";
import { Theme } from "@/dashboard/theme";
import { TimeRange } from "@/dashboard/timeRange";
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
  timeRange: TimeRange,
  isPaused: S.Boolean,
  metrics: MetricsAsyncData.schema,
  speedtestHistory: SpeedtestHistoryAsyncData.schema,
  connectivityStatus: ConnectivityStatusAsyncData.schema,
  speedtestTrigger: SpeedtestTriggerAsyncData.schema,
  maybeLatencyChartHostId: S.Option(S.String),
  maybePacketLossChartHostId: S.Option(S.String),
  maybeJitterChartHostId: S.Option(S.String),
  maybeSpeedChartHostId: S.Option(S.String),
  hoveredSegmentIndex: S.Option(S.Number),
  maybeTheme: S.Option(Theme),
  maybeLastUpdatedMs: S.Option(S.Number),
  toast: Toast.Model,
});
export type Model = typeof Model.Type;

export const initModel = (): Model => ({
  timeRange: "1h",
  isPaused: false,
  metrics: MetricsAsyncData.Idle(),
  speedtestHistory: SpeedtestHistoryAsyncData.Idle(),
  connectivityStatus: ConnectivityStatusAsyncData.Idle(),
  speedtestTrigger: SpeedtestTriggerAsyncData.Idle(),
  maybeLatencyChartHostId: Option.none(),
  maybePacketLossChartHostId: Option.none(),
  maybeJitterChartHostId: Option.none(),
  maybeSpeedChartHostId: Option.none(),
  hoveredSegmentIndex: Option.none(),
  maybeTheme: Option.none(),
  maybeLastUpdatedMs: Option.none(),
  toast: Toast.init({ id: "dashboard-toast" }),
});
