import { Menu, RadioGroup } from "@foldkit/ui";
import {
  ConnectivityStatusPointSchema,
  GetOutagesResponse,
  LiveConnectivityStatusSchema,
} from "@shared/api/routes/connectivity-status";
import { GranularitySchema, MetricSchema } from "@shared/api/routes/metrics";
import { GetHostsResponse } from "@shared/api/routes/ping";
import { SpeedMetricSchema } from "@shared/api/routes/speedtest";
import { GetSummaryResponse } from "@shared/api/routes/summary";
import { Equal, Option, Schema as S } from "effect";
import { AsyncData } from "foldkit";
import {
  DateRangeSelection,
  isAllTime,
  sameDateRange,
} from "@/dashboard/dateRange";
import * as DateRangePicker from "@/dashboard/dateRangePicker";
import { LatencyView } from "@/dashboard/latencyView";
import { RangeRequest } from "@/dashboard/message";
import { ThemePreference } from "@/dashboard/theme";
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
// onto a grid that no longer matches the server's. `request` is the range the
// window answers, which differs from the selected one until a refresh lands.
const TimelineWindow = S.Struct({
  startTimeMs: S.Number,
  endTimeMs: S.Number,
  granularity: GranularitySchema,
  request: RangeRequest,
});

// The speed chart plots raw points rather than bucketing, so its window needs
// no granularity.
const SpeedtestTimelineWindow = S.Struct({
  startTimeMs: S.Number,
  endTimeMs: S.Number,
  request: RangeRequest,
});

const ConnectivityStatusData = S.Struct({
  points: S.Array(ConnectivityStatusPointSchema),
  /** None when the window held no monitored time: uptime is unanswerable, not 0%. */
  maybeUptimePercentage: S.Option(S.Number),
  /** None under the same no-data condition as `maybeUptimePercentage`. */
  maybeAvailabilityPercentage: S.Option(S.Number),
  coveragePercentage: S.Number,
  /** Seconds of the window with ping data: the time the uptime figure covers. */
  observedSeconds: S.Number,
  startTimeMs: S.Number,
  endTimeMs: S.Number,
  granularity: GranularitySchema,
  /** The range the window answers, which differs from the selected one until a refresh lands. */
  request: RangeRequest,
});
export type ConnectivityStatusData = typeof ConnectivityStatusData.Type;
export const ConnectivityStatusAsyncData = AsyncData.Schema(
  ConnectivityStatusData,
  S.String
);

/** One host's latency over the window the per-host chart was fetched for. */
const HostLatencyData = S.Struct({
  series: S.Array(S.Struct({ host: S.String, metrics: S.Array(MetricSchema) })),
  window: TimelineWindow,
});
export const HostLatencyAsyncData = AsyncData.Schema(HostLatencyData, S.String);

const LiveConnectivityData = S.Struct({
  status: LiveConnectivityStatusSchema,
  maybeLastSampleAtMs: S.Option(S.Number),
});
export const LiveConnectivityAsyncData = AsyncData.Schema(
  LiveConnectivityData,
  S.String
);

const SummaryData = S.Struct({
  summary: GetSummaryResponse,
  /** The range the summary answers, which differs from the selected one until a refresh lands. */
  request: RangeRequest,
});
export type SummaryData = typeof SummaryData.Type;
export const SummaryAsyncData = AsyncData.Schema(SummaryData, S.String);
export const PingHostsAsyncData = AsyncData.Schema(GetHostsResponse, S.String);

const OutagesData = S.Struct({
  log: GetOutagesResponse,
  /** The selected range exceeded what the outage log accepts, so only its newest days are shown. */
  isClamped: S.Boolean,
  /** When the log was fetched; the end of a range that has not finished yet is not "now". */
  fetchedAtMs: S.Number,
  /** The range the log answers, which differs from the selected one until a refresh lands. */
  request: RangeRequest,
});
export type OutagesData = typeof OutagesData.Type;
export const OutagesAsyncData = AsyncData.Schema(OutagesData, S.String);

const SpeedtestTriggerResult = S.Struct({
  downloadMbps: S.optional(S.Number),
  uploadMbps: S.optional(S.Number),
  pingMs: S.optional(S.Number),
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
  /** The wall clock as of login or the last clock tick. Views read the time only from here. */
  nowMs: S.Number,
  metrics: MetricsAsyncData.schema,
  maybeMetricsWindow: S.Option(TimelineWindow),
  speedtestHistory: SpeedtestHistoryAsyncData.schema,
  maybeSpeedtestWindow: S.Option(SpeedtestTimelineWindow),
  connectivityStatus: ConnectivityStatusAsyncData.schema,
  liveConnectivity: LiveConnectivityAsyncData.schema,
  summary: SummaryAsyncData.schema,
  outages: OutagesAsyncData.schema,
  pingHosts: PingHostsAsyncData.schema,
  speedtestTrigger: SpeedtestTriggerAsyncData.schema,
  maybeLatencyChartHostId: S.Option(S.String),
  maybePacketLossChartHostId: S.Option(S.String),
  maybeJitterChartHostId: S.Option(S.String),
  maybeSpeedChartHostId: S.Option(S.String),
  latencyView: LatencyView,
  latencyViewRadioGroup: RadioGroup.Model,
  /** Per-host latency, fetched only while the latency chart is in that view. */
  hostLatency: HostLatencyAsyncData.schema,
  /** The range the page showed before a brush on the latency chart narrowed it. */
  maybeRangeBeforeBrush: S.Option(DateRangeSelection),
  /** The ribbon cell under the pointer: a tooltip that goes away when it leaves. */
  hoveredSegmentIndex: S.Option(S.Number),
  /** The bucket pinned by a tap, a key or an incident chip. Its start, not its index, so a sliding window leaves it in place. */
  maybeSelectedBucketStartMs: S.Option(S.Number),
  /** The ribbon's rendered width, once measured; chip layout needs it. */
  maybeRibbonWidthPx: S.Option(S.Number),
  theme: ThemePreference,
  menu: Menu.Model,
  maybeLastUpdatedMs: S.Option(S.Number),
  maybeEarliestDataMs: S.Option(S.Number),
  /** Whether the earliest-datapoint fetch has answered, with a value, none, or a failure. */
  isEarliestDataSettled: S.Boolean,
  toast: Toast.Model,
});
export type Model = typeof Model.Type;

/** What decides which window a fetch resolves: the selected range and, for "All time", its start. */
export type RangeScope = Pick<Model, "dateRange" | "maybeEarliestDataMs">;

// "All time" resolves its start from `maybeEarliestDataMs`, so a response
// issued before that arrived covers a different window than the current one.
export const answersCurrentRange = (
  current: RangeScope,
  request: RangeRequest
): boolean =>
  sameDateRange(request.dateRange, current.dateRange) &&
  (!isAllTime(current.dateRange) ||
    Equal.equals(request.maybeEarliestDataMs, current.maybeEarliestDataMs));

// "All time" has no start to resolve until the earliest datapoint answers, so
// nothing scoped to the range is fetched before then.
export const isAwaitingEarliestData = (
  model: Pick<
    Model,
    "dateRange" | "maybeEarliestDataMs" | "isEarliestDataSettled"
  >
): boolean =>
  isAllTime(model.dateRange) &&
  Option.isNone(model.maybeEarliestDataMs) &&
  !model.isEarliestDataSettled;

// Settings are hydrated at boot (see `@/storage` and `auth/flags.ts`) and
// passed in already resolved, so the model is never born with a default it
// has to fetch and can't race the first data fetch.
export const initModel = (settings: Settings, nowMs: number): Model => ({
  dateRange: settings.dateRange,
  dateRangePicker: DateRangePicker.init({ id: "date-range-picker" }),
  isPaused: settings.isPaused,
  isIdle: false,
  nowMs,
  metrics: MetricsAsyncData.Idle(),
  maybeMetricsWindow: Option.none(),
  speedtestHistory: SpeedtestHistoryAsyncData.Idle(),
  maybeSpeedtestWindow: Option.none(),
  connectivityStatus: ConnectivityStatusAsyncData.Idle(),
  liveConnectivity: LiveConnectivityAsyncData.Idle(),
  summary: SummaryAsyncData.Idle(),
  outages: OutagesAsyncData.Idle(),
  pingHosts: PingHostsAsyncData.Idle(),
  speedtestTrigger: SpeedtestTriggerAsyncData.Idle(),
  maybeLatencyChartHostId: Option.none(),
  maybePacketLossChartHostId: Option.none(),
  maybeJitterChartHostId: Option.none(),
  maybeSpeedChartHostId: Option.none(),
  latencyView: settings.latencyView,
  latencyViewRadioGroup: RadioGroup.init({ id: "latency-view" }),
  hostLatency: HostLatencyAsyncData.Idle(),
  maybeRangeBeforeBrush: Option.none(),
  hoveredSegmentIndex: Option.none(),
  maybeSelectedBucketStartMs: Option.none(),
  maybeRibbonWidthPx: Option.none(),
  theme: settings.theme,
  menu: Menu.init({ id: "dashboard-menu" }),
  maybeLastUpdatedMs: Option.none(),
  maybeEarliestDataMs: Option.none(),
  isEarliestDataSettled: false,
  toast: Toast.init({ id: "dashboard-toast" }),
});

// The inverse of `initModel` and the single place deciding what persists. A
// brushed span is a passing narrowing, so the range it narrowed is what is
// saved.
export const settingsFromModel = (model: Model): Settings => ({
  theme: model.theme,
  dateRange: Option.getOrElse(
    model.maybeRangeBeforeBrush,
    () => model.dateRange
  ),
  isPaused: model.isPaused,
  latencyView: model.latencyView,
});
