import { Effect } from 'effect';
import type { AppContext, AppInstance, RoutePlugin } from '@/server/types';

export const speedRoutes: RoutePlugin = async (
  app: AppInstance,
  context: AppContext
) => {
  // GET /api/speed - Query speed test history
  app.get('/', async (request, reply) => {
    try {
      const query = request.query as {
        startTime?: string;
        endTime?: string;
        limit?: string;
      };

      const params = {
        startTime: query.startTime ? new Date(query.startTime) : undefined,
        endTime: query.endTime ? new Date(query.endTime) : undefined,
        limit: query.limit ? Number.parseInt(query.limit, 10) : undefined,
      };

      const data = await Effect.runPromise(
        context.db.querySpeedMetrics(params)
      );

      return reply.code(200).send({
        data,
        meta: {
          startTime:
            params.startTime?.toISOString() ??
            new Date(Date.now() - 86400000).toISOString(),
          endTime: params.endTime?.toISOString() ?? new Date().toISOString(),
          count: data.length,
        },
      });
    } catch (error) {
      return reply.code(500).send({
        error: 'Failed to query speed metrics',
        message: String(error),
      });
    }
  });
};
