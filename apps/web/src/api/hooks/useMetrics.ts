import { useQuery } from "@tanstack/react-query";
import type {
  Granularity,
  MetricsResponse,
  PingMetric,
  SpeedMetric,
} from "@wan-monitor/shared";
import { useMemo } from "react";
import { apiClient, isDbUnavailableError } from "@/api/client";
import { getGranularityForRange } from "@/utils/granularity";

export interface UseMetricsOptions {
  startTime?: Date;
  endTime?: Date;
  host?: string;
  limit?: number;
  granularity?: Granularity;
  refetchInterval?: number | false;
  enabled?: boolean;
}

export function useMetrics(options: UseMetricsOptions = {}) {
  const {
    startTime,
    endTime,
    host,
    limit,
    granularity: explicitGranularity,
    refetchInterval = 30_000,
    enabled = true,
  } = options;

  // Auto-calculate granularity if not explicitly provided
  const granularity =
    explicitGranularity ?? getGranularityForRange(startTime, endTime);

  const query = useQuery({
    queryKey: ["metrics", { startTime, endTime, host, limit, granularity }],
    queryFn: () => {
      const params: Record<string, string | undefined> = {};

      if (startTime) params.startTime = startTime.toISOString();
      if (endTime) params.endTime = endTime.toISOString();
      if (host) params.host = host;
      if (limit) params.limit = limit.toString();
      if (granularity) params.granularity = granularity;

      return apiClient.get<MetricsResponse>("/metrics", params);
    },
    refetchInterval,
    enabled,
    retry: (failureCount, error) =>
      isDbUnavailableError(error) && failureCount < 6,
    retryDelay: (attemptIndex) => Math.min(30_000, 1000 * 2 ** attemptIndex),
  });

  const isDbUnavailable =
    isDbUnavailableError(query.error) ||
    isDbUnavailableError(query.failureReason);

  const pingMetrics = useMemo((): PingMetric[] => {
    if (!query.data?.data) return [];
    return query.data.data
      .filter((m) => m.source === "ping")
      .map((m) => ({
        timestamp: m.timestamp,
        host: m.host ?? "",
        latency: m.latency ?? 0,
        packet_loss: m.packet_loss ?? 0,
        connectivity_status: m.connectivity_status ?? "down",
        jitter: m.jitter,
      }));
  }, [query.data]);

  const speedMetrics = useMemo((): SpeedMetric[] => {
    if (!query.data?.data) return [];
    return query.data.data
      .filter((m) => m.source === "speedtest")
      .map((m) => ({
        timestamp: m.timestamp,
        download_speed: m.download_speed ?? 0,
        upload_speed: m.upload_speed ?? 0,
        latency: m.latency ?? 0,
        jitter: m.jitter,
        server_location: m.server_location,
        isp: m.isp,
        external_ip: m.external_ip,
        internal_ip: m.internal_ip,
      }));
  }, [query.data]);

  return {
    ...query,
    isDbUnavailable,
    pingMetrics,
    speedMetrics,
  };
}
