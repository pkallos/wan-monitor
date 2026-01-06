import { useQuery } from "@tanstack/react-query";
import type { Granularity } from "@wan-monitor/shared";
import { Effect } from "effect";
import { runEffectWithError } from "@/api/effect-bridge";
import { WanMonitorClient } from "@/api/effect-client";
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
    queryFn: () => {
      return runEffectWithError(
        Effect.gen(function* () {
          const client = yield* WanMonitorClient;
          const response =
            yield* client.connectivityStatus.getConnectivityStatus({
              urlParams: {
                startTime: startTime?.toISOString(),
                endTime: endTime?.toISOString(),
                granularity,
              },
            });
          return response;
        })
      );
    },
    refetchInterval,
  });

  return query;
}
