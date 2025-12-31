import { Effect } from 'effect';
import type { AppContext, AppInstance } from '@/server/types';

/**
 * Metrics query routes
 */
export async function metricsRoutes(
  app: AppInstance,
  context: AppContext
): Promise<void> {
  // Get ping metrics
  app.get('/ping', async (request, reply) => {
    try {
      const query = request.query as {
        startTime?: string;
        endTime?: string;
        host?: string;
        limit?: string;
      };

      const params = {
        startTime: query.startTime ? new Date(query.startTime) : undefined,
        endTime: query.endTime ? new Date(query.endTime) : undefined,
        host: query.host,
        limit: query.limit ? Number.parseInt(query.limit, 10) : undefined,
      };

      const data = await Effect.runPromise(context.db.queryPingMetrics(params));

      return reply.code(200).send({
        data,
        meta: {
          startTime:
            params.startTime?.toISOString() ??
            new Date(Date.now() - 3600000).toISOString(),
          endTime: params.endTime?.toISOString() ?? new Date().toISOString(),
          count: data.length,
        },
      });
    } catch (error) {
      return reply.code(500).send({
        error: 'Failed to query metrics',
        message: String(error),
      });
    }
  });
}
