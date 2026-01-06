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
import { QuestDBLive } from "@/database/questdb";
import { ApiServiceLayer } from "@/services/api";
import { AuthServiceLive } from "@/services/auth-middleware";
import { ConfigServiceLive } from "@/services/config";
import { JwtServiceLive } from "@/services/jwt";
import { NetworkMonitor, NetworkMonitorLive } from "@/services/network-monitor";
import { PingServiceLive } from "@/services/ping";
import { PingExecutorLive } from "@/services/ping-executor";
import { ApiServerLive, NodeHttpServerLayer } from "@/services/server";
import { SpeedTestServiceLive } from "@/services/speedtest";

// Application layers - build dependency graph
// Each layer explicitly provides its dependencies (redundancy is necessary for type safety)

// Base layers (no dependencies or self-contained)
const ConfigLayer = ConfigServiceLive;
const SpeedTestLayer = SpeedTestServiceLive;

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
const NetworkMonitorLayer = NetworkMonitorLive.pipe(
  Layer.provide(
    Layer.mergeAll(ConfigLayer, QuestDBLayer, PingExecutorLayer, SpeedTestLayer)
  )
);
const ApiServerLayer = ApiServerLive.pipe(
  Layer.provide(ApiServiceLayer),
  Layer.provide(NodeHttpServerLayer),
  Layer.provide(
    Layer.mergeAll(
      ConfigLayer,
      QuestDBLayer,
      PingExecutorLayer,
      JwtLayer,
      AuthServiceLayer,
      SpeedTestLayer
    )
  )
);

// Combine all layers for main program
// Only include top-level layers - dependencies are already provided within them
const MainLive = Layer.mergeAll(
  ConfigLayer, // Used directly by program
  NetworkMonitorLayer, // Used directly by program (includes QuestDB, PingExecutor, SpeedTest, Ping)
  ApiServerLayer // Starts HTTP server automatically (includes all API dependencies)
);

// Main server program
const program = Effect.gen(function* () {
  const networkMonitor = yield* NetworkMonitor;

  // Start network monitoring
  yield* networkMonitor.start();
  yield* Effect.log("Network monitoring started");

  // Keep server running until interrupted
  return yield* Effect.never;
});

// Run the program
const runnable = program.pipe(
  Effect.provide(MainLive),
  Effect.tapErrorCause(Effect.logError)
);

Effect.runFork(runnable);
