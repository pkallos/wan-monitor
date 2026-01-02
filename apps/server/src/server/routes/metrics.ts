import { type Granularity, VALID_GRANULARITIES } from "@wan-monitor/shared";
import { Effect, Either } from "effect";
import { DbUnavailable } from "@/database/questdb";
import type { AppContext, AppInstance } from "@/server/types";

/**
 * Metrics query route - returns all network metrics (ping + speedtest)
 */
export async function metricsRoutes(
  app: AppInstance,
  context: AppContext
): Promise<void> {
  app.get("/", async (request, reply) => {
    try {
      const query = request.query as {
        startTime?: string;
        endTime?: string;
        host?: string;
        limit?: string;
        granularity?: string;
      };

      const granularity =
        query.granularity &&
        VALID_GRANULARITIES.includes(query.granularity as Granularity)
          ? (query.granularity as Granularity)
          : undefined;

      const params = {
        startTime: query.startTime ? new Date(query.startTime) : undefined,
        endTime: query.endTime ? new Date(query.endTime) : undefined,
        host: query.host,
        limit: query.limit ? Number.parseInt(query.limit, 10) : undefined,
        granularity,
      };

      const result = await Effect.runPromise(
        context.db.queryMetrics(params).pipe(Effect.either)
      );

      return Either.match(result, {
        onLeft: (error) => {
          if (error instanceof DbUnavailable) {
            return reply.code(503).send({
              error: "DB_UNAVAILABLE",
              message: "Database temporarily unavailable",
              timestamp: new Date().toISOString(),
            });
          }
          return reply.code(500).send({
            error: "Failed to query metrics",
            message: String(error),
          });
        },
        onRight: (data) =>
          reply.code(200).send({
            data,
            meta: {
              startTime:
                params.startTime?.toISOString() ??
                new Date(Date.now() - 3600000).toISOString(),
              endTime:
                params.endTime?.toISOString() ?? new Date().toISOString(),
              count: data.length,
            },
          }),
      });
    } catch (error) {
      return reply.code(500).send({
        error: "Failed to query metrics",
        message: String(error),
      });
    }
  });
}
