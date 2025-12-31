import { Effect, Layer } from 'effect';
import { QuestDB, QuestDBLive } from '@/database/questdb';
import { createApp } from '@/server/app';
import { ConfigService, ConfigServiceLive } from '@/services/config';
import { PingServiceLive } from '@/services/ping';
import { PingExecutor, PingExecutorLive } from '@/services/ping-executor';

// Application layers - build dependency graph
const ConfigLayer = ConfigServiceLive;
const QuestDBLayer = Layer.provide(QuestDBLive, ConfigLayer);
const PingLayer = Layer.provide(PingServiceLive, ConfigLayer);
const PingExecutorLayer = Layer.provide(
  PingExecutorLive,
  Layer.merge(Layer.merge(ConfigLayer, QuestDBLayer), PingLayer)
);

// Combine all layers
const MainLive = Layer.mergeAll(
  ConfigLayer,
  QuestDBLayer,
  PingLayer,
  PingExecutorLayer
);

// Main server program
const program = Effect.gen(function* () {
  const config = yield* ConfigService;
  const db = yield* QuestDB;
  const pingExecutor = yield* PingExecutor;

  // Create Fastify app
  const app = createApp();

  // Enhanced health check with database
  app.get('/api/health', async (_request, reply) => {
    try {
      const dbHealth = await Effect.runPromise(db.health());
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

  // Ping trigger endpoint - execute pings and write to database
  app.post('/api/ping/trigger', async (request, reply) => {
    try {
      const body = request.body as { hosts?: string[] } | undefined;
      const hosts = body?.hosts;

      const results = hosts
        ? await Effect.runPromise(pingExecutor.executeHosts(hosts))
        : await Effect.runPromise(pingExecutor.executeAll());

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
  app.get('/api/ping/hosts', async (_request, reply) => {
    return reply.code(200).send({
      hosts: config.ping.hosts,
    });
  });

  // Get ping metrics
  app.get('/api/metrics/ping', async (request, reply) => {
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

      const data = await Effect.runPromise(db.queryPingMetrics(params));

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

  // Start server
  const port = config.server.port;
  const host = config.server.host;

  yield* Effect.tryPromise({
    try: () => app.listen({ port, host }),
    catch: (error) => new Error(`Failed to start server: ${error}`),
  });

  yield* Effect.log(`Server listening on ${host}:${port}`);

  // Keep server running until interrupted
  yield* Effect.never;
});

// Run the program
const runnable = program.pipe(
  Effect.provide(MainLive),
  Effect.tapErrorCause(Effect.logError)
);

Effect.runFork(runnable);
