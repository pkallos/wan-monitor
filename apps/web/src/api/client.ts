import { WanMonitorApi } from "@shared/api";
import { Effect, Option } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";

const API_BASE = import.meta.env.VITE_API_URL || "";

/**
 * Requires `HttpClient.HttpClient` from context rather than baking in
 * `FetchHttpClient.layer` itself, so each Command can provide the real
 * transport in production and tests can substitute a mock one around the
 * same Command effect (see command.test.ts).
 */
export const makeClient = (maybeToken: Option.Option<string>) =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;

    const authedClient = Option.match(maybeToken, {
      onNone: () => httpClient,
      onSome: (token) =>
        httpClient.pipe(
          HttpClient.mapRequest((request) =>
            HttpClientRequest.setHeader(
              request,
              "Authorization",
              `Bearer ${token}`
            )
          )
        ),
    });

    return yield* HttpApiClient.make(WanMonitorApi, {
      baseUrl: API_BASE,
      transformClient: () => authedClient,
    });
  });

export { WanMonitorApi };
