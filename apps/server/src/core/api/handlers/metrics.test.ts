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

    it.effect("converts null values to undefined for optional fields", () => {
      // QuestDB returns null for missing values, while our TypeScript types use undefined.
      // This test verifies the handler correctly converts null -> undefined.
      // We use a type that represents the raw DB response shape with nullable fields.
      type RawMetricRow = {
        [K in keyof MetricRow]: MetricRow[K] | null;
      };

      const mockDataWithNulls: RawMetricRow[] = [
        {
          timestamp: "2024-01-01T12:00:00Z",
          source: "ping",
          host: null,
          latency: null,
          jitter: null,
          packet_loss: null,
          connectivity_status: null,
          download_speed: null,
          upload_speed: null,
          server_location: null,
          isp: null,
          external_ip: null,
          internal_ip: null,
        },
        {
          timestamp: "2024-01-01T12:01:00Z",
          source: "speedtest",
          host: null,
          latency: null,
          jitter: null,
          packet_loss: null,
          connectivity_status: null,
          download_speed: null,
          upload_speed: null,
          server_location: null,
          isp: null,
          external_ip: null,
          internal_ip: null,
        },
      ];

      const QuestDBTest = Layer.succeed(QuestDB, {
        ...createMockQuestDB([]),
        // Cast to MetricRow[] since that's what the service interface expects,
        // but QuestDB actually returns nullable fields at runtime
        queryMetrics: () => Effect.succeed(mockDataWithNulls as MetricRow[]),
      });

      return Effect.gen(function* () {
        const result = yield* getMetricsHandler({ urlParams: {} });

        expect(result.data).toHaveLength(2);

        expect(result.data[0].host).toBeUndefined();
        expect(result.data[0].latency).toBeUndefined();
        expect(result.data[0].jitter).toBeUndefined();
        expect(result.data[0].packet_loss).toBeUndefined();
        expect(result.data[0].connectivity_status).toBeUndefined();

        expect(result.data[1].download_speed).toBeUndefined();
        expect(result.data[1].upload_speed).toBeUndefined();
        expect(result.data[1].latency).toBeUndefined();
        expect(result.data[1].jitter).toBeUndefined();
        expect(result.data[1].server_location).toBeUndefined();
        expect(result.data[1].isp).toBeUndefined();
        expect(result.data[1].external_ip).toBeUndefined();
        expect(result.data[1].internal_ip).toBeUndefined();

        expect(result.data[0].timestamp).toBe("2024-01-01T12:00:00Z");
        expect(result.data[0].source).toBe("ping");
        expect(result.meta.count).toBe(2);

        return result;
      }).pipe(Effect.provide(QuestDBTest));
    });
  });
});
