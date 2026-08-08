import { Effect, Layer, Option } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { KeyValueStore } from "effect/unstable/persistence";
import { describe, expect, test } from "vitest";
import {
  fetchConnectivityStatus,
  fetchEarliestData,
  fetchLiveConnectivity,
  fetchMetrics,
  fetchSpeedtestHistory,
  loadTheme,
  saveTheme,
  triggerSpeedtest,
} from "@/dashboard/command";
import { Custom, Preset } from "@/dashboard/dateRange";

const DEFAULT_DATE_RANGE = Preset({ preset: "last30d" });
// A 1h span lands in the granularity threshold's "<= 6 hours" branch, and
// Custom resolves to this window regardless of the real clock.
const ONE_HOUR_RANGE = Custom({
  startTime: "2026-07-26T00:00:00.000Z",
  endTime: "2026-07-26T01:00:00.000Z",
});
// A 24h span lands exactly on the granularity threshold's "<= 1 day" branch,
// and Custom resolves to this window regardless of the real clock.
const ONE_DAY_RANGE = Custom({
  startTime: "2026-07-26T00:00:00.000Z",
  endTime: "2026-07-27T00:00:00.000Z",
});
// A 30-day span is at/above the speedtest aggregation threshold, and Custom
// resolves to this window regardless of the real clock.
const THIRTY_DAY_RANGE = Custom({
  startTime: "2026-06-27T00:00:00.000Z",
  endTime: "2026-07-27T00:00:00.000Z",
});
const ALL_TIME_RANGE = Preset({ preset: "allTime" });

const mockHttpClient = (status: number, body: unknown) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json" },
          })
        )
      )
    )
  );

const capturingHttpClient = (
  capturedParams: Array<ReadonlyArray<readonly [string, string]>>,
  body: unknown
) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      capturedParams.push(Array.from(request.urlParams));
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        )
      );
    })
  );

const failingKeyValueStore = Layer.succeed(
  KeyValueStore.KeyValueStore,
  KeyValueStore.make({
    get: () => Effect.succeed(undefined),
    getUint8Array: () => Effect.succeed(undefined),
    set: () =>
      Effect.fail(
        new KeyValueStore.KeyValueStoreError({
          message: "storage is full",
          method: "set",
        })
      ),
    remove: () => Effect.succeed(undefined),
    clear: Effect.succeed(undefined),
    size: Effect.succeed(0),
  })
);

describe("fetchMetrics", () => {
  test("decodes a successful response into SucceededFetchMetrics", async () => {
    const result = await fetchMetrics({
      token: "abc",
      dateRange: DEFAULT_DATE_RANGE,
    }).pipe(
      Effect.provide(
        mockHttpClient(200, {
          data: [
            {
              timestamp: "2026-07-26T00:30:00.000Z",
              source: "ping",
              latency: 12.5,
            },
          ],
          meta: {
            startTime: "2026-07-26T00:00:00.000Z",
            endTime: "2026-07-26T01:00:00.000Z",
            count: 1,
          },
        })
      ),
      Effect.runPromise
    );

    expect(result._tag).toBe("SucceededFetchMetrics");
    expect(result).toMatchObject({
      metrics: [
        {
          timestamp: "2026-07-26T00:30:00.000Z",
          source: "ping",
          latency: 12.5,
        },
      ],
    });
    if (result._tag === "SucceededFetchMetrics") {
      // Sanity-check nowMs is a real current timestamp, not a fixed 50ms
      // tolerance which flakes under CI/coverage-instrumentation overhead.
      expect(Math.abs(result.nowMs - Date.now())).toBeLessThan(5000);
    }
  });

  test("maps a DB_UNAVAILABLE response into a distinguishable, friendly message", async () => {
    const result = await fetchMetrics({
      token: "abc",
      dateRange: DEFAULT_DATE_RANGE,
    }).pipe(
      Effect.provide(
        mockHttpClient(503, {
          error: "DB_UNAVAILABLE",
          message: "Database temporarily unavailable",
          timestamp: "2026-07-26T00:30:00.000Z",
        })
      ),
      Effect.runPromise
    );

    expect(result).toEqual({
      _tag: "FailedFetchMetrics",
      error: "Database temporarily unavailable. Retrying automatically.",
    });
  });

  test("requests server-side aggregation for the range's granularity", async () => {
    const capturedParams: Array<ReadonlyArray<readonly [string, string]>> = [];

    await fetchMetrics({ token: "abc", dateRange: ONE_DAY_RANGE }).pipe(
      Effect.provide(
        capturingHttpClient(capturedParams, {
          data: [],
          meta: {
            startTime: "2026-07-26T00:00:00.000Z",
            endTime: "2026-07-27T00:00:00.000Z",
            count: 0,
          },
        })
      ),
      Effect.runPromise
    );

    expect(capturedParams[0]).toContainEqual(["granularity", "5m"]);
  });

  test("asks for ping rows only, so speedtest rows can't share a bucket", async () => {
    const capturedParams: Array<ReadonlyArray<readonly [string, string]>> = [];

    await fetchMetrics({ token: "abc", dateRange: ONE_DAY_RANGE }).pipe(
      Effect.provide(
        capturingHttpClient(capturedParams, {
          data: [],
          meta: {
            startTime: "2026-07-26T00:00:00.000Z",
            endTime: "2026-07-27T00:00:00.000Z",
            count: 0,
          },
        })
      ),
      Effect.runPromise
    );

    expect(capturedParams[0]).toContainEqual(["source", "ping"]);
  });

  test("reports back the window it actually requested, so the paint step can reuse it", async () => {
    const capturedParams: Array<ReadonlyArray<readonly [string, string]>> = [];

    const result = await fetchMetrics({
      token: "abc",
      dateRange: DEFAULT_DATE_RANGE,
    }).pipe(
      Effect.provide(
        capturingHttpClient(capturedParams, {
          data: [],
          meta: { startTime: "", endTime: "", count: 0 },
        })
      ),
      Effect.runPromise
    );

    const requested = new Map(capturedParams[0]);
    expect(result._tag).toBe("SucceededFetchMetrics");
    if (result._tag !== "SucceededFetchMetrics") return;
    expect(result.startTimeMs).toBe(
      Date.parse(requested.get("startTime") ?? "")
    );
    expect(result.endTimeMs).toBe(Date.parse(requested.get("endTime") ?? ""));
    expect(result.granularity).toBe(requested.get("granularity"));
  });

  // `ytd` spans a window that grows with the wall clock, so re-resolving it a
  // moment later can cross a `granularityForRange` threshold. The reported
  // granularity has to be the one the request carried, or the paint step would
  // re-bucket server-aggregated rows at a different interval.
  test("a growing preset reports the same granularity it requested", async () => {
    const capturedParams: Array<ReadonlyArray<readonly [string, string]>> = [];

    const result = await fetchMetrics({
      token: "abc",
      dateRange: Preset({ preset: "ytd" }),
    }).pipe(
      Effect.provide(
        capturingHttpClient(capturedParams, {
          data: [],
          meta: { startTime: "", endTime: "", count: 0 },
        })
      ),
      Effect.runPromise
    );

    if (result._tag !== "SucceededFetchMetrics") {
      throw new Error("expected a successful metrics fetch");
    }
    expect(new Map(capturedParams[0]).get("granularity")).toBe(
      result.granularity
    );
  });

  test("resolves the allTime preset's start from maybeEarliestDataMs, not the epoch", async () => {
    const capturedParams: Array<ReadonlyArray<readonly [string, string]>> = [];
    const earliestDataMs = Date.parse("2025-01-01T00:00:00.000Z");

    await fetchMetrics({
      token: "abc",
      dateRange: ALL_TIME_RANGE,
      maybeEarliestDataMs: Option.some(earliestDataMs),
    }).pipe(
      Effect.provide(
        capturingHttpClient(capturedParams, {
          data: [],
          meta: { startTime: "", endTime: "", count: 0 },
        })
      ),
      Effect.runPromise
    );

    expect(capturedParams[0]).toContainEqual([
      "startTime",
      "2025-01-01T00:00:00.000Z",
    ]);
  });
});

describe("fetchSpeedtestHistory", () => {
  test("decodes a successful response into SucceededFetchSpeedtestHistory", async () => {
    const result = await fetchSpeedtestHistory({
      token: "abc",
      dateRange: DEFAULT_DATE_RANGE,
    }).pipe(
      Effect.provide(
        mockHttpClient(200, {
          data: [
            {
              timestamp: "2026-07-26T00:30:00.000Z",
              download_speed: 100_000_000,
              upload_speed: 20_000_000,
              latency: 12.5,
            },
          ],
          meta: {
            startTime: "2026-07-26T00:00:00.000Z",
            endTime: "2026-07-26T01:00:00.000Z",
            count: 1,
          },
        })
      ),
      Effect.runPromise
    );

    expect(result._tag).toBe("SucceededFetchSpeedtestHistory");
  });

  test("maps a DB_UNAVAILABLE response into a distinguishable, friendly message", async () => {
    const result = await fetchSpeedtestHistory({
      token: "abc",
      dateRange: DEFAULT_DATE_RANGE,
    }).pipe(
      Effect.provide(
        mockHttpClient(503, {
          error: "DB_UNAVAILABLE",
          message: "Database temporarily unavailable",
          timestamp: "2026-07-26T00:30:00.000Z",
        })
      ),
      Effect.runPromise
    );

    expect(result).toEqual({
      _tag: "FailedFetchSpeedtestHistory",
      error: "Database temporarily unavailable. Retrying automatically.",
    });
  });

  test("sends no granularity for a range under the aggregation threshold, requesting raw rows", async () => {
    const capturedParams: Array<ReadonlyArray<readonly [string, string]>> = [];

    await fetchSpeedtestHistory({
      token: "abc",
      dateRange: ONE_DAY_RANGE,
    }).pipe(
      Effect.provide(
        capturingHttpClient(capturedParams, {
          data: [],
          meta: {
            startTime: "2026-07-26T00:00:00.000Z",
            endTime: "2026-07-27T00:00:00.000Z",
            count: 0,
          },
        })
      ),
      Effect.runPromise
    );

    expect(capturedParams[0].map(([key]) => key)).not.toContain("granularity");
  });

  test("requests server-side aggregation for a range at/above the aggregation threshold", async () => {
    const capturedParams: Array<ReadonlyArray<readonly [string, string]>> = [];

    await fetchSpeedtestHistory({
      token: "abc",
      dateRange: THIRTY_DAY_RANGE,
    }).pipe(
      Effect.provide(
        capturingHttpClient(capturedParams, {
          data: [],
          meta: {
            startTime: "2026-06-27T00:00:00.000Z",
            endTime: "2026-07-27T00:00:00.000Z",
            count: 0,
          },
        })
      ),
      Effect.runPromise
    );

    expect(capturedParams[0]).toContainEqual(["granularity", "1h"]);
  });

  test("reports back the window it requested, with no granularity for raw rows", async () => {
    const result = await fetchSpeedtestHistory({
      token: "abc",
      dateRange: ONE_DAY_RANGE,
    }).pipe(
      Effect.provide(
        mockHttpClient(200, {
          data: [],
          meta: {
            startTime: "2026-07-26T00:00:00.000Z",
            endTime: "2026-07-27T00:00:00.000Z",
            count: 0,
          },
        })
      ),
      Effect.runPromise
    );

    expect(result).toMatchObject({
      _tag: "SucceededFetchSpeedtestHistory",
      startTimeMs: Date.parse("2026-07-26T00:00:00.000Z"),
      endTimeMs: Date.parse("2026-07-27T00:00:00.000Z"),
    });
  });
});

describe("fetchConnectivityStatus", () => {
  test("decodes a successful response into SucceededFetchConnectivityStatus with uptimePercentage lifted from meta", async () => {
    const result = await fetchConnectivityStatus({
      token: "abc",
      dateRange: ONE_HOUR_RANGE,
    }).pipe(
      Effect.provide(
        mockHttpClient(200, {
          data: [
            {
              timestamp: "2026-07-26T00:30:00.000Z",
              status: "up",
              upPercentage: 100,
              downPercentage: 0,
              degradedPercentage: 0,
            },
          ],
          meta: {
            startTime: "2026-07-26T00:00:00.000Z",
            endTime: "2026-07-26T01:00:00.000Z",
            count: 1,
            uptimePercentage: 99.9,
            availabilityPercentage: 99.9,
          },
        })
      ),
      Effect.runPromise
    );

    expect(result._tag).toBe("SucceededFetchConnectivityStatus");
    expect(result).toMatchObject({
      points: [
        {
          timestamp: "2026-07-26T00:30:00.000Z",
          status: "up",
          upPercentage: 100,
          downPercentage: 0,
          degradedPercentage: 0,
        },
      ],
      uptimePercentage: 99.9,
      granularity: "1m",
    });
    if (result._tag === "SucceededFetchConnectivityStatus") {
      expect(result.endTimeMs - result.startTimeMs).toBeCloseTo(60 * 60 * 1000);
    }
  });

  test("maps a DB_UNAVAILABLE response into a distinguishable, friendly message", async () => {
    const result = await fetchConnectivityStatus({
      token: "abc",
      dateRange: DEFAULT_DATE_RANGE,
    }).pipe(
      Effect.provide(
        mockHttpClient(503, {
          error: "DB_UNAVAILABLE",
          message: "Database temporarily unavailable",
          timestamp: "2026-07-26T00:30:00.000Z",
        })
      ),
      Effect.runPromise
    );

    expect(result).toEqual({
      _tag: "FailedFetchConnectivityStatus",
      error: "Database temporarily unavailable. Retrying automatically.",
    });
  });

  test("requests server-side aggregation for the range's granularity", async () => {
    const capturedParams: Array<ReadonlyArray<readonly [string, string]>> = [];

    await fetchConnectivityStatus({
      token: "abc",
      dateRange: ONE_DAY_RANGE,
    }).pipe(
      Effect.provide(
        capturingHttpClient(capturedParams, {
          data: [],
          meta: {
            startTime: "2026-07-26T00:00:00.000Z",
            endTime: "2026-07-27T00:00:00.000Z",
            count: 0,
            uptimePercentage: 0,
            availabilityPercentage: 0,
          },
        })
      ),
      Effect.runPromise
    );

    expect(capturedParams[0]).toContainEqual(["granularity", "5m"]);
  });
});

describe("fetchLiveConnectivity", () => {
  test("decodes a live status and its sample time", async () => {
    const result = await fetchLiveConnectivity({ token: "abc" }).pipe(
      Effect.provide(
        mockHttpClient(200, {
          status: "degraded",
          lastSampleAt: "2026-07-26T00:30:00.000Z",
          windowSeconds: 60,
        })
      ),
      Effect.runPromise
    );

    expect(result).toEqual({
      _tag: "SucceededFetchLiveConnectivity",
      status: "degraded",
      maybeLastSampleAtMs: Option.some(Date.parse("2026-07-26T00:30:00.000Z")),
    });
  });

  test("decodes a noInfo status with no recorded sample into None", async () => {
    const result = await fetchLiveConnectivity({ token: "abc" }).pipe(
      Effect.provide(
        mockHttpClient(200, {
          status: "noInfo",
          lastSampleAt: null,
          windowSeconds: 60,
        })
      ),
      Effect.runPromise
    );

    expect(result).toEqual({
      _tag: "SucceededFetchLiveConnectivity",
      status: "noInfo",
      maybeLastSampleAtMs: Option.none(),
    });
  });

  test("maps a DB_UNAVAILABLE response into a distinguishable, friendly message", async () => {
    const result = await fetchLiveConnectivity({ token: "abc" }).pipe(
      Effect.provide(
        mockHttpClient(503, {
          error: "DB_UNAVAILABLE",
          message: "Database temporarily unavailable",
          timestamp: "2026-07-26T00:30:00.000Z",
        })
      ),
      Effect.runPromise
    );

    expect(result).toEqual({
      _tag: "FailedFetchLiveConnectivity",
      error: "Database temporarily unavailable. Retrying automatically.",
    });
  });

  test("maps a transport failure into FailedFetchLiveConnectivity", async () => {
    const result = await fetchLiveConnectivity({ token: "abc" }).pipe(
      Effect.provide(mockHttpClient(500, "Internal error")),
      Effect.runPromise
    );

    expect(result._tag).toBe("FailedFetchLiveConnectivity");
  });

  // The whole point of the dedicated endpoint: no range parameters can reach
  // the wire, so no date range selection can influence the live indicator.
  test("sends no date-range query parameters at all", async () => {
    const capturedParams: Array<ReadonlyArray<readonly [string, string]>> = [];

    await fetchLiveConnectivity({ token: "abc" }).pipe(
      Effect.provide(
        capturingHttpClient(capturedParams, {
          status: "up",
          lastSampleAt: "2026-07-26T00:30:00.000Z",
          windowSeconds: 60,
        })
      ),
      Effect.runPromise
    );

    const keys = capturedParams[0].map(([key]) => key);
    expect(keys).not.toContain("startTime");
    expect(keys).not.toContain("endTime");
    expect(keys).not.toContain("granularity");
    expect(keys).toEqual([]);
  });
});

describe("fetchEarliestData", () => {
  test("decodes a present timestamp into Some", async () => {
    const result = await fetchEarliestData({ token: "abc" }).pipe(
      Effect.provide(
        mockHttpClient(200, { timestamp: "2025-01-01T00:00:00.000Z" })
      ),
      Effect.runPromise
    );

    expect(result).toEqual({
      _tag: "SucceededFetchEarliestData",
      earliestMs: Option.some(Date.parse("2025-01-01T00:00:00.000Z")),
    });
  });

  test("decodes a null timestamp (no data yet) into None", async () => {
    const result = await fetchEarliestData({ token: "abc" }).pipe(
      Effect.provide(mockHttpClient(200, { timestamp: null })),
      Effect.runPromise
    );

    expect(result).toEqual({
      _tag: "SucceededFetchEarliestData",
      earliestMs: Option.none(),
    });
  });

  test("maps a DB_UNAVAILABLE response into a distinguishable, friendly message", async () => {
    const result = await fetchEarliestData({ token: "abc" }).pipe(
      Effect.provide(
        mockHttpClient(503, {
          error: "DB_UNAVAILABLE",
          message: "Database temporarily unavailable",
          timestamp: "2026-07-26T00:30:00.000Z",
        })
      ),
      Effect.runPromise
    );

    expect(result).toEqual({
      _tag: "FailedFetchEarliestData",
      error: "Database temporarily unavailable. Retrying automatically.",
    });
  });
});

describe("triggerSpeedtest", () => {
  test("maps a successful trigger into SucceededTriggerSpeedtest", async () => {
    const result = await triggerSpeedtest({ token: "abc" }).pipe(
      Effect.provide(
        mockHttpClient(200, {
          success: true,
          timestamp: "2026-07-26T00:30:00.000Z",
          result: { downloadMbps: 500, uploadMbps: 50, pingMs: 8 },
        })
      ),
      Effect.runPromise
    );

    expect(result).toEqual({
      _tag: "SucceededTriggerSpeedtest",
      downloadMbps: 500,
      uploadMbps: 50,
      pingMs: 8,
    });
  });

  test("maps an already-running trigger into FailedTriggerSpeedtest", async () => {
    const result = await triggerSpeedtest({ token: "abc" }).pipe(
      Effect.provide(
        mockHttpClient(200, {
          success: false,
          timestamp: "2026-07-26T00:30:00.000Z",
          error: {
            code: "SPEED_TEST_ALREADY_RUNNING",
            message: "A speed test is already running",
          },
        })
      ),
      Effect.runPromise
    );

    expect(result).toEqual({
      _tag: "FailedTriggerSpeedtest",
      message: "A speed test is already running",
      isAlreadyRunning: true,
    });
  });

  test("maps a transport failure into a generic FailedTriggerSpeedtest", async () => {
    const result = await triggerSpeedtest({ token: "abc" }).pipe(
      Effect.provide(mockHttpClient(500, "Internal error")),
      Effect.runPromise
    );

    expect(result).toEqual({
      _tag: "FailedTriggerSpeedtest",
      message: "Something went wrong running the speed test.",
      isAlreadyRunning: false,
    });
  });
});

describe("loadTheme", () => {
  test("decodes a stored theme into LoadedTheme", async () => {
    const result = await Effect.gen(function* () {
      const store = yield* KeyValueStore.KeyValueStore;
      yield* store.set("wan_monitor_theme", "dark");
      return yield* loadTheme;
    }).pipe(Effect.provide(KeyValueStore.layerMemory), Effect.runPromise);

    expect(result).toEqual({ _tag: "LoadedTheme", theme: "dark" });
  });

  test("falls back to light with no stored value", async () => {
    const result = await loadTheme.pipe(
      Effect.provide(KeyValueStore.layerMemory),
      Effect.runPromise
    );

    expect(result).toEqual({ _tag: "LoadedTheme", theme: "light" });
  });
});

describe("saveTheme", () => {
  test("persists the theme and settles CompletedSaveTheme", async () => {
    const result = await Effect.gen(function* () {
      const settled = yield* saveTheme({ theme: "dark" });
      const store = yield* KeyValueStore.KeyValueStore;
      const stored = yield* store.get("wan_monitor_theme");
      return { settled, stored };
    }).pipe(Effect.provide(KeyValueStore.layerMemory), Effect.runPromise);

    expect(result.settled).toEqual({ _tag: "CompletedSaveTheme" });
    expect(result.stored).toBe("dark");
  });

  test("maps a storage failure into FailedSaveTheme", async () => {
    const result = await saveTheme({ theme: "dark" }).pipe(
      Effect.provide(failingKeyValueStore),
      Effect.runPromise
    );

    expect(result._tag).toBe("FailedSaveTheme");
  });
});
