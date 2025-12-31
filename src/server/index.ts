import { Effect, Layer } from 'effect';
import { QuestDB, QuestDBLive } from '@/database/questdb';
import { createApp } from '@/server/app';
import { ConfigService, ConfigServiceLive } from '@/services/config';

// Application layers - combine both layers
const MainLive = Layer.merge(
  ConfigServiceLive,
  Layer.provide(QuestDBLive, ConfigServiceLive)
);

// Main server program
const program = Effect.gen(function* () {
  const config = yield* ConfigService;
  const db = yield* QuestDB;

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
