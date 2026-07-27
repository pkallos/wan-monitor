import { Effect, Layer } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { KeyValueStore } from "effect/unstable/persistence";
import { describe, expect, test } from "vitest";
import {
  fetchConnectivityStatus,
  fetchMetrics,
  fetchSpeedtestHistory,
  loadTheme,
  saveTheme,
  triggerSpeedtest,
} from "@/dashboard/command";

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
      timeRange: "1h",
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
      expect(result.nowMs).toBeCloseTo(Date.now(), -2);
    }
  });

  test("maps a DB_UNAVAILABLE response into a distinguishable, friendly message", async () => {
    const result = await fetchMetrics({
      token: "abc",
      timeRange: "1h",
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

    await fetchMetrics({ token: "abc", timeRange: "24h" }).pipe(
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
});

describe("fetchSpeedtestHistory", () => {
  test("decodes a successful response into SucceededFetchSpeedtestHistory", async () => {
    const result = await fetchSpeedtestHistory({
      token: "abc",
      timeRange: "1h",
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
      timeRange: "1h",
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
});

describe("fetchConnectivityStatus", () => {
  test("decodes a successful response into SucceededFetchConnectivityStatus with uptimePercentage lifted from meta", async () => {
    const result = await fetchConnectivityStatus({
      token: "abc",
      timeRange: "1h",
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
      timeRange: "1h",
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

    await fetchConnectivityStatus({ token: "abc", timeRange: "24h" }).pipe(
      Effect.provide(
        capturingHttpClient(capturedParams, {
          data: [],
          meta: {
            startTime: "2026-07-26T00:00:00.000Z",
            endTime: "2026-07-27T00:00:00.000Z",
            count: 0,
            uptimePercentage: 0,
          },
        })
      ),
      Effect.runPromise
    );

    expect(capturedParams[0]).toContainEqual(["granularity", "5m"]);
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
