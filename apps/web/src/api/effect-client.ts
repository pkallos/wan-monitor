import { WanMonitorApi } from "@shared/api";
import { Context, Effect, Layer } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";
import { TOKEN_KEY } from "@/constants/auth";

const API_BASE = import.meta.env.VITE_API_URL || "";

export class WanMonitorClient extends Context.Service<WanMonitorClient>()(
  "WanMonitorClient",
  {
    make: Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;

      const clientWithAuth = httpClient.pipe(
        HttpClient.mapRequest((request) => {
          const token = localStorage.getItem(TOKEN_KEY);
          if (token) {
            return HttpClientRequest.setHeader(
              request,
              "Authorization",
              `Bearer ${token}`
            );
          }
          return request;
        })
      );

      const client = yield* HttpApiClient.make(WanMonitorApi, {
        baseUrl: API_BASE,
        transformClient: () => clientWithAuth,
      });

      return client;
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(FetchHttpClient.layer)
  );
}

export { WanMonitorApi };
