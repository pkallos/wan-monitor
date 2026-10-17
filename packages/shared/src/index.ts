export { WanMonitorApi } from "./api/index";
// Export schema-derived types for type-safe API responses
export type {
  ConnectivityStatus,
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
  MetricSource,
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
  isValidGranularity,
  LIVE_WINDOW_MIN_SECONDS,
  LIVE_WINDOW_PING_MULTIPLIER,
  liveConnectivityWindowSeconds,
  MAX_OUTAGE_SPAN_DAYS,
  PACKET_LOSS_THRESHOLDS,
  VALID_GRANULARITIES,
} from "./constants";
export { mbpsToBps } from "./metrics";
export {
  alignTimestampToMs,
  expectedBucketCount,
  granularityToMs,
} from "./timeline";
