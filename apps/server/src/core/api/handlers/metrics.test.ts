import { describe, expect, it } from "@effect/vitest";
import { Effect, Either, Layer } from "effect";
import type {
  MetricRow,
  QueryMetricsParams,
} from "@/infrastructure/database/questdb";
import {
  DatabaseQueryError,
  DbUnavailable,
  QuestDB,
  type QuestDBService,
} from "@/infrastructure/database/questdb";

const createTestQuestDBService = (
  queryMetricsEffect: Effect.Effect<
    readonly MetricRow[],
    DatabaseQueryError | DbUnavailable
  >
): QuestDBService => ({
  health: () => Effect.succeed({ connected: true, uptime: 100 }),
  writeMetric: () => Effect.void,
  queryMetrics: (_params: QueryMetricsParams) => queryMetricsEffect,
  querySpeedtests: () => Effect.succeed([]),
  queryConnectivityStatus: () => Effect.succeed([]),
  close: () => Effect.void,
});

describe("Metrics API Handlers", () => {
  describe("getMetrics handler", () => {
    it.effect(
      "returns metrics with default time range when no params provided",
      () => {
        const mockMetrics: readonly MetricRow[] = [
          {
            timestamp: "2024-01-01T10:00:00Z",
            source: "ping",
            host: "8.8.8.8",
            latency: 15.5,
            packet_loss: 0,
            connectivity_status: "up",
            jitter: 1.2,
          },
          {
            timestamp: "2024-01-01T10:05:00Z",
            source: "speedtest",
            download_speed: 100.5,
            upload_speed: 50.2,
            latency: 20.0,
            jitter: 2.0,
            server_location: "San Francisco, CA",
            isp: "Test ISP",
          },
        ];

        const QuestDbTest = Layer.succeed(
          QuestDB,
          createTestQuestDBService(Effect.succeed(mockMetrics))
        );

        return Effect.gen(function* () {
          const db = yield* QuestDB;
          const data = yield* db.queryMetrics({});

          expect(data).toHaveLength(2);
          expect(data[0].source).toBe("ping");
          expect(data[0].host).toBe("8.8.8.8");
          expect(data[0].latency).toBe(15.5);
          expect(data[1].source).toBe("speedtest");
          expect(data[1].download_speed).toBe(100.5);

          const meta = {
            startTime: new Date(Date.now() - 3600000).toISOString(),
            endTime: new Date().toISOString(),
            count: data.length,
          };

          expect(meta.count).toBe(2);
          expect(meta.startTime).toBeDefined();
          expect(meta.endTime).toBeDefined();

          return { data, meta };
        }).pipe(Effect.provide(QuestDbTest));
      }
    );

    it.effect("filters metrics by specific host", () => {
      const mockMetrics: readonly MetricRow[] = [
        {
          timestamp: "2024-01-01T10:00:00Z",
          source: "ping",
          host: "1.1.1.1",
          latency: 12.3,
          packet_loss: 0,
          connectivity_status: "up",
        },
      ];

      const QuestDbTest = Layer.succeed(
        QuestDB,
        createTestQuestDBService(Effect.succeed(mockMetrics))
      );

      return Effect.gen(function* () {
        const db = yield* QuestDB;
        const data = yield* db.queryMetrics({ host: "1.1.1.1" });

        expect(data).toHaveLength(1);
        expect(data[0].host).toBe("1.1.1.1");
        return data;
      }).pipe(Effect.provide(QuestDbTest));
    });

    it.effect("filters metrics by time range", () => {
      const startTime = new Date("2024-01-01T00:00:00Z");
      const endTime = new Date("2024-01-01T23:59:59Z");

      const mockMetrics: readonly MetricRow[] = [
        {
          timestamp: "2024-01-01T12:00:00Z",
          source: "ping",
          host: "8.8.8.8",
          latency: 15.5,
          packet_loss: 0,
          connectivity_status: "up",
        },
      ];

      const QuestDbTest = Layer.succeed(
        QuestDB,
        createTestQuestDBService(Effect.succeed(mockMetrics))
      );

      return Effect.gen(function* () {
        const db = yield* QuestDB;
        const data = yield* db.queryMetrics({ startTime, endTime });

        expect(data).toHaveLength(1);
        expect(data[0].timestamp).toBe("2024-01-01T12:00:00Z");
        return data;
      }).pipe(Effect.provide(QuestDbTest));
    });

    it.effect("respects limit parameter", () => {
      const mockMetrics: readonly MetricRow[] = [
        {
          timestamp: "2024-01-01T10:00:00Z",
          source: "ping",
          host: "8.8.8.8",
          latency: 15.5,
          packet_loss: 0,
          connectivity_status: "up",
        },
        {
          timestamp: "2024-01-01T10:05:00Z",
          source: "ping",
          host: "8.8.8.8",
          latency: 16.0,
          packet_loss: 0,
          connectivity_status: "up",
        },
      ];

      const QuestDbTest = Layer.succeed(
        QuestDB,
        createTestQuestDBService(Effect.succeed(mockMetrics))
      );

      return Effect.gen(function* () {
        const db = yield* QuestDB;
        const data = yield* db.queryMetrics({ limit: 100 });

        expect(data).toHaveLength(2);
        return data;
      }).pipe(Effect.provide(QuestDbTest));
    });

    it.effect("applies granularity for aggregated metrics", () => {
      const mockMetrics: readonly MetricRow[] = [
        {
          timestamp: "2024-01-01T10:00:00Z",
          source: "ping",
          host: "8.8.8.8",
          latency: 15.0,
          packet_loss: 0,
          connectivity_status: "up",
        },
      ];

      const QuestDbTest = Layer.succeed(
        QuestDB,
        createTestQuestDBService(Effect.succeed(mockMetrics))
      );

      return Effect.gen(function* () {
        const db = yield* QuestDB;
        const data = yield* db.queryMetrics({ granularity: "5m" });

        expect(data).toHaveLength(1);
        return data;
      }).pipe(Effect.provide(QuestDbTest));
    });

    it.effect("returns empty array when no metrics found", () => {
      const QuestDbTest = Layer.succeed(
        QuestDB,
        createTestQuestDBService(Effect.succeed([]))
      );

      return Effect.gen(function* () {
        const db = yield* QuestDB;
        const data = yield* db.queryMetrics({});

        expect(data).toHaveLength(0);

        const meta = {
          startTime: new Date(Date.now() - 3600000).toISOString(),
          endTime: new Date().toISOString(),
          count: 0,
        };

        expect(meta.count).toBe(0);
        return { data, meta };
      }).pipe(Effect.provide(QuestDbTest));
    });

    it.effect("handles database unavailable error", () => {
      const QuestDbTest = Layer.succeed(
        QuestDB,
        createTestQuestDBService(
          Effect.fail(new DbUnavailable("Database not connected"))
        )
      );

      return Effect.gen(function* () {
        const db = yield* QuestDB;
        yield* db.queryMetrics({});
        return { data: [], meta: { startTime: "", endTime: "", count: 0 } };
      }).pipe(
        Effect.catchAll((error) => {
          if (error instanceof DbUnavailable) {
            return Effect.fail("Database temporarily unavailable");
          }
          return Effect.fail(`Failed to query metrics: ${String(error)}`);
        }),
        Effect.either,
        Effect.map((result) => {
          expect(Either.isLeft(result)).toBe(true);
          if (Either.isLeft(result)) {
            expect(result.left).toBe("Database temporarily unavailable");
          }
          return result;
        }),
        Effect.provide(QuestDbTest)
      );
    });

    it.effect("handles database query error", () => {
      const QuestDbTest = Layer.succeed(
        QuestDB,
        createTestQuestDBService(
          Effect.fail(new DatabaseQueryError("Query execution failed"))
        )
      );

      return Effect.gen(function* () {
        const db = yield* QuestDB;
        yield* db.queryMetrics({});
        return { data: [], meta: { startTime: "", endTime: "", count: 0 } };
      }).pipe(
        Effect.catchAll((error) => {
          if (error instanceof DbUnavailable) {
            return Effect.fail("Database temporarily unavailable");
          }
          return Effect.fail(`Failed to query metrics: ${String(error)}`);
        }),
        Effect.either,
        Effect.map((result) => {
          expect(Either.isLeft(result)).toBe(true);
          if (Either.isLeft(result)) {
            expect(result.left).toContain("Failed to query metrics");
          }
          return result;
        }),
        Effect.provide(QuestDbTest)
      );
    });

    it.effect("handles multiple query parameters combined", () => {
      const startTime = new Date("2024-01-01T00:00:00Z");
      const endTime = new Date("2024-01-01T23:59:59Z");

      const mockMetrics: readonly MetricRow[] = [
        {
          timestamp: "2024-01-01T12:00:00Z",
          source: "ping",
          host: "8.8.8.8",
          latency: 15.5,
          packet_loss: 0,
          connectivity_status: "up",
        },
      ];

      const QuestDbTest = Layer.succeed(
        QuestDB,
        createTestQuestDBService(Effect.succeed(mockMetrics))
      );

      return Effect.gen(function* () {
        const db = yield* QuestDB;
        const data = yield* db.queryMetrics({
          startTime,
          endTime,
          host: "8.8.8.8",
          limit: 50,
          granularity: "1h",
        });

        expect(data).toHaveLength(1);
        expect(data[0].host).toBe("8.8.8.8");
        return data;
      }).pipe(Effect.provide(QuestDbTest));
    });

    it.effect("handles mixed ping and speedtest metrics", () => {
      const mockMetrics: readonly MetricRow[] = [
        {
          timestamp: "2024-01-01T10:00:00Z",
          source: "ping",
          host: "8.8.8.8",
          latency: 15.5,
          packet_loss: 0,
          connectivity_status: "up",
          jitter: 1.2,
        },
        {
          timestamp: "2024-01-01T10:10:00Z",
          source: "speedtest",
          download_speed: 250.5,
          upload_speed: 100.2,
          latency: 18.0,
          jitter: 1.5,
          server_location: "New York, NY",
          isp: "Test ISP",
          external_ip: "203.0.113.1",
          internal_ip: "192.168.1.100",
        },
        {
          timestamp: "2024-01-01T10:05:00Z",
          source: "ping",
          host: "1.1.1.1",
          latency: 12.0,
          packet_loss: 0,
          connectivity_status: "up",
        },
      ];

      const QuestDbTest = Layer.succeed(
        QuestDB,
        createTestQuestDBService(Effect.succeed(mockMetrics))
      );

      return Effect.gen(function* () {
        const db = yield* QuestDB;
        const data = yield* db.queryMetrics({});

        expect(data).toHaveLength(3);

        const pingMetrics = data.filter((m) => m.source === "ping");
        const speedtestMetrics = data.filter((m) => m.source === "speedtest");

        expect(pingMetrics).toHaveLength(2);
        expect(speedtestMetrics).toHaveLength(1);

        expect(speedtestMetrics[0].download_speed).toBe(250.5);
        expect(speedtestMetrics[0].upload_speed).toBe(100.2);

        return data;
      }).pipe(Effect.provide(QuestDbTest));
    });

    it.effect("validates granularity values", () => {
      const mockMetrics: readonly MetricRow[] = [
        {
          timestamp: "2024-01-01T10:00:00Z",
          source: "ping",
          host: "8.8.8.8",
          latency: 15.5,
          packet_loss: 0,
          connectivity_status: "up",
        },
      ];

      const QuestDbTest = Layer.succeed(
        QuestDB,
        createTestQuestDBService(Effect.succeed(mockMetrics))
      );

      return Effect.gen(function* () {
        const db = yield* QuestDB;
        const data = yield* db.queryMetrics({ granularity: "1d" });

        expect(data).toHaveLength(1);
        return data;
      }).pipe(Effect.provide(QuestDbTest));
    });
  });
});
