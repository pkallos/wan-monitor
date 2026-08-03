import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { vi } from "vitest";
import { getConnectivityStatusHandler } from "@/core/api/handlers/connectivity-status";
import {
  QuestDB,
  type QuestDBService,
} from "@/infrastructure/database/questdb";
import type {
  ConnectivityStatusRow,
  QueryMetricsParams,
} from "@/infrastructure/database/questdb/model";

const createMockQuestDB = (
  mockRows: unknown[],
  onQuery?: (params: QueryMetricsParams) => void
): QuestDBService => ({
  health: () =>
    Effect.succeed({ connected: true, version: "1.0.0", uptime: 100 }),
  writeMetric: () => Effect.void,
  flush: () => Effect.void,
  queryMetrics: () => Effect.succeed([]),
  querySpeedtests: () => Effect.succeed([]),
  queryConnectivityStatus: (params) => {
    onQuery?.(params);
    return Effect.succeed(mockRows as readonly ConnectivityStatusRow[]);
  },
  queryEarliestTimestamp: () => Effect.succeed(null),
  close: () => Effect.void,
});

describe("Connectivity Status Handlers", () => {
  describe("getConnectivityStatus", () => {
    it.effect("calculates status and percentages correctly", () => {
      const mockRows = [
        {
          timestamp: "2024-01-01T00:00:00Z",
          up_count: 10,
          down_count: 0,
          degraded_count: 0,
          total_count: 10,
        },
        {
          timestamp: "2024-01-01T01:00:00Z",
          up_count: 8,
          down_count: 2,
          degraded_count: 0,
          total_count: 10,
        },
      ];
      const QuestDBTest = Layer.succeed(QuestDB, createMockQuestDB(mockRows));

      return Effect.gen(function* () {
        const result = yield* getConnectivityStatusHandler({ query: {} });

        expect(result.data).toHaveLength(2);
        expect(result.data[0].status).toBe("up");
        expect(result.data[0].upPercentage).toBe(100);
        expect(result.data[1].status).toBe("down");
        expect(result.data[1].downPercentage).toBe(20);
        expect(result.meta.uptimePercentage).toBe(90);
        expect(result.meta.availabilityPercentage).toBe(90);
      }).pipe(Effect.provide(QuestDBTest));
    });

    it.effect("handles degraded status", () => {
      const mockRows = [
        {
          timestamp: "2024-01-01T00:00:00Z",
          up_count: 7,
          down_count: 0,
          degraded_count: 3,
          total_count: 10,
        },
      ];
      const QuestDBTest = Layer.succeed(QuestDB, createMockQuestDB(mockRows));

      return Effect.gen(function* () {
        const result = yield* getConnectivityStatusHandler({ query: {} });

        expect(result.data[0].status).toBe("degraded");
        expect(result.data[0].degradedPercentage).toBe(30);
      }).pipe(Effect.provide(QuestDBTest));
    });

    it.effect(
      "a single degraded cycle out of a large coarse bucket stays up, not degraded",
      () => {
        const mockRows = [
          {
            timestamp: "2024-01-01T00:00:00Z",
            up_count: 119,
            down_count: 0,
            degraded_count: 1,
            total_count: 120,
          },
        ];
        const QuestDBTest = Layer.succeed(QuestDB, createMockQuestDB(mockRows));

        return Effect.gen(function* () {
          const result = yield* getConnectivityStatusHandler({ query: {} });

          expect(result.data[0].status).toBe("up");
        }).pipe(Effect.provide(QuestDBTest));
      }
    );

    it.effect(
      "a sustained share of degraded cycles in a coarse bucket still reads as degraded",
      () => {
        const mockRows = [
          {
            timestamp: "2024-01-01T00:00:00Z",
            up_count: 108,
            down_count: 0,
            degraded_count: 12,
            total_count: 120,
          },
        ];
        const QuestDBTest = Layer.succeed(QuestDB, createMockQuestDB(mockRows));

        return Effect.gen(function* () {
          const result = yield* getConnectivityStatusHandler({ query: {} });

          expect(result.data[0].status).toBe("degraded");
        }).pipe(Effect.provide(QuestDBTest));
      }
    );

    it.effect(
      "availabilityPercentage counts degraded as available, unlike uptimePercentage",
      () => {
        const mockRows = [
          {
            timestamp: "2024-01-01T00:00:00Z",
            up_count: 7,
            down_count: 0,
            degraded_count: 3,
            total_count: 10,
          },
        ];
        const QuestDBTest = Layer.succeed(QuestDB, createMockQuestDB(mockRows));

        return Effect.gen(function* () {
          const result = yield* getConnectivityStatusHandler({ query: {} });

          expect(result.meta.uptimePercentage).toBe(70);
          expect(result.meta.availabilityPercentage).toBe(100);
        }).pipe(Effect.provide(QuestDBTest));
      }
    );

    it.effect("converts query start/end times to Dates before querying", () => {
      const onQuery = vi.fn();
      const QuestDBTest = Layer.succeed(
        QuestDB,
        createMockQuestDB([], onQuery)
      );

      return Effect.gen(function* () {
        yield* getConnectivityStatusHandler({
          query: {
            startTime: "2024-01-01T00:00:00Z",
            endTime: "2024-01-02T00:00:00Z",
            granularity: "1h",
          },
        });

        expect(onQuery).toHaveBeenCalledWith({
          startTime: new Date("2024-01-01T00:00:00Z"),
          endTime: new Date("2024-01-02T00:00:00Z"),
          granularity: "1h",
        });
      }).pipe(Effect.provide(QuestDBTest));
    });

    it.effect("falls back to a count of 1 to avoid division by zero", () => {
      const mockRows = [
        {
          timestamp: "2024-01-01T00:00:00Z",
          up_count: 0,
          down_count: 0,
          degraded_count: 0,
          total_count: 0,
        },
      ];
      const QuestDBTest = Layer.succeed(QuestDB, createMockQuestDB(mockRows));

      return Effect.gen(function* () {
        const result = yield* getConnectivityStatusHandler({ query: {} });

        expect(result.data[0].upPercentage).toBe(0);
        expect(result.data[0].downPercentage).toBe(0);
        expect(result.data[0].degradedPercentage).toBe(0);
      }).pipe(Effect.provide(QuestDBTest));
    });

    it.effect("reports 0 uptimePercentage when there are no rows", () => {
      const QuestDBTest = Layer.succeed(QuestDB, createMockQuestDB([]));

      return Effect.gen(function* () {
        const result = yield* getConnectivityStatusHandler({ query: {} });

        expect(result.data).toEqual([]);
        expect(result.meta.uptimePercentage).toBe(0);
        expect(result.meta.availabilityPercentage).toBe(0);
      }).pipe(Effect.provide(QuestDBTest));
    });
  });
});
