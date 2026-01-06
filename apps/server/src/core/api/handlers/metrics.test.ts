import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { getMetricsHandler } from "@/core/api/handlers/metrics";
import {
  QuestDB,
  type QuestDBService,
} from "@/infrastructure/database/questdb";
import type { MetricRow } from "@/infrastructure/database/questdb/model";

const createMockQuestDB = (mockData: MetricRow[]): QuestDBService => ({
  health: () =>
    Effect.succeed({ connected: true, version: "1.0.0", uptime: 100 }),
  writeMetric: () => Effect.void,
  queryMetrics: () => Effect.succeed(mockData),
  querySpeedtests: () => Effect.succeed([]),
  queryConnectivityStatus: () => Effect.succeed([]),
  close: () => Effect.void,
});

describe("Metrics Handlers", () => {
  describe("getMetrics", () => {
    it.effect("returns metrics data with metadata", () => {
      const mockData: MetricRow[] = [
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
        const result = yield* getMetricsHandler({ urlParams: {} });

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
          urlParams: { startTime, endTime },
        });

        expect(result.meta.startTime).toBe(startTime);
        expect(result.meta.endTime).toBe(endTime);
      }).pipe(Effect.provide(QuestDBTest));
    });
  });
});
