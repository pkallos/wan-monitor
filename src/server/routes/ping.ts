import { Effect } from 'effect';
import type { AppContext, AppInstance } from '@/server/types';

/**
 * Ping-related routes
 */
export async function pingRoutes(
  app: AppInstance,
  context: AppContext
): Promise<void> {
  // Ping trigger endpoint - execute pings and write to database
  app.post('/trigger', async (request, reply) => {
    try {
      const body = request.body as { hosts?: string[] } | undefined;
      const hosts = body?.hosts;

      const results = hosts
        ? await Effect.runPromise(context.pingExecutor.executeHosts(hosts))
        : await Effect.runPromise(context.pingExecutor.executeAll());

      return reply.code(200).send({
        success: true,
        timestamp: new Date().toISOString(),
        results,
      });
    } catch (error) {
      return reply.code(500).send({
        success: false,
        timestamp: new Date().toISOString(),
        error: String(error),
      });
    }
  });

  // Get configured ping hosts
  app.get('/hosts', async (_request, reply) => {
    return reply.code(200).send({
      hosts: context.config.ping.hosts,
    });
  });
}
