import { Effect, Layer } from "effect";
import { HttpServer } from "effect/unstable/http";
import { describe, expect, it } from "vitest";
import { NodeHttpServerLayer } from "@/core/api/server";
import { makeTestConfigLayer } from "@/test/config";

const addressForConfig = (host: string) =>
  Effect.gen(function* () {
    const server = yield* HttpServer.HttpServer;
    return server.address;
  }).pipe(
    Effect.provide(
      NodeHttpServerLayer.pipe(
        Layer.provide(makeTestConfigLayer({ server: { host, port: 0 } }))
      )
    ),
    Effect.scoped,
    Effect.runPromise
  );

describe("NodeHttpServerLayer", () => {
  it("binds the listener to the configured host", async () => {
    const address = await addressForConfig("127.0.0.1");

    expect(address).toMatchObject({
      _tag: "TcpAddress",
      hostname: "127.0.0.1",
    });
  });
});
