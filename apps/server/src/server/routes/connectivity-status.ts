import { type Granularity, VALID_GRANULARITIES } from "@wan-monitor/shared";
import { Effect } from "effect";
import { DbUnavailable } from "@/database/questdb";
import type { AppContext, AppInstance } from "@/server/types";

/**
 * Connectivity status route - returns aggregated connectivity status over time
 */
export async function connectivityStatusRoutes(
  app: AppInstance,
  context: AppContext
): Promise<void> {
  app.get("/", async (request, reply) => {
    const query = request.query as {
      startTime?: string;
      endTime?: string;
      granularity?: string;
    };

    const granularity =
      query.granularity &&
      VALID_GRANULARITIES.includes(query.granularity as Granularity)
        ? (query.granularity as Granularity)
        : "5m";

    const params = {
      startTime: query.startTime ? new Date(query.startTime) : undefined,
      endTime: query.endTime ? new Date(query.endTime) : undefined,
      granularity,
    };

    return Effect.runPromise(
      context.db.queryConnectivityStatus(params).pipe(
        Effect.match({
          onFailure: (error) => {
            if (error instanceof DbUnavailable) {
              return reply.code(503).send({
                error: "DB_UNAVAILABLE",
                message: "Database temporarily unavailable",
                timestamp: new Date().toISOString(),
              });
            }
            return reply.code(500).send({
              error: "Failed to query connectivity status",
              message: String(error),
            });
          },
          onSuccess: (rows) => {
            // Transform database rows into API response format
            const data = rows.map((row) => {
              const total = row.total_count || 1; // Avoid division by zero
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

            // Calculate overall uptime percentage
            const totalPoints = rows.reduce(
              (sum, row) => sum + row.total_count,
              0
            );
            const totalUpPoints = rows.reduce(
              (sum, row) => sum + row.up_count,
              0
            );
            const uptimePercentage =
              totalPoints > 0 ? (totalUpPoints / totalPoints) * 100 : 0;

            return reply.code(200).send({
              data,
              meta: {
                startTime:
                  params.startTime?.toISOString() ??
                  new Date(Date.now() - 86400000).toISOString(),
                endTime:
                  params.endTime?.toISOString() ?? new Date().toISOString(),
                count: data.length,
                uptimePercentage,
              },
            });
          },
        })
      )
    );
  });
}
