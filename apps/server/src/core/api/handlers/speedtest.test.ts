import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
  QuestDB,
  type QuestDBService,
} from "@/infrastructure/database/questdb";
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
        const speedTestService = yield* SpeedTestService;
        const result = yield* speedTestService.runTest();

        expect(result.downloadSpeed).toBe(100.5);
        expect(result.uploadSpeed).toBe(50.2);
        expect(result.latency).toBe(15.3);
        expect(result.jitter).toBe(2.5);
        expect(result.serverLocation).toBe("San Francisco, CA");
        expect(result.isp).toBe("Test ISP");
        expect(result.externalIp).toBe("1.2.3.4");

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
        const speedTestService = yield* SpeedTestService;
        const result = yield* Effect.either(speedTestService.runTest());

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(SpeedTestTimeoutError);
          if (result.left._tag === "SpeedTestTimeoutError") {
            expect(result.left.timeoutMs).toBe(120000);
          }
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
        const speedTestService = yield* SpeedTestService;
        const result = yield* Effect.either(speedTestService.runTest());

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(SpeedTestExecutionError);
          if (result.left._tag === "SpeedTestExecutionError") {
            expect(result.left.message).toBe("Network connection failed");
          }
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
        const speedTestService = yield* SpeedTestService;
        const result = yield* speedTestService.runTest();

        expect(result.downloadSpeed).toBe(100.5);
        expect(result.uploadSpeed).toBe(50.2);
        expect(result.latency).toBe(15.3);
        expect(result.jitter).toBeUndefined();
        expect(result.serverLocation).toBeUndefined();
        expect(result.isp).toBeUndefined();
        expect(result.externalIp).toBeUndefined();

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
        const db = yield* QuestDB;
        const results = yield* db.querySpeedtests({});

        expect(results).toHaveLength(2);
        expect(results[0].download_speed).toBe(100.5);
        expect(results[1].download_speed).toBe(95.8);

        return results;
      }).pipe(Effect.provide(QuestDBTest));
    });

    it.effect("returns empty array when no history available", () => {
      const QuestDBTest = Layer.succeed(QuestDB, {
        ...createTestQuestDB(),
        querySpeedtests: () => Effect.succeed([]),
      });

      return Effect.gen(function* () {
        const db = yield* QuestDB;
        const results = yield* db.querySpeedtests({});

        expect(results).toEqual([]);

        return results;
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
        const db = yield* QuestDB;
        const results = yield* db.querySpeedtests({
          startTime: new Date("2024-01-01T00:00:00Z"),
          endTime: new Date("2024-01-01T23:59:59Z"),
          limit: 100,
        });

        expect(results).toHaveLength(1);

        return results;
      }).pipe(Effect.provide(QuestDBTest));
    });
  });
});
