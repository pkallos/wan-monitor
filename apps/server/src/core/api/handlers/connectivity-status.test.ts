import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { getConnectivityStatusHandler } from "@/core/api/handlers/connectivity-status";
import {
  QuestDB,
  type QuestDBService,
} from "@/infrastructure/database/questdb";
import type { ConnectivityStatusRow } from "@/infrastructure/database/questdb/model";

const createMockQuestDB = (mockRows: unknown[]): QuestDBService => ({
  health: () =>
    Effect.succeed({ connected: true, version: "1.0.0", uptime: 100 }),
  writeMetric: () => Effect.void,
  queryMetrics: () => Effect.succeed([]),
  querySpeedtests: () => Effect.succeed([]),
  queryConnectivityStatus: () =>
    Effect.succeed(mockRows as readonly ConnectivityStatusRow[]),
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
        const result = yield* getConnectivityStatusHandler({ urlParams: {} });

        expect(result.data).toHaveLength(2);
        expect(result.data[0].status).toBe("up");
        expect(result.data[0].upPercentage).toBe(100);
        expect(result.data[1].status).toBe("down");
        expect(result.data[1].downPercentage).toBe(20);
        expect(result.meta.uptimePercentage).toBe(90);
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
        const result = yield* getConnectivityStatusHandler({ urlParams: {} });

        expect(result.data[0].status).toBe("degraded");
        expect(result.data[0].degradedPercentage).toBe(30);
      }).pipe(Effect.provide(QuestDBTest));
    });
  });
});
