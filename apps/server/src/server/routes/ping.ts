import { Effect } from "effect";
import type { AppContext, AppInstance } from "@/server/types";

/**
 * Ping-related routes
 */
export async function pingRoutes(
  app: AppInstance,
  context: AppContext
): Promise<void> {
  // Ping trigger endpoint - execute pings and write to database
  app.post("/trigger", async (request, reply) => {
    const body = request.body as { hosts?: string[] } | undefined;
    const hosts = body?.hosts;

    const program = hosts
      ? context.pingExecutor.executeHosts(hosts)
      : context.pingExecutor.executeAll();

    return Effect.runPromise(
      program.pipe(
        Effect.match({
          onFailure: (error) =>
            reply.code(500).send({
              success: false,
              timestamp: new Date().toISOString(),
              error: String(error),
            }),
          onSuccess: (results) =>
            reply.code(200).send({
              success: true,
              timestamp: new Date().toISOString(),
              results,
            }),
        })
      )
    );
  });

  // Get configured ping hosts
  app.get("/hosts", async (_request, reply) => {
    return reply.code(200).send({
      hosts: context.config.ping.hosts,
    });
  });
}
