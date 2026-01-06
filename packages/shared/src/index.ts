export { WanMonitorApi } from "./api/index";
// Export schema-derived types for type-safe API responses
export type {
  ConnectivityStatusPointFromSchema,
  ConnectivityStatusResponseType,
} from "./api/routes/connectivity-status";
export type {
  GetMetricsResponseType,
  MetricFromSchema,
} from "./api/routes/metrics";
export type {
  SpeedMetricFromSchema,
  SpeedTestHistoryResponseType,
  SpeedTestResponseType,
} from "./api/routes/speedtest";
export { SpeedMetric } from "./api/routes/speedtest";
export { bpsToMbps, mbpsToBps } from "./metrics";
export type {
  ConnectivityStatus,
  ConnectivityStatusPoint,
  Granularity,
  Metric,
  PingMetric,
  SpeedMetric as SpeedMetricType,
} from "./types";
export { VALID_GRANULARITIES } from "./types";
