import { useQuery } from "@tanstack/react-query";
import type {
  Granularity,
  MetricsResponse,
  PingMetric,
  SpeedMetric,
} from "@wan-monitor/shared";
import { useMemo } from "react";
import { apiClient } from "@/api/client";

export interface UseMetricsOptions {
  startTime?: Date;
  endTime?: Date;
  host?: string;
  limit?: number;
  granularity?: Granularity;
  refetchInterval?: number | false;
  enabled?: boolean;
}

/**
 * Calculate appropriate granularity based on time range
 * - 1hr: 1-minute buckets (~60 points)
 * - All other ranges: 5-minute buckets
 */
function getGranularityForRange(
  startTime?: Date,
  endTime?: Date
): Granularity | undefined {
  if (!startTime || !endTime) return undefined;

  const rangeMs = endTime.getTime() - startTime.getTime();
  const rangeHours = rangeMs / (1000 * 60 * 60);

  // 1h or less: 1-minute buckets (~60 points)
  if (rangeHours <= 1) return "1m";
  // All other ranges: 5-minute buckets
  return "5m";
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
  });

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
      }));
  }, [query.data]);

  return {
    ...query,
    pingMetrics,
    speedMetrics,
  };
}
