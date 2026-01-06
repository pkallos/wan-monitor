import { createServer } from "node:http";
import { HttpApiBuilder, HttpMiddleware } from "@effect/platform";
import { NodeHttpServer } from "@effect/platform-node";
import { Effect, Layer } from "effect";

import { ConfigService } from "@/infrastructure/config/config";

export const NodeHttpServerLayer = Layer.unwrapEffect(
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

export const ApiServerLive = HttpApiBuilder.serve(HttpMiddleware.logger);
