import { useQuery } from "@tanstack/react-query";
import type {
  Granularity,
  PingMetric,
  SpeedMetricType,
} from "@wan-monitor/shared";
import { Effect } from "effect";
import { useMemo } from "react";
import { runEffectWithError } from "@/api/effect-bridge";
import { WanMonitorClient } from "@/api/effect-client";
import { isDbUnavailableError } from "@/api/errors";
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
      return runEffectWithError(
        Effect.gen(function* () {
          const client = yield* WanMonitorClient;
          const response = yield* client.metrics.getMetrics({
            urlParams: {
              startTime: startTime?.toISOString(),
              endTime: endTime?.toISOString(),
              host,
              limit,
              granularity,
            },
          });
          return response;
        })
      );
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
        jitter: m.jitter ?? undefined,
      }));
  }, [query.data]);

  const speedMetrics = useMemo((): SpeedMetricType[] => {
    if (!query.data?.data) return [];
    return query.data.data
      .filter((m) => m.source === "speedtest")
      .map((m) => ({
        timestamp: m.timestamp,
        download_speed: m.download_speed ?? 0,
        upload_speed: m.upload_speed ?? 0,
        latency: m.latency ?? 0,
        jitter: m.jitter ?? undefined,
        server_location: m.server_location ?? undefined,
        isp: m.isp ?? undefined,
        external_ip: m.external_ip ?? undefined,
        internal_ip: m.internal_ip ?? undefined,
      }));
  }, [query.data]);

  return {
    ...query,
    isDbUnavailable,
    pingMetrics,
    speedMetrics,
  };
}
