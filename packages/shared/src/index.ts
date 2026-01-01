export type {
  ApiError,
  ConnectivityStatus,
  ConnectivityStatusPoint,
  ConnectivityStatusResponse,
  Granularity,
  Metric,
  MetricsResponse,
  PingMetric,
  PingMetricsResponse,
  SpeedMetric,
  SpeedMetricsResponse,
} from "./api";

export { VALID_GRANULARITIES } from "./api";

export { bpsToMbps, mbpsToBps } from "./metrics";
