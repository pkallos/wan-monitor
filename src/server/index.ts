import { Effect, Layer } from 'effect';
import { QuestDB, QuestDBLive } from '@/database/questdb';
import { createApp } from '@/server/app';
import { healthRoutes } from '@/server/routes/health';
import { metricsRoutes } from '@/server/routes/metrics';
import { pingRoutes } from '@/server/routes/ping';
import { speedRoutes } from '@/server/routes/speed';
import type { AppContext } from '@/server/types';
import { ConfigService, ConfigServiceLive } from '@/services/config';
import { NetworkMonitor, NetworkMonitorLive } from '@/services/network-monitor';
import { PingServiceLive } from '@/services/ping';
import { PingExecutor, PingExecutorLive } from '@/services/ping-executor';
import { SpeedTestServiceLive } from '@/services/speedtest';

// Application layers - build dependency graph
const ConfigLayer = ConfigServiceLive;
const QuestDBLayer = Layer.provide(QuestDBLive, ConfigLayer);
const PingLayer = Layer.provide(PingServiceLive, ConfigLayer);
const PingExecutorLayer = Layer.provide(
  PingExecutorLive,
  Layer.merge(Layer.merge(ConfigLayer, QuestDBLayer), PingLayer)
);
const SpeedTestLayer = SpeedTestServiceLive;
const NetworkMonitorLayer = Layer.provide(
  NetworkMonitorLive,
  Layer.mergeAll(ConfigLayer, PingExecutorLayer, SpeedTestLayer, QuestDBLayer)
);

// Combine all layers
const MainLive = Layer.mergeAll(
  ConfigLayer,
  QuestDBLayer,
  PingLayer,
  PingExecutorLayer,
  SpeedTestLayer,
  NetworkMonitorLayer
);

// Main server program
const program = Effect.gen(function* () {
  const config = yield* ConfigService;
  const db = yield* QuestDB;
  const pingExecutor = yield* PingExecutor;
  const networkMonitor = yield* NetworkMonitor;

  // Create Fastify app
  const app = createApp();

  // Create app context with Effect services
  const context: AppContext = {
    db,
    pingExecutor,
    networkMonitor,
    config,
  };

  // Register modular routes with prefixes
  yield* Effect.tryPromise({
    try: async () => {
      await app.register(
        async (instance) => {
          await healthRoutes(instance, context);
        },
        { prefix: '/api' }
      );
    },
    catch: (error) => new Error(`Failed to register health routes: ${error}`),
  });

  yield* Effect.tryPromise({
    try: async () => {
      await app.register(
        async (instance) => {
          await pingRoutes(instance, context);
        },
        { prefix: '/api/ping' }
      );
    },
    catch: (error) => new Error(`Failed to register ping routes: ${error}`),
  });

  yield* Effect.tryPromise({
    try: async () => {
      await app.register(
        async (instance) => {
          await metricsRoutes(instance, context);
        },
        { prefix: '/api/metrics' }
      );
      await app.register(
        async (instance) => {
          await speedRoutes(instance, context);
        },
        { prefix: '/api/speed' }
      );
    },
    catch: (error) => new Error(`Failed to register metrics routes: ${error}`),
  });

  // Start server
  const port = config.server.port;
  const host = config.server.host;

  yield* Effect.tryPromise({
    try: () => app.listen({ port, host }),
    catch: (error) => new Error(`Failed to start server: ${error}`),
  });

  yield* Effect.log(`Server listening on ${host}:${port}`);

  // Start network monitoring
  yield* networkMonitor.start();
  yield* Effect.log('Network monitoring started');

  // Keep server running until interrupted
  yield* Effect.never;
});

// Run the program
const runnable = program.pipe(
  Effect.provide(MainLive),
  Effect.tapErrorCause(Effect.logError)
);

Effect.runFork(runnable);
