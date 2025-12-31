import { useQuery } from '@tanstack/react-query';
import type { SpeedMetricsResponse } from '@wan-monitor/shared';
import { apiClient } from '@/api/client';

export interface UseSpeedMetricsOptions {
  startTime?: Date;
  endTime?: Date;
  limit?: number;
  refetchInterval?: number | false;
  enabled?: boolean;
}

export function useSpeedMetrics(options: UseSpeedMetricsOptions = {}) {
  const {
    startTime,
    endTime,
    limit,
    refetchInterval = 60_000,
    enabled = true,
  } = options;

  return useQuery({
    queryKey: ['speedMetrics', { startTime, endTime, limit }],
    queryFn: () => {
      const params: Record<string, string | undefined> = {};

      if (startTime) params.startTime = startTime.toISOString();
      if (endTime) params.endTime = endTime.toISOString();
      if (limit) params.limit = limit.toString();

      return apiClient.get<SpeedMetricsResponse>('/speed', params);
    },
    refetchInterval,
    enabled,
  });
}
