export { VALID_GRANULARITIES } from "@shared/api";
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

export { bpsToMbps, mbpsToBps } from "./metrics";
