import { describe, expect, it } from "@effect/vitest";
import type { Metric } from "@wan-monitor/shared";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import {
  getEarliestTimestampHandler,
  getMetricsHandler,
} from "@/core/api/handlers/metrics";
import {
  QuestDB,
  type QuestDBService,
} from "@/infrastructure/database/questdb";
import type { QueryMetricsParams } from "@/infrastructure/database/questdb/model";
import { invalidTimeRangeOf } from "@/test/invalid-time-range";
import { emptyAnalyticsQueries } from "@/test/questdb-stubs";

const createMockQuestDB = (mockData: Metric[]): QuestDBService => ({
  health: () =>
    Effect.succeed({ connected: true, version: "1.0.0", uptime: 100 }),
  writeMetric: () => Effect.void,
  flush: () => Effect.void,
  queryMetrics: () => Effect.succeed(mockData),
  querySpeedtests: () => Effect.succeed([]),
  queryConnectivityStatus: () => Effect.succeed([]),
  queryLiveConnectivity: () => Effect.succeed(null),
  queryEarliestTimestamp: () => Effect.succeed(null),
  queryLatestPingTimestamp: () => Effect.succeed(null),
  ...emptyAnalyticsQueries,
  close: () => Effect.void,
});

describe("Metrics Handlers", () => {
  describe("getMetrics", () => {
    it.effect("passes a bucket's latency percentiles through", () => {
      const QuestDBTest = Layer.succeed(
        QuestDB,
        createMockQuestDB([
          {
            timestamp: "2024-01-01T00:00:00Z",
            source: "ping",
            latency: 12,
            latency_p50: 11,
            latency_p95: 30,
          },
        ])
      );

      return Effect.gen(function* () {
        const result = yield* getMetricsHandler({ query: {} });

        expect(result.data[0]).toMatchObject({
          latency_p50: 11,
          latency_p95: 30,
        });
      }).pipe(Effect.provide(QuestDBTest));
    });

    it.effect("returns metrics data with metadata", () => {
      const mockData: Metric[] = [
        {
          timestamp: "2024-01-01T00:00:00Z",
          source: "ping",
          host: "8.8.8.8",
          latency: 10,
        },
        {
          timestamp: "2024-01-01T00:01:00Z",
          source: "ping",
          host: "8.8.8.8",
          latency: 12,
        },
      ];
      const QuestDBTest = Layer.succeed(QuestDB, createMockQuestDB(mockData));

      return Effect.gen(function* () {
        const result = yield* getMetricsHandler({ query: {} });

        expect(result.data).toEqual(mockData);
        expect(result.meta.count).toBe(2);
        expect(result.meta.startTime).toBeDefined();
        expect(result.meta.endTime).toBeDefined();
      }).pipe(Effect.provide(QuestDBTest));
    });

    it.effect("uses provided time range in metadata", () => {
      const QuestDBTest = Layer.succeed(QuestDB, createMockQuestDB([]));
      const startTime = "2024-01-01T00:00:00Z";
      const endTime = "2024-01-02T00:00:00Z";

      return Effect.gen(function* () {
        const result = yield* getMetricsHandler({
          query: { startTime, endTime },
        });

        expect(result.meta.startTime).toBe("2024-01-01T00:00:00.000Z");
        expect(result.meta.endTime).toBe("2024-01-02T00:00:00.000Z");
      }).pipe(Effect.provide(QuestDBTest));
    });

    it.effect("passes the requested source down to the query", () => {
      const seenParams: QueryMetricsParams[] = [];
      const QuestDBTest = Layer.succeed(QuestDB, {
        ...createMockQuestDB([]),
        queryMetrics: (params: QueryMetricsParams) => {
          seenParams.push(params);
          return Effect.succeed([]);
        },
      });

      return Effect.gen(function* () {
        yield* getMetricsHandler({ query: { source: "ping" } });
        yield* getMetricsHandler({ query: {} });

        expect(seenParams[0].source).toBe("ping");
        expect(seenParams[1].source).toBeUndefined();
      }).pipe(Effect.provide(QuestDBTest));
    });

    it.effect("passes the requested percentiles down to the query", () => {
      const seenParams: QueryMetricsParams[] = [];
      const QuestDBTest = Layer.succeed(QuestDB, {
        ...createMockQuestDB([]),
        queryMetrics: (params: QueryMetricsParams) => {
          seenParams.push(params);
          return Effect.succeed([]);
        },
      });

      return Effect.gen(function* () {
        yield* getMetricsHandler({ query: { percentiles: "p50" } });
        yield* getMetricsHandler({ query: { percentiles: "p50-p95" } });
        yield* getMetricsHandler({ query: {} });

        expect(seenParams.map(({ percentiles }) => percentiles)).toEqual([
          "p50",
          "p50-p95",
          undefined,
        ]);
      }).pipe(Effect.provide(QuestDBTest));
    });

    it.effect(
      "passes the host, limit and granularity down to the query",
      () => {
        const seenParams: QueryMetricsParams[] = [];
        const QuestDBTest = Layer.succeed(QuestDB, {
          ...createMockQuestDB([]),
          queryMetrics: (params: QueryMetricsParams) => {
            seenParams.push(params);
            return Effect.succeed([]);
          },
        });

        return Effect.gen(function* () {
          yield* getMetricsHandler({
            query: { host: "8.8.8.8", limit: 5, granularity: "5m" },
          });

          expect(seenParams).toHaveLength(1);
          expect(seenParams[0]).toMatchObject({
            host: "8.8.8.8",
            limit: 5,
            granularity: "5m",
          });
        }).pipe(Effect.provide(QuestDBTest));
      }
    );

    it.effect(
      "default time window uses Clock.currentTimeMillis (TestClock)",
      () => {
        const QuestDBTest = Layer.succeed(QuestDB, createMockQuestDB([]));
        const fixedNow = new Date("2025-01-15T12:00:00Z").getTime();

        return Effect.gen(function* () {
          yield* TestClock.setTime(fixedNow);

          const result = yield* getMetricsHandler({ query: {} });

          // Default window is now-1h to now
          expect(result.meta.startTime).toBe(
            new Date(fixedNow - 3600000).toISOString()
          );
          expect(result.meta.endTime).toBe(new Date(fixedNow).toISOString());
        }).pipe(Effect.provide(QuestDBTest));
      }
    );
  });

  describe("getMetrics time window", () => {
    const seenParamsLayer = (seen: QueryMetricsParams[]) =>
      Layer.succeed(QuestDB, {
        ...createMockQuestDB([]),
        queryMetrics: (params: QueryMetricsParams) => {
          seen.push(params);
          return Effect.succeed([]);
        },
      });

    it.effect("rejects a reversed range before querying", () => {
      const seen: QueryMetricsParams[] = [];

      return Effect.gen(function* () {
        const error = yield* invalidTimeRangeOf(
          getMetricsHandler({
            query: {
              startTime: "2024-01-02T00:00:00Z",
              endTime: "2024-01-01T00:00:00Z",
            },
          })
        );

        expect(error.message).toContain("startTime");
        expect(seen).toEqual([]);
      }).pipe(Effect.provide(seenParamsLayer(seen)));
    });

    it.effect(
      "queries the same explicit window it reports in meta when none is given",
      () => {
        const seen: QueryMetricsParams[] = [];
        const fixedNow = new Date("2025-01-15T12:00:00Z").getTime();

        return Effect.gen(function* () {
          yield* TestClock.setTime(fixedNow);

          const result = yield* getMetricsHandler({ query: {} });

          expect(seen[0].startTime).toEqual(new Date(fixedNow - 3600000));
          expect(seen[0].endTime).toEqual(new Date(fixedNow));
          expect(result.meta.startTime).toBe(seen[0].startTime?.toISOString());
          expect(result.meta.endTime).toBe(seen[0].endTime?.toISOString());
        }).pipe(Effect.provide(seenParamsLayer(seen)));
      }
    );

    it.effect("trails a lone endTime by the default span", () => {
      const seen: QueryMetricsParams[] = [];

      return Effect.gen(function* () {
        yield* getMetricsHandler({
          query: { endTime: "2024-01-01T10:00:00Z" },
        });

        expect(seen[0].startTime).toEqual(new Date("2024-01-01T09:00:00Z"));
        expect(seen[0].endTime).toEqual(new Date("2024-01-01T10:00:00Z"));
      }).pipe(Effect.provide(seenParamsLayer(seen)));
    });
  });

  describe("getEarliestTimestamp", () => {
    it.effect("returns the DB's earliest timestamp when present", () => {
      const QuestDBTest = Layer.succeed(QuestDB, {
        ...createMockQuestDB([]),
        queryEarliestTimestamp: () =>
          Effect.succeed("2024-01-01T00:00:00.000000Z"),
      });

      return Effect.gen(function* () {
        const result = yield* getEarliestTimestampHandler();

        expect(result.timestamp).toBe("2024-01-01T00:00:00.000000Z");
      }).pipe(Effect.provide(QuestDBTest));
    });

    it.effect("returns null when the DB has no data", () => {
      const QuestDBTest = Layer.succeed(QuestDB, createMockQuestDB([]));

      return Effect.gen(function* () {
        const result = yield* getEarliestTimestampHandler();

        expect(result.timestamp).toBeNull();
      }).pipe(Effect.provide(QuestDBTest));
    });
  });
});
