import { Effect, Layer, Option } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { ApiServiceLayer } from "@/core/api/service";
import { PingExecutor } from "@/core/monitoring/ping-executor";
import { SpeedTestRunner } from "@/core/monitoring/speed-test-runner";
import { JwtServiceLive } from "@/infrastructure/auth/jwt";
import { AuthServiceLive } from "@/infrastructure/auth/middleware";
import { ConfigService } from "@/infrastructure/config/config";
import {
  QuestDB,
  type QuestDBService,
} from "@/infrastructure/database/questdb/service";
import { makeTestAppConfig } from "@/test/config";
import { emptyAnalyticsQueries } from "@/test/questdb-stubs";

export interface TestApp {
  readonly handler: (request: Request) => Promise<Response>;
  readonly dispose: () => Promise<void>;
}

/** A QuestDB service whose every query succeeds empty, except where overridden. */
export const stubQuestDB = (
  overrides: Partial<QuestDBService> = {}
): QuestDBService => ({
  writeMetric: () => Effect.void,
  flush: () => Effect.void,
  queryMetrics: () => Effect.succeed([]),
  querySpeedtests: () => Effect.succeed([]),
  queryConnectivityStatus: () => Effect.succeed([]),
  queryLiveConnectivity: () => Effect.succeed(null),
  queryEarliestTimestamp: () => Effect.succeed(null),
  queryLatestPingTimestamp: () => Effect.succeed(null),
  ...emptyAnalyticsQueries,
  health: () => Effect.succeed({ connected: true, uptime: 1000 }),
  close: () => Effect.void,
  ...overrides,
});

/**
 * The production API layer over a stubbed QuestDB, with authentication
 * disabled. Requests go through routing, payload decoding and response
 * encoding exactly as in the running server.
 */
export const makeTestApp = (questdb: QuestDBService): TestApp => {
  const ConfigLayer = Layer.succeed(ConfigService, makeTestAppConfig());
  const JwtLayer = JwtServiceLive.pipe(Layer.provide(ConfigLayer));
  const AuthLayer = AuthServiceLive.pipe(
    Layer.provide(Layer.mergeAll(ConfigLayer, JwtLayer))
  );

  const MockServicesLayer = Layer.mergeAll(
    ConfigLayer,
    JwtLayer,
    Layer.succeed(QuestDB, questdb),
    Layer.succeed(PingExecutor, {
      executePing: (host: string) => Effect.succeed({ host, success: false }),
      executeAll: () => Effect.succeed([]),
      executeHosts: () => Effect.succeed([]),
    }),
    Layer.succeed(SpeedTestRunner, {
      run: () =>
        Effect.succeed({
          result: { timestamp: new Date() },
          persisted: true,
        }),
      runIfIdle: () =>
        Effect.succeed(
          Option.some({ result: { timestamp: new Date() }, persisted: true })
        ),
      isRunning: () => Effect.succeed(false),
    })
  );

  const ProvidedApiLayer = ApiServiceLayer.pipe(
    Layer.provide(Layer.mergeAll(MockServicesLayer, AuthLayer)),
    Layer.provide(HttpServer.layerServices),
    Layer.provide(HttpRouter.layer)
  );

  // HttpApiBuilder leaves each handler's own requirements to be satisfied per
  // request, through toWebHandler's context argument.
  const requestContext = MockServicesLayer.pipe(
    Layer.build,
    Effect.scoped,
    Effect.runSync
  );

  const { handler, dispose } = HttpRouter.toWebHandler(ProvidedApiLayer);
  return {
    handler: (request: Request) => handler(request, requestContext),
    dispose,
  };
};
