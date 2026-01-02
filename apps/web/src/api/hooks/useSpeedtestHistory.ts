import { useQuery } from "@tanstack/react-query";
import type { SpeedMetric } from "@wan-monitor/shared";
import { apiClient, isDbUnavailableError } from "@/api/client";

export interface SpeedtestHistoryResponse {
  data: SpeedMetric[];
  meta: {
    startTime: string;
    endTime: string;
    count: number;
  };
}

export interface UseSpeedtestHistoryOptions {
  startTime?: Date;
  endTime?: Date;
  limit?: number;
  refetchInterval?: number | false;
  enabled?: boolean;
}

export function useSpeedtestHistory(options: UseSpeedtestHistoryOptions = {}) {
  const {
    startTime,
    endTime,
    limit,
    refetchInterval = 30_000,
    enabled = true,
  } = options;

  const query = useQuery({
    queryKey: [
      "speedtest-history",
      {
        startTime: startTime?.toISOString(),
        endTime: endTime?.toISOString(),
        limit,
      },
    ],
    queryFn: () => {
      const params: Record<string, string | undefined> = {};

      if (startTime) params.startTime = startTime.toISOString();
      if (endTime) params.endTime = endTime.toISOString();
      if (limit) params.limit = limit.toString();

      return apiClient.get<SpeedtestHistoryResponse>(
        "/speedtest/history",
        params
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

  return {
    ...query,
    isDbUnavailable,
    speedMetrics: query.data?.data ?? [],
  };
}
