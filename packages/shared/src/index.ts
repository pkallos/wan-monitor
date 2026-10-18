export { WanMonitorApi } from "./api/index";
// Export schema-derived types for type-safe API responses
export type {
  ConnectivityStatusPoint,
  ConnectivityStatusResponseType,
  GetLiveConnectivityResponseType,
  GetOutagesResponseType,
  LiveConnectivityStatus,
  Outage,
} from "./api/routes/connectivity-status";
export { LiveConnectivityStatusSchema } from "./api/routes/connectivity-status";
export type {
  GetMetricsResponseType,
  Granularity,
  Metric,
} from "./api/routes/metrics";
export type {
  SpeedMetric,
  SpeedTestHistoryResponseType,
  SpeedTestResponseType,
} from "./api/routes/speedtest";
export { SpeedMetricSchema } from "./api/routes/speedtest";
export type {
  GetSummaryResponseType,
  HostSummary,
  RangeSummary,
  SpeedSummary,
} from "./api/routes/summary";
export {
  DEFAULT_GRANULARITY,
  DEGRADED_BUCKET_MIN_SHARE,
  LIVE_WINDOW_MIN_SECONDS,
  LIVE_WINDOW_PING_MULTIPLIER,
  liveConnectivityWindowSeconds,
  MAX_OUTAGE_SPAN_DAYS,
  PACKET_LOSS_THRESHOLDS,
} from "./constants";
export type { ConnectivityStatus, MetricSource } from "./metrics";
export { mbpsToBps } from "./metrics";
export {
  alignTimestampToMs,
  expectedBucketCount,
  granularityToMs,
} from "./timeline";
