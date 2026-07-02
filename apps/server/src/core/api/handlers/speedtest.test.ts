import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Ref } from "effect";
import {
  getSpeedTestHistoryHandler,
  triggerSpeedTestHandler,
} from "@/core/api/handlers/speedtest";
import {
  QuestDB,
  type QuestDBService,
} from "@/infrastructure/database/questdb";
import type { MetricRow } from "@/infrastructure/database/questdb/model";
import {
  createSpeedtestMetrics,
  seedDatabase,
} from "@/infrastructure/database/questdb/test-utils/seed";
import {
  createTestLayer,
  isQuestDBAvailable,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "@/infrastructure/database/questdb/test-utils/setup";
import {
  SpeedTestExecutionError,
  SpeedTestService,
  type SpeedTestServiceInterface,
  SpeedTestTimeoutError,
} from "@/infrastructure/speedtest/service";

const createTestSpeedTestService = (
  runTestEffect: Effect.Effect<
    {
      timestamp: Date;
      downloadSpeed: number;
      uploadSpeed: number;
      latency: number;
      jitter?: number;
      serverLocation?: string;
      isp?: string;
      externalIp?: string;
      internalIp?: string;
    },
    SpeedTestExecutionError | SpeedTestTimeoutError,
    never
  >
): SpeedTestServiceInterface => ({
  runTest: () => runTestEffect,
});

const createTestQuestDB = (): QuestDBService => ({
  writeMetric: () => Effect.succeed(undefined),
  flush: () => Effect.succeed(undefined),
  queryMetrics: () => Effect.succeed([]),
  querySpeedtests: () => Effect.succeed([]),
  queryConnectivityStatus: () => Effect.succeed([]),
  health: () =>
    Effect.succeed({ connected: true, version: "test", uptime: 1000 }),
  close: () => Effect.succeed(undefined),
});

describe("SpeedTest API Handlers", () => {
  describe("triggerSpeedTest handler", () => {
    it.effect("successfully runs speed test and returns result", () => {
      const mockResult = {
        timestamp: new Date("2024-01-01T12:00:00Z"),
        downloadSpeed: 100.5,
        uploadSpeed: 50.2,
        latency: 15.3,
        jitter: 2.5,
        serverLocation: "San Francisco, CA",
        isp: "Test ISP",
        externalIp: "1.2.3.4",
        internalIp: "192.168.1.100",
      };

      const SpeedTestServiceTest = Layer.succeed(
        SpeedTestService,
        createTestSpeedTestService(Effect.succeed(mockResult))
      );

      const QuestDBTest = Layer.succeed(QuestDB, createTestQuestDB());

      return Effect.gen(function* () {
        const isRunningRef = yield* Ref.make(false);
        const result = yield* triggerSpeedTestHandler(isRunningRef);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.result.downloadMbps).toBe(100.5);
          expect(result.result.uploadMbps).toBe(50.2);
          expect(result.result.pingMs).toBe(15.3);
          expect(result.result.jitter).toBe(2.5);
          expect(result.result.server).toBe("San Francisco, CA");
          expect(result.result.isp).toBe("Test ISP");
          expect(result.result.externalIp).toBe("1.2.3.4");
        }

        return result;
      }).pipe(Effect.provide(Layer.merge(SpeedTestServiceTest, QuestDBTest)));
    });

    it.effect("handles speed test timeout error", () => {
      const SpeedTestServiceTest = Layer.succeed(
        SpeedTestService,
        createTestSpeedTestService(
          Effect.fail(new SpeedTestTimeoutError(120000))
        )
      );

      const QuestDBTest = Layer.succeed(QuestDB, createTestQuestDB());

      return Effect.gen(function* () {
        const isRunningRef = yield* Ref.make(false);
        const result = yield* triggerSpeedTestHandler(isRunningRef);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe("SPEED_TEST_TIMEOUT");
          expect(result.error.message).toContain("timed out");
        }

        return result;
      }).pipe(Effect.provide(Layer.merge(SpeedTestServiceTest, QuestDBTest)));
    });

    it.effect("handles speed test execution error", () => {
      const SpeedTestServiceTest = Layer.succeed(
        SpeedTestService,
        createTestSpeedTestService(
          Effect.fail(new SpeedTestExecutionError("Network connection failed"))
        )
      );

      const QuestDBTest = Layer.succeed(QuestDB, createTestQuestDB());

      return Effect.gen(function* () {
        const isRunningRef = yield* Ref.make(false);
        const result = yield* triggerSpeedTestHandler(isRunningRef);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe("SPEED_TEST_EXECUTION_FAILED");
          expect(result.error.message).toBe("Network connection failed");
        }

        return result;
      }).pipe(Effect.provide(Layer.merge(SpeedTestServiceTest, QuestDBTest)));
    });

    it.effect("returns minimal result without optional fields", () => {
      const mockResult = {
        timestamp: new Date("2024-01-01T12:00:00Z"),
        downloadSpeed: 100.5,
        uploadSpeed: 50.2,
        latency: 15.3,
      };

      const SpeedTestServiceTest = Layer.succeed(
        SpeedTestService,
        createTestSpeedTestService(Effect.succeed(mockResult))
      );

      const QuestDBTest = Layer.succeed(QuestDB, createTestQuestDB());

      return Effect.gen(function* () {
        const isRunningRef = yield* Ref.make(false);
        const result = yield* triggerSpeedTestHandler(isRunningRef);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.result.downloadMbps).toBe(100.5);
          expect(result.result.uploadMbps).toBe(50.2);
          expect(result.result.pingMs).toBe(15.3);
          expect(result.result.jitter).toBeUndefined();
          expect(result.result.server).toBeUndefined();
          expect(result.result.isp).toBeUndefined();
          expect(result.result.externalIp).toBeUndefined();
        }

        return result;
      }).pipe(Effect.provide(Layer.merge(SpeedTestServiceTest, QuestDBTest)));
    });
  });

  describe("getSpeedTestHistory handler", () => {
    it.effect("returns speed test history with default parameters", () => {
      const mockData = [
        {
          timestamp: "2024-01-01T12:00:00Z",
          source: "speedtest" as const,
          download_speed: 100.5,
          upload_speed: 50.2,
          latency: 15.3,
          jitter: 2.5,
          server_location: "San Francisco, CA",
          isp: "Test ISP",
          external_ip: "1.2.3.4",
          internal_ip: "192.168.1.100",
        },
        {
          timestamp: "2024-01-01T11:00:00Z",
          source: "speedtest" as const,
          download_speed: 95.8,
          upload_speed: 48.3,
          latency: 16.2,
          jitter: 3.1,
          server_location: "San Francisco, CA",
          isp: "Test ISP",
          external_ip: "1.2.3.4",
          internal_ip: "192.168.1.100",
        },
      ];

      const QuestDBTest = Layer.succeed(QuestDB, {
        ...createTestQuestDB(),
        querySpeedtests: () => Effect.succeed(mockData),
      });

      return Effect.gen(function* () {
        const result = yield* getSpeedTestHistoryHandler({ urlParams: {} });

        expect(result.data).toHaveLength(2);
        expect(result.data[0].download_speed).toBe(100.5);
        expect(result.data[1].download_speed).toBe(95.8);
        expect(result.meta.count).toBe(2);

        return result;
      }).pipe(Effect.provide(QuestDBTest));
    });

    it.effect("returns empty array when no history available", () => {
      const QuestDBTest = Layer.succeed(QuestDB, {
        ...createTestQuestDB(),
        querySpeedtests: () => Effect.succeed([]),
      });

      return Effect.gen(function* () {
        const result = yield* getSpeedTestHistoryHandler({ urlParams: {} });

        expect(result.data).toEqual([]);
        expect(result.meta.count).toBe(0);

        return result;
      }).pipe(Effect.provide(QuestDBTest));
    });

    it.effect("handles query parameters correctly", () => {
      const mockData = [
        {
          timestamp: "2024-01-01T12:00:00Z",
          source: "speedtest" as const,
          download_speed: 100.5,
          upload_speed: 50.2,
          latency: 15.3,
        },
      ];

      const QuestDBTest = Layer.succeed(QuestDB, {
        ...createTestQuestDB(),
        querySpeedtests: ({ startTime, endTime, limit }) => {
          expect(startTime).toBeInstanceOf(Date);
          expect(endTime).toBeInstanceOf(Date);
          expect(limit).toBe(100);
          return Effect.succeed(mockData);
        },
      });

      return Effect.gen(function* () {
        const result = yield* getSpeedTestHistoryHandler({
          urlParams: {
            startTime: "2024-01-01T00:00:00Z",
            endTime: "2024-01-01T23:59:59Z",
            limit: 100,
          },
        });

        expect(result.data).toHaveLength(1);
        expect(result.meta.startTime).toBe("2024-01-01T00:00:00.000Z");
        expect(result.meta.endTime).toBe("2024-01-01T23:59:59.000Z");

        return result;
      }).pipe(Effect.provide(QuestDBTest));
    });

    it.effect("converts null values to undefined for optional fields", () => {
      // QuestDB returns null for missing values, while our TypeScript types use undefined.
      // This test verifies the handler correctly converts null -> undefined.
      type RawMetricRow = {
        [K in keyof MetricRow]: MetricRow[K] | null;
      };

      const mockDataWithNulls: RawMetricRow[] = [
        {
          timestamp: "2024-01-01T12:00:00Z",
          source: "speedtest",
          host: null,
          download_speed: 100.5,
          upload_speed: 50.2,
          latency: 15.3,
          jitter: null,
          packet_loss: null,
          connectivity_status: null,
          server_location: null,
          isp: null,
          external_ip: null,
          internal_ip: null,
        },
      ];

      const QuestDBTest = Layer.succeed(QuestDB, {
        ...createTestQuestDB(),
        // Cast to MetricRow[] since that's what the service interface expects,
        // but QuestDB actually returns nullable fields at runtime
        querySpeedtests: () => Effect.succeed(mockDataWithNulls as MetricRow[]),
      });

      return Effect.gen(function* () {
        // Call the actual handler logic
        const result = yield* getSpeedTestHistoryHandler({ urlParams: {} });

        // Verify the handler converted null to undefined
        expect(result.data).toHaveLength(1);
        expect(result.data[0].jitter).toBeUndefined();
        expect(result.data[0].server_location).toBeUndefined();
        expect(result.data[0].isp).toBeUndefined();
        expect(result.data[0].external_ip).toBeUndefined();
        expect(result.data[0].internal_ip).toBeUndefined();

        // Verify non-null values are preserved
        expect(result.data[0].timestamp).toBe("2024-01-01T12:00:00Z");
        expect(result.data[0].download_speed).toBe(100.5);
        expect(result.data[0].upload_speed).toBe(50.2);
        expect(result.data[0].latency).toBe(15.3);

        return result;
      }).pipe(Effect.provide(QuestDBTest));
    });
  });

  describe("getSpeedTestHistory integration tests", () => {
    const skipTests = !isQuestDBAvailable();
    const testLayer = createTestLayer();

    it.skipIf(skipTests)(
      "should write and query speedtest data from real QuestDB",
      async () => {
        const program = Effect.gen(function* () {
          const db = yield* setupIntegrationTest();

          // Create deterministic speedtest data (2 records over 30 minutes)
          const baseTime = new Date("2024-01-15T16:00:00Z");
          const testMetrics = createSpeedtestMetrics(baseTime, 30);

          // Seed database with test data
          yield* seedDatabase(db, testMetrics);

          // Query speedtest history with time range covering the seeded data
          const result = yield* getSpeedTestHistoryHandler({
            urlParams: {
              startTime: new Date("2024-01-15T15:00:00Z").toISOString(),
              endTime: new Date("2024-01-15T17:00:00Z").toISOString(),
              limit: 10,
            },
          });

          // Verify basic response structure
          expect(result.data).toBeDefined();
          expect(Array.isArray(result.data)).toBe(true);
          expect(result.data.length).toBeGreaterThan(0);

          // Verify meta matches data
          expect(result.meta).toBeDefined();
          expect(result.meta.count).toBe(result.data.length);

          // Verify speedtest data structure
          const record = result.data[0];
          expect(record).toHaveProperty("timestamp");
          expect(record).toHaveProperty("download_speed");
          expect(record).toHaveProperty("upload_speed");
          expect(record).toHaveProperty("latency");
          expect(record).toHaveProperty("server_location");
          expect(record).toHaveProperty("isp");

          // Verify field types
          expect(typeof record.download_speed).toBe("number");
          expect(typeof record.upload_speed).toBe("number");
          expect(typeof record.latency).toBe("number");
          expect(record.download_speed).toBeGreaterThan(0);
          expect(record.upload_speed).toBeGreaterThan(0);

          // Cleanup
          yield* teardownIntegrationTest(db);

          return result;
        });

        await Effect.runPromise(Effect.provide(program, testLayer));
      }
    );
  });
});
