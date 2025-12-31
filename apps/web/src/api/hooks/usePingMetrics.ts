import { useQuery } from '@tanstack/react-query';
import type { PingMetricsResponse } from '@wan-monitor/shared';
import { apiClient } from '@/api/client';

export interface UsePingMetricsOptions {
  startTime?: Date;
  endTime?: Date;
  host?: string;
  limit?: number;
  refetchInterval?: number;
  enabled?: boolean;
}

export function usePingMetrics(options: UsePingMetricsOptions = {}) {
  const {
    startTime,
    endTime,
    host,
    limit,
    refetchInterval = 60_000,
    enabled = true,
  } = options;

  return useQuery({
    queryKey: ['pingMetrics', { startTime, endTime, host, limit }],
    queryFn: () => {
      const params: Record<string, string | undefined> = {};

      if (startTime) params.startTime = startTime.toISOString();
      if (endTime) params.endTime = endTime.toISOString();
      if (host) params.host = host;
      if (limit) params.limit = limit.toString();

      return apiClient.get<PingMetricsResponse>('/metrics/ping', params);
    },
    refetchInterval,
    enabled,
  });
}
