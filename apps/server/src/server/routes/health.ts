import { Effect, Either } from "effect";
import type { FastifyReply, FastifyRequest } from "fastify";
import { DbUnavailable } from "@/database/questdb";
import type { AppContext, AppInstance } from "@/server/types";

/**
 * Health check routes
 */
export async function healthRoutes(
  app: AppInstance,
  context: AppContext
): Promise<void> {
  app.get("/live", async (_request: FastifyRequest, reply: FastifyReply) =>
    reply.code(200).send({
      status: "alive",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    })
  );

  const readinessHandler = async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    const result = await Effect.runPromise(
      context.db.health().pipe(Effect.either)
    );
    return Either.match(result, {
      onLeft: (error) => {
        if (error instanceof DbUnavailable) {
          return reply.code(503).send({
            status: "unhealthy",
            error: "DB_UNAVAILABLE",
            message: "Database temporarily unavailable",
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
          });
        }
        return reply.code(503).send({
          status: "unhealthy",
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          error: String(error),
        });
      },
      onRight: (dbHealth) =>
        reply.code(200).send({
          status: "healthy",
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          database: dbHealth,
        }),
    });
  };

  app.get("/ready", readinessHandler);
  app.get("/health", readinessHandler);
}
