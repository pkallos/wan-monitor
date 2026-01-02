import { useQuery } from "@tanstack/react-query";
import type {
  ConnectivityStatusResponse,
  Granularity,
} from "@wan-monitor/shared";
import { apiClient } from "@/api/client";
import { getGranularityForRange } from "@/utils/granularity";

interface UseConnectivityStatusOptions {
  startTime?: Date;
  endTime?: Date;
  granularity?: Granularity;
  refetchInterval?: number;
}

export function useConnectivityStatus({
  startTime,
  endTime,
  granularity: explicitGranularity,
  refetchInterval,
}: UseConnectivityStatusOptions = {}) {
  // Auto-calculate granularity if not explicitly provided
  const granularity =
    explicitGranularity ?? getGranularityForRange(startTime, endTime);

  const query = useQuery({
    queryKey: [
      "connectivity-status",
      startTime?.toISOString(),
      endTime?.toISOString(),
      granularity,
    ],
    queryFn: async () => {
      const params: Record<string, string | undefined> = {};
      if (startTime) params.startTime = startTime.toISOString();
      if (endTime) params.endTime = endTime.toISOString();
      if (granularity) params.granularity = granularity;

      return apiClient.get<ConnectivityStatusResponse>(
        "/connectivity-status",
        params
      );
    },
    refetchInterval,
  });

  return query;
}
