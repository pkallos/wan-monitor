import { Effect } from "effect";
import type { FastifyReply, FastifyRequest } from "fastify";
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
    try {
      const dbHealth = await Effect.runPromise(context.db.health());
      return reply.code(200).send({
        status: "healthy",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: dbHealth,
      });
    } catch (error) {
      return reply.code(503).send({
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        error: String(error),
      });
    }
  };

  app.get("/ready", readinessHandler);
  app.get("/health", readinessHandler);
}
