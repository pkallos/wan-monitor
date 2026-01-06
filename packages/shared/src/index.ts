export { WanMonitorApi } from "./api/index";
// Export schema-derived types for type-safe API responses
export type {
  ConnectivityStatus,
  ConnectivityStatusPoint,
  ConnectivityStatusResponseType,
} from "./api/routes/connectivity-status";
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
export { VALID_GRANULARITIES } from "./constants";
export { bpsToMbps, mbpsToBps } from "./metrics";
