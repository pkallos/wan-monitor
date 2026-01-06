import { useQuery } from "@tanstack/react-query";
import { Effect } from "effect";
import { runEffectWithError } from "@/api/effect-bridge";
import { WanMonitorClient } from "@/api/effect-client";
import { isDbUnavailableError } from "@/api/errors";

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
      return runEffectWithError(
        Effect.gen(function* () {
          const client = yield* WanMonitorClient;
          const response = yield* client.speedtest.getSpeedTestHistory({
            urlParams: {
              startTime: startTime?.toISOString(),
              endTime: endTime?.toISOString(),
              limit,
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

  return {
    ...query,
    isDbUnavailable,
    speedMetrics: query.data?.data ? [...query.data.data] : [],
  };
}
