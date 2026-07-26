import { createServer } from "node:http";
import { NodeHttpServer } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";

import { ApiServiceLayer } from "@/core/api/service";
import { ConfigService } from "@/infrastructure/config/config";

export const NodeHttpServerLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ConfigService;
    yield* Effect.log(
      `Effect-TS API server listening on http://${config.server.host}:${config.server.port}`
    );
    return NodeHttpServer.layer(createServer, {
      port: config.server.port,
    });
  })
);

// v4's HttpRouter.serve logs requests by default (disableLogger defaults to
// false), replacing v3's explicit HttpApiBuilder.serve(HttpMiddleware.logger).
export const ApiServerLive = HttpRouter.serve(ApiServiceLayer);
