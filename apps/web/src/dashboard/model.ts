import {
  ConnectivityStatusPointSchema,
  LiveConnectivityStatusSchema,
} from "@shared/api/routes/connectivity-status";
import { GranularitySchema, MetricSchema } from "@shared/api/routes/metrics";
import { SpeedMetricSchema } from "@shared/api/routes/speedtest";
import { Option, Schema as S } from "effect";
import { AsyncData } from "foldkit";
import { DateRangeSelection } from "@/dashboard/dateRange";
import * as DateRangePicker from "@/dashboard/dateRangePicker";
import { Theme } from "@/dashboard/theme";
import { Toast } from "@/dashboard/toast";
import type { Settings } from "@/storage";

export const MetricsAsyncData = AsyncData.Schema(
  S.Array(MetricSchema),
  S.String
);
export const SpeedtestHistoryAsyncData = AsyncData.Schema(
  S.Array(SpeedMetricSchema),
  S.String
);

// The absolute window a fetch resolved, stored so the chart paints exactly
// what was fetched. Relative presets like "last30d" resolve against the wall
// clock, so resolving one a second time at paint time lands on a different
// window, and for ranges that grow with wall-clock time it can even cross a
// `granularityForRange` threshold. Either way the same rows get re-bucketed
// onto a grid that no longer matches the server's.
const TimelineWindow = S.Struct({
  startTimeMs: S.Number,
  endTimeMs: S.Number,
  granularity: GranularitySchema,
});

// The speed chart plots raw points rather than bucketing, so its window needs
// no granularity.
const SpeedtestTimelineWindow = S.Struct({
  startTimeMs: S.Number,
  endTimeMs: S.Number,
});

const ConnectivityStatusData = S.Struct({
  points: S.Array(ConnectivityStatusPointSchema),
  /** None when the window held no ping cycles: uptime is unanswerable, not 0%. */
  maybeUptimePercentage: S.Option(S.Number),
  coveragePercentage: S.Number,
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
  maybeMetricsWindow: S.Option(TimelineWindow),
  speedtestHistory: SpeedtestHistoryAsyncData.schema,
  maybeSpeedtestWindow: S.Option(SpeedtestTimelineWindow),
  connectivityStatus: ConnectivityStatusAsyncData.schema,
  liveConnectivity: LiveConnectivityAsyncData.schema,
  speedtestTrigger: SpeedtestTriggerAsyncData.schema,
  maybeLatencyChartHostId: S.Option(S.String),
  maybePacketLossChartHostId: S.Option(S.String),
  maybeJitterChartHostId: S.Option(S.String),
  maybeSpeedChartHostId: S.Option(S.String),
  hoveredSegmentIndex: S.Option(S.Number),
  theme: Theme,
  maybeLastUpdatedMs: S.Option(S.Number),
  maybeEarliestDataMs: S.Option(S.Number),
  toast: Toast.Model,
});
export type Model = typeof Model.Type;

// Settings are hydrated at boot (see `@/storage` and `auth/flags.ts`) and
// passed in already resolved, so the model is never born with a default it
// has to fetch and can't race the first data fetch.
export const initModel = (settings: Settings): Model => ({
  dateRange: settings.dateRange,
  dateRangePicker: DateRangePicker.init({ id: "date-range-picker" }),
  isPaused: settings.isPaused,
  isIdle: false,
  metrics: MetricsAsyncData.Idle(),
  maybeMetricsWindow: Option.none(),
  speedtestHistory: SpeedtestHistoryAsyncData.Idle(),
  maybeSpeedtestWindow: Option.none(),
  connectivityStatus: ConnectivityStatusAsyncData.Idle(),
  liveConnectivity: LiveConnectivityAsyncData.Idle(),
  speedtestTrigger: SpeedtestTriggerAsyncData.Idle(),
  maybeLatencyChartHostId: Option.none(),
  maybePacketLossChartHostId: Option.none(),
  maybeJitterChartHostId: Option.none(),
  maybeSpeedChartHostId: Option.none(),
  hoveredSegmentIndex: Option.none(),
  theme: settings.theme,
  maybeLastUpdatedMs: Option.none(),
  maybeEarliestDataMs: Option.none(),
  toast: Toast.init({ id: "dashboard-toast" }),
});

// The inverse of `initModel` and the single place deciding what persists.
export const settingsFromModel = (model: Model): Settings => ({
  theme: model.theme,
  dateRange: model.dateRange,
  isPaused: model.isPaused,
});
