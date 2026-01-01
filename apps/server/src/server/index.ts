import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";

// Load environment variables from .env.local (dev) or .env (prod)
// Try monorepo root first (when running via turbo), then package root
// dotenv will not override existing environment variables, so .env.local takes precedence
const envPaths = [
  resolve(process.cwd(), ".env.local"),
  resolve(process.cwd(), "../../.env.local"),
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "../../.env"),
];
for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    config({ path: envPath });
  }
}

import { Effect, Layer } from "effect";
import { QuestDB, QuestDBLive } from "@/database/questdb";
import { createApp } from "@/server/app";
import { authRoutes } from "@/server/routes/auth";
import { connectivityStatusRoutes } from "@/server/routes/connectivity-status";
import { healthRoutes } from "@/server/routes/health";
import { metricsRoutes } from "@/server/routes/metrics";
import { pingRoutes } from "@/server/routes/ping";
import { speedtestRoutes } from "@/server/routes/speedtest";
import type { AppContext } from "@/server/types";
import { ConfigService, ConfigServiceLive } from "@/services/config";
import { NetworkMonitor, NetworkMonitorLive } from "@/services/network-monitor";
import { PingServiceLive } from "@/services/ping";
import { PingExecutor, PingExecutorLive } from "@/services/ping-executor";
import { SpeedTestService, SpeedTestServiceLive } from "@/services/speedtest";

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
  Layer.mergeAll(ConfigLayer, QuestDBLayer, PingExecutorLayer, SpeedTestLayer)
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
  const speedTestService = yield* SpeedTestService;
  const networkMonitor = yield* NetworkMonitor;

  // Create Fastify app with JWT secret and auth config
  const authRequired = Boolean(config.auth.password);
  const app = createApp({ jwtSecret: config.auth.jwtSecret, authRequired });

  // Create app context with Effect services
  const context: AppContext = {
    db,
    pingExecutor,
    speedTestService,
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
        { prefix: "/api" }
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
        { prefix: "/api/ping" }
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
        { prefix: "/api/metrics" }
      );
    },
    catch: (error) => new Error(`Failed to register metrics routes: ${error}`),
  });

  yield* Effect.tryPromise({
    try: async () => {
      await app.register(
        async (instance) => {
          await authRoutes(instance, context);
        },
        { prefix: "/api/auth" }
      );
    },
    catch: (error) => new Error(`Failed to register auth routes: ${error}`),
  });

  yield* Effect.tryPromise({
    try: async () => {
      await app.register(
        async (instance) => {
          await connectivityStatusRoutes(instance, context);
        },
        { prefix: "/api/connectivity-status" }
      );
    },
    catch: (error) =>
      new Error(`Failed to register connectivity status routes: ${error}`),
  });

  yield* Effect.tryPromise({
    try: async () => {
      await app.register(
        async (instance) => {
          await speedtestRoutes(instance, context);
        },
        { prefix: "/api/speedtest" }
      );
    },
    catch: (error) =>
      new Error(`Failed to register speedtest routes: ${error}`),
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
  yield* Effect.log("Network monitoring started");

  // Keep server running until interrupted
  yield* Effect.never;
});

// Run the program
const runnable = program.pipe(
  Effect.provide(MainLive),
  Effect.tapErrorCause(Effect.logError)
);

Effect.runFork(runnable);
