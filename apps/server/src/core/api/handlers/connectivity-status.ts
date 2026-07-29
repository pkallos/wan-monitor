import { WanMonitorApi } from "@shared/api";
import type { GetConnectivityStatusQuery } from "@shared/api/routes/connectivity-status";
import { Clock, Effect, type Schema } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { mapQueryError } from "@/core/api/handlers/db-error";
import { QuestDB } from "@/infrastructure/database/questdb";

export const getConnectivityStatusHandler = ({
  query,
}: {
  query: Schema.Schema.Type<typeof GetConnectivityStatusQuery>;
}) =>
  Effect.gen(function* () {
    const db = yield* QuestDB;
    const now = yield* Clock.currentTimeMillis;

    const rows = yield* db.queryConnectivityStatus({
      startTime: query.startTime ? new Date(query.startTime) : undefined,
      endTime: query.endTime ? new Date(query.endTime) : undefined,
      granularity: query.granularity,
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

    // uptimePercentage is deliberately "clean up only": it counts strictly
    // `up` cycles over all cycles. Degraded cycles count toward the
    // denominator but NOT the numerator, so degradation lowers the uptime
    // figure rather than being treated as full availability.
    // availabilityPercentage counts `up` and `degraded` together, so a link
    // that stayed reachable throughout (even if lossy) doesn't read as a total
    // outage. Both are shipped so callers can pick which one to headline.
    const totalPoints = rows.reduce((sum, row) => sum + row.total_count, 0);
    const totalUpPoints = rows.reduce((sum, row) => sum + row.up_count, 0);
    const totalDegradedPoints = rows.reduce(
      (sum, row) => sum + row.degraded_count,
      0
    );
    const uptimePercentage =
      totalPoints > 0 ? (totalUpPoints / totalPoints) * 100 : 0;
    const availabilityPercentage =
      totalPoints > 0
        ? ((totalUpPoints + totalDegradedPoints) / totalPoints) * 100
        : 0;

    return {
      data,
      meta: {
        uptimePercentage,
        availabilityPercentage,
        startTime:
          query.startTime || new Date(now - 24 * 60 * 60 * 1000).toISOString(),
        endTime: query.endTime || new Date(now).toISOString(),
        count: data.length,
      },
    };
  }).pipe(Effect.catch(mapQueryError("Failed to query connectivity status")));

export const ConnectivityStatusGroupLive = HttpApiBuilder.group(
  WanMonitorApi,
  "connectivityStatus",
  (handlers) =>
    handlers.handle("getConnectivityStatus", getConnectivityStatusHandler)
);
