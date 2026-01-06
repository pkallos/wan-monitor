import {
  FetchHttpClient,
  HttpApiClient,
  HttpClient,
  HttpClientRequest,
} from "@effect/platform";
import { WanMonitorApi } from "@shared/api";
import { Effect } from "effect";
import { TOKEN_KEY } from "@/constants/auth";

const API_BASE = import.meta.env.VITE_API_URL || "";

export class WanMonitorClient extends Effect.Service<WanMonitorClient>()(
  "WanMonitorClient",
  {
    dependencies: [FetchHttpClient.layer],
    effect: Effect.gen(function* () {
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
) {}

export { WanMonitorApi };
