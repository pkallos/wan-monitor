import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Load environment variables from .env.local (dev) or .env (prod) using Node's
// native loader (process.loadEnvFile, stable since v24.10 — see engines.node).
// Try package root first, then monorepo root (when running from the repo root).
// Node never overrides variables already present in process.env, and across
// multiple loads the first file to set a key wins, so .env.local takes precedence.
const envPaths = [
  resolve(process.cwd(), ".env.local"),
  resolve(process.cwd(), "../../.env.local"),
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "../../.env"),
];
for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

import { NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { ApiServerLive, NodeHttpServerLayer } from "@/core/api/server";
import {
  NetworkMonitor,
  NetworkMonitorLive,
} from "@/core/monitoring/network-monitor";
import { PingExecutorLive } from "@/core/monitoring/ping-executor";
import { SpeedTestRunnerLive } from "@/core/monitoring/speed-test-runner";
import { JwtServiceLive } from "@/infrastructure/auth/jwt";
import { AuthServiceLive } from "@/infrastructure/auth/middleware";
import {
  ConfigServiceLive,
  MinimumLogLevelLive,
} from "@/infrastructure/config/config";
import { QuestDBLive } from "@/infrastructure/database/questdb";
import { PingServiceLive } from "@/infrastructure/ping/service";
import { SpeedTestServiceLive } from "@/infrastructure/speedtest/service";

// Application layers - build dependency graph
// Each layer explicitly provides its dependencies (redundancy is necessary for type safety)

// Base layers (no dependencies or self-contained)
const ConfigLayer = ConfigServiceLive;
const SpeedTestLayer = SpeedTestServiceLive.pipe(Layer.provide(ConfigLayer));

// Level 1: Services depending only on Config
const QuestDBLayer = QuestDBLive.pipe(Layer.provide(ConfigLayer));
const JwtLayer = JwtServiceLive.pipe(Layer.provide(ConfigLayer));
const PingLayer = PingServiceLive.pipe(Layer.provide(ConfigLayer));

// Level 2: Services with multiple dependencies
const AuthServiceLayer = AuthServiceLive.pipe(
  Layer.provide(Layer.merge(ConfigLayer, JwtLayer))
);
const PingExecutorLayer = PingExecutorLive.pipe(
  Layer.provide(Layer.mergeAll(ConfigLayer, QuestDBLayer, PingLayer))
);
const SpeedTestRunnerLayer = SpeedTestRunnerLive.pipe(
  Layer.provide(Layer.merge(QuestDBLayer, SpeedTestLayer))
);
const NetworkMonitorLayer = NetworkMonitorLive.pipe(
  Layer.provide(
    Layer.mergeAll(ConfigLayer, PingExecutorLayer, SpeedTestRunnerLayer)
  )
);
const ApiServerLayer = ApiServerLive.pipe(
  Layer.provide(NodeHttpServerLayer),
  Layer.provide(
    Layer.mergeAll(
      ConfigLayer,
      QuestDBLayer,
      PingExecutorLayer,
      JwtLayer,
      AuthServiceLayer,
      SpeedTestRunnerLayer
    )
  )
);

// Combine all layers for main program
// Only include top-level layers - dependencies are already provided within them.
// provideMerge, not provide: the program fiber and the monitor loops it forks
// need the log level too.
const MainLive = Layer.mergeAll(NetworkMonitorLayer, ApiServerLayer).pipe(
  Layer.provideMerge(MinimumLogLevelLive.pipe(Layer.provide(ConfigLayer)))
);

// The scope closes before MainLive releases QuestDB, so the loops stop first.
const program = Effect.gen(function* () {
  const networkMonitor = yield* NetworkMonitor;

  yield* networkMonitor.start();

  // Keep server running until interrupted
  return yield* Effect.never;
}).pipe(Effect.scoped);

// Run the program
program.pipe(Effect.provide(MainLive), NodeRuntime.runMain);
