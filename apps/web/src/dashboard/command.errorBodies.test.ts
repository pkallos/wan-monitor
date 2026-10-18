// @vitest-environment node
// happy-dom makes Effect 4.0.0's HttpApiClient die on these bodies instead of failing.
import { Effect, Layer, Option } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { describe, expect, test, vi } from "vitest";
import {
  fetchConnectivityStatus,
  fetchEarliestData,
  fetchHostLatency,
  fetchLiveConnectivity,
  fetchMetrics,
  fetchOutages,
  fetchPingHosts,
  fetchSpeedtestHistory,
  fetchSummary,
  triggerSpeedtest,
} from "@/dashboard/command";
import { Preset } from "@/dashboard/dateRange";
import {
  FailedFetchConnectivityStatus,
  FailedFetchEarliestData,
  FailedFetchHostLatency,
  FailedFetchLiveConnectivity,
  FailedFetchMetrics,
  FailedFetchOutages,
  FailedFetchPingHosts,
  FailedFetchSpeedtestHistory,
  FailedFetchSummary,
  FailedTriggerSpeedtest,
  type Message,
} from "@/dashboard/message";

// Node has no page origin to resolve the client's relative request URLs
// against, so without a base the requests fail before any response is read.
vi.hoisted(() => vi.stubEnv("VITE_API_URL", "http://localhost"));

const REQUEST = {
  dateRange: Preset({ preset: "last30d" }),
  maybeEarliestDataMs: Option.none<number>(),
};
const FAILED = "Request failed";

type ErrorBody = {
  readonly name: string;
  readonly status: number;
  readonly body: string;
  readonly contentType?: string;
};

const html = (name: string, status: number): ErrorBody => ({
  name,
  status,
  body: "<html></html>",
  contentType: "text/html",
});

// Every API group declares 401, so this body reaches the declared-status path
// of every fetch.
const UNAUTHORIZED_HTML = html("401 text/html", 401);

const OTHER_ERROR_BODIES: ReadonlyArray<ErrorBody> = [
  { name: "500 with an empty body", status: 500, body: "" },
  html("500 text/html", 500),
  { name: "503 with an empty body", status: 503, body: "" },
  html("503 text/html", 503),
  {
    name: "503 text/plain",
    status: 503,
    body: "no available server",
    contentType: "text/plain",
  },
  html("400 text/html", 400),
  html("502 text/html", 502),
];

const rawHttpClient = ({ status, body, contentType }: ErrorBody) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(body === "" ? null : body, {
            status,
            headers:
              contentType === undefined ? {} : { "content-type": contentType },
          })
        )
      )
    )
  );

const fetchesFor = (
  maybeToken: Option.Option<string>
): ReadonlyArray<
  readonly [
    string,
    Effect.Effect<Message, never, HttpClient.HttpClient>,
    Message,
  ]
> => [
  [
    "fetchMetrics",
    fetchMetrics({ maybeToken, ...REQUEST }),
    FailedFetchMetrics({ request: REQUEST, error: FAILED }),
  ],
  [
    "fetchSpeedtestHistory",
    fetchSpeedtestHistory({ maybeToken, ...REQUEST }),
    FailedFetchSpeedtestHistory({ request: REQUEST, error: FAILED }),
  ],
  [
    "fetchConnectivityStatus",
    fetchConnectivityStatus({ maybeToken, ...REQUEST }),
    FailedFetchConnectivityStatus({ request: REQUEST, error: FAILED }),
  ],
  [
    "fetchLiveConnectivity",
    fetchLiveConnectivity({ maybeToken }),
    FailedFetchLiveConnectivity({ error: FAILED }),
  ],
  [
    "fetchSummary",
    fetchSummary({ maybeToken, ...REQUEST }),
    FailedFetchSummary({ request: REQUEST, error: FAILED }),
  ],
  [
    "fetchOutages",
    fetchOutages({ maybeToken, ...REQUEST }),
    FailedFetchOutages({ request: REQUEST, error: FAILED }),
  ],
  [
    "fetchHostLatency",
    fetchHostLatency({ maybeToken, ...REQUEST, hosts: ["8.8.8.8"] }),
    FailedFetchHostLatency({ request: REQUEST, error: FAILED }),
  ],
  [
    "fetchPingHosts",
    fetchPingHosts({ maybeToken }),
    FailedFetchPingHosts({ error: FAILED }),
  ],
  [
    "fetchEarliestData",
    fetchEarliestData({ maybeToken }),
    FailedFetchEarliestData({ error: FAILED }),
  ],
  [
    "triggerSpeedtest",
    triggerSpeedtest({ maybeToken }),
    FailedTriggerSpeedtest({
      message: "Speed test request failed.",
      isAlreadyRunning: false,
    }),
  ],
];

const FETCHES = fetchesFor(Option.some("abc"));

const resolveWith = (
  effect: Effect.Effect<Message, never, HttpClient.HttpClient>,
  errorBody: ErrorBody
) => effect.pipe(Effect.provide(rawHttpClient(errorBody)), Effect.runPromise);

describe("a 401 text/html response", () => {
  test.each(FETCHES)(
    "%s resolves to its failure message",
    async (_name, effect, expected) => {
      expect(await resolveWith(effect, UNAUTHORIZED_HTML)).toEqual(expected);
    }
  );
});

describe("fetchMetrics given other error responses", () => {
  const [, effect, expected] = FETCHES[0] ?? [];

  test.each(OTHER_ERROR_BODIES)(
    "$name resolves to its failure message",
    async (errorBody) => {
      expect(await resolveWith(effect, errorBody)).toEqual(expected);
    }
  );
});

describe("Authorization header", () => {
  const authorizationSent = async (
    effect: Effect.Effect<Message, never, HttpClient.HttpClient>
  ) => {
    const sent: Array<string | undefined> = [];
    const client = Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) => {
        sent.push(request.headers.authorization);
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response("{}", {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          )
        );
      })
    );
    await effect.pipe(Effect.provide(client), Effect.runPromise);
    return sent;
  };

  test.each(fetchesFor(Option.some("abc")))(
    "%s sends the bearer token it was given",
    async (_name, effect) => {
      expect(await authorizationSent(effect)).toEqual(["Bearer abc"]);
    }
  );

  test.each(fetchesFor(Option.none()))(
    "%s sends no Authorization header without a token",
    async (_name, effect) => {
      expect(await authorizationSent(effect)).toEqual([undefined]);
    }
  );
});
