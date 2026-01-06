import { HttpApiBuilder } from "@effect/platform";
import { WanMonitorApi } from "@shared/api";
import type { GetConnectivityStatusQuery } from "@shared/api/routes/connectivity-status";
import { Effect, type Schema } from "effect";
import { QuestDB } from "@/infrastructure/database/questdb";

export const getConnectivityStatusHandler = ({
  urlParams,
}: {
  urlParams: Schema.Schema.Type<typeof GetConnectivityStatusQuery>;
}) =>
  Effect.gen(function* () {
    const db = yield* QuestDB;

    const rows = yield* db.queryConnectivityStatus({
      startTime: urlParams.startTime
        ? new Date(urlParams.startTime)
        : undefined,
      endTime: urlParams.endTime ? new Date(urlParams.endTime) : undefined,
      granularity: urlParams.granularity,
    });

    const data = rows.map((row) => {
      const total = row.total_count || 1;
      return {
        timestamp: row.timestamp,
        status:
          row.down_count > 0
            ? ("down" as const)
            : row.degraded_count > 0
              ? ("degraded" as const)
              : ("up" as const),
        upPercentage: (row.up_count / total) * 100,
        downPercentage: (row.down_count / total) * 100,
        degradedPercentage: (row.degraded_count / total) * 100,
      };
    });

    const totalPoints = rows.reduce((sum, row) => sum + row.total_count, 0);
    const totalUpPoints = rows.reduce((sum, row) => sum + row.up_count, 0);
    const uptimePercentage =
      totalPoints > 0 ? (totalUpPoints / totalPoints) * 100 : 0;

    return {
      data,
      meta: {
        uptimePercentage,
        startTime:
          urlParams.startTime ||
          new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        endTime: urlParams.endTime || new Date().toISOString(),
        count: data.length,
      },
    };
  }).pipe(
    Effect.catchAll((error) =>
      Effect.fail(`Failed to query connectivity status: ${error}`)
    )
  );

export const ConnectivityStatusGroupLive = HttpApiBuilder.group(
  WanMonitorApi,
  "connectivityStatus",
  (handlers) =>
    handlers.handle("getConnectivityStatus", getConnectivityStatusHandler)
);
