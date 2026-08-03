import { Effect, Layer, Option } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { describe, expect, test } from "vitest";
import { makeClient } from "@/api/client";

const capturingHttpClient = (capturedHeaders: Array<Record<string, string>>) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      capturedHeaders.push({ ...request.headers });
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(
            JSON.stringify({
              status: "ok",
              timestamp: "2026-07-26T00:30:00.000Z",
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
        )
      );
    })
  );

const callHealth = (maybeToken: Option.Option<string>) => {
  const capturedHeaders: Array<Record<string, string>> = [];

  return makeClient(maybeToken).pipe(
    Effect.flatMap((client) => client.health.getLive()),
    Effect.provide(capturingHttpClient(capturedHeaders)),
    Effect.runPromise,
    (promise) => promise.then(() => capturedHeaders)
  );
};

describe("makeClient", () => {
  test("attaches a bearer Authorization header when a token is present", async () => {
    const capturedHeaders = await callHealth(Option.some("tok"));

    expect(capturedHeaders).toHaveLength(1);
    expect(capturedHeaders[0]?.authorization).toBe("Bearer tok");
  });

  test("sends no Authorization header when there is no token", async () => {
    const capturedHeaders = await callHealth(Option.none());

    expect(capturedHeaders).toHaveLength(1);
    expect(capturedHeaders[0]).not.toHaveProperty("authorization");
  });
});
