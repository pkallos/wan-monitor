import { Effect } from 'effect';
import type { AppContext, AppInstance } from '../types';

/**
 * Health check routes
 */
export async function healthRoutes(
  app: AppInstance,
  context: AppContext
): Promise<void> {
  // Enhanced health check with database
  app.get('/health', async (_request, reply) => {
    try {
      const dbHealth = await Effect.runPromise(context.db.health());
      return reply.code(200).send({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: dbHealth,
      });
    } catch (error) {
      return reply.code(503).send({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        error: String(error),
      });
    }
  });
}
