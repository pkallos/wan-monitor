import { describe, expect, it } from "@effect/vitest";
import type { NetworkMetric } from "@shared/metrics";
import { Deferred, Effect, Fiber, Layer, References } from "effect";
import { TestClock } from "effect/testing";
import {
  getSpeedTestHistoryHandler,
  getSpeedTestStatusHandler,
  triggerSpeedTestHandler,
} from "@/core/api/handlers/speedtest";
import { SpeedTestRunner } from "@/core/monitoring/speed-test-runner";
import {
  DatabaseWriteError,
  QuestDB,
  type QuestDBService,
} from "@/infrastructure/database/questdb";
import type { QuerySpeedtestsParams } from "@/infrastructure/database/questdb/model";
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
  makeSpeedTestService,
  SpeedTestExecutionError,
  type SpeedTestResult,
  SpeedTestService,
  type SpeedTestServiceInterface,
  SpeedTestTimeoutError,
} from "@/infrastructure/speedtest/service";
import { invalidTimeRangeOf } from "@/test/invalid-time-range";
import { emptyAnalyticsQueries } from "@/test/questdb-stubs";
import { executorYielding } from "@/test/speedtest-results";
import { speedTestRunnerFrom } from "@/test/speedtest-runner";

const createTestSpeedTestService = (
  runTestEffect: Effect.Effect<
    SpeedTestResult,
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
  queryLiveConnectivity: () => Effect.succeed(null),
  queryEarliestTimestamp: () => Effect.succeed(null),
  queryLatestPingTimestamp: () => Effect.succeed(null),
  ...emptyAnalyticsQueries,
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
        const runner = yield* SpeedTestRunner;
        const result = yield* triggerSpeedTestHandler(runner);

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
      }).pipe(
        Effect.provide(speedTestRunnerFrom(SpeedTestServiceTest, QuestDBTest))
      );
    });

    it.effect("handles speed test timeout error", () => {
      const SpeedTestServiceTest = Layer.succeed(
        SpeedTestService,
        createTestSpeedTestService(
          Effect.fail(new SpeedTestTimeoutError({ timeoutMs: 120000 }))
        )
      );

      const QuestDBTest = Layer.succeed(QuestDB, createTestQuestDB());

      return Effect.gen(function* () {
        const runner = yield* SpeedTestRunner;
        const result = yield* triggerSpeedTestHandler(runner);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe("SPEED_TEST_TIMEOUT");
          expect(result.error.message).toContain("timed out");
        }

        return result;
      }).pipe(
        Effect.provide(speedTestRunnerFrom(SpeedTestServiceTest, QuestDBTest))
      );
    });

    it.effect("handles speed test execution error", () => {
      const SpeedTestServiceTest = Layer.succeed(
        SpeedTestService,
        createTestSpeedTestService(
          Effect.fail(
            new SpeedTestExecutionError({
              message: "Network connection failed",
            })
          )
        )
      );

      const QuestDBTest = Layer.succeed(QuestDB, createTestQuestDB());

      return Effect.gen(function* () {
        const runner = yield* SpeedTestRunner;
        const result = yield* triggerSpeedTestHandler(runner);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe("SPEED_TEST_EXECUTION_FAILED");
          expect(result.error.message).toBe("Network connection failed");
        }

        return result;
      }).pipe(
        Effect.provide(speedTestRunnerFrom(SpeedTestServiceTest, QuestDBTest))
      );
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
        const runner = yield* SpeedTestRunner;
        const result = yield* triggerSpeedTestHandler(runner);

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
      }).pipe(
        Effect.provide(speedTestRunnerFrom(SpeedTestServiceTest, QuestDBTest))
      );
    });

    it.effect(
      "writes a row without bandwidth columns when the CLI result has none",
      () => {
        const written: NetworkMetric[] = [];
        const SpeedTestServiceTest = Layer.succeed(
          SpeedTestService,
          makeSpeedTestService(
            executorYielding({
              type: "result",
              timestamp: new Date("2024-01-01T12:00:00Z"),
              download: {},
              upload: {},
              isp: "Test ISP",
            }),
            5
          )
        );
        const QuestDBTest = Layer.succeed(QuestDB, {
          ...createTestQuestDB(),
          writeMetric: (metric: NetworkMetric) =>
            Effect.sync(() => {
              written.push(metric);
            }),
        });

        return Effect.gen(function* () {
          const runner = yield* SpeedTestRunner;
          const result = yield* triggerSpeedTestHandler(runner);

          expect(written).toHaveLength(1);
          expect(written[0].downloadBandwidth).toBeUndefined();
          expect(written[0].uploadBandwidth).toBeUndefined();
          expect(written[0].latency).toBeUndefined();
          expect(written[0].isp).toBe("Test ISP");
          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.result.downloadMbps).toBeUndefined();
            expect(result.result.uploadMbps).toBeUndefined();
            expect(result.result.pingMs).toBeUndefined();
          }
        }).pipe(
          Effect.provide(
            speedTestRunnerFrom(SpeedTestServiceTest, QuestDBTest)
          ),
          Effect.provide(Layer.succeed(References.MinimumLogLevel, "None"))
        );
      }
    );

    it.effect(
      "still returns success when the DB write for the result fails",
      () => {
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

        const QuestDBTest = Layer.succeed(QuestDB, {
          ...createTestQuestDB(),
          writeMetric: () =>
            Effect.fail(new DatabaseWriteError({ message: "disk full" })),
        });

        return Effect.gen(function* () {
          const runner = yield* SpeedTestRunner;
          const result = yield* triggerSpeedTestHandler(runner);

          expect(result.success).toBe(true);
        }).pipe(
          Effect.provide(speedTestRunnerFrom(SpeedTestServiceTest, QuestDBTest))
        );
      }
    );

    it.live(
      "concurrent triggerSpeedTest calls: exactly one runs, other returns ALREADY_RUNNING",
      () => {
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
          createTestSpeedTestService(
            Effect.sleep("200 millis").pipe(Effect.map(() => mockResult))
          )
        );

        const QuestDBTest = Layer.succeed(QuestDB, createTestQuestDB());

        return Effect.gen(function* () {
          const runner = yield* SpeedTestRunner;

          const fiber = yield* Effect.forkChild(
            triggerSpeedTestHandler(runner)
          );

          yield* Effect.sleep("20 millis");

          const secondResult = yield* triggerSpeedTestHandler(runner);
          expect(secondResult.success).toBe(false);
          if (!secondResult.success) {
            expect(secondResult.error.code).toBe("SPEED_TEST_ALREADY_RUNNING");
          }

          const firstResult = yield* Fiber.join(fiber);
          expect(firstResult.success).toBe(true);

          const isRunning = yield* runner.isRunning();
          expect(isRunning).toBe(false);
        }).pipe(
          Effect.provide(speedTestRunnerFrom(SpeedTestServiceTest, QuestDBTest))
        );
      }
    );

    it.live("interrupted run leaves isRunning === false", () => {
      const SpeedTestServiceTest = Layer.succeed(
        SpeedTestService,
        createTestSpeedTestService(
          Effect.sleep("10 seconds").pipe(
            Effect.map(() => ({
              timestamp: new Date("2024-01-01T12:00:00Z"),
              downloadSpeed: 100.5,
              uploadSpeed: 50.2,
              latency: 15.3,
            }))
          )
        )
      );

      const QuestDBTest = Layer.succeed(QuestDB, createTestQuestDB());

      return Effect.gen(function* () {
        const runner = yield* SpeedTestRunner;

        const fiber = yield* Effect.forkChild(triggerSpeedTestHandler(runner));

        yield* Effect.sleep("50 millis");

        const isRunningBefore = yield* runner.isRunning();
        expect(isRunningBefore).toBe(true);

        yield* Fiber.interrupt(fiber);

        const isRunningAfter = yield* runner.isRunning();
        expect(isRunningAfter).toBe(false);
      }).pipe(
        Effect.provide(speedTestRunnerFrom(SpeedTestServiceTest, QuestDBTest))
      );
    });
  });

  describe("getSpeedTestStatus handler", () => {
    const completed = {
      timestamp: new Date("2024-01-01T12:00:00Z"),
      downloadSpeed: 100.5,
      uploadSpeed: 50.2,
      latency: 15.3,
    };

    it.effect("reports isRunning false when idle", () =>
      Effect.gen(function* () {
        const runner = yield* SpeedTestRunner;
        const result = yield* getSpeedTestStatusHandler(runner);

        expect(result).toEqual({ isRunning: false });
      }).pipe(
        Effect.provide(
          speedTestRunnerFrom(
            Layer.succeed(
              SpeedTestService,
              createTestSpeedTestService(Effect.succeed(completed))
            ),
            Layer.succeed(QuestDB, createTestQuestDB())
          )
        )
      )
    );

    it.effect(
      "reports isRunning true and refuses a manual trigger while a scheduled run is in flight",
      () =>
        Effect.gen(function* () {
          const gate = yield* Deferred.make<void>();
          const started = yield* Deferred.make<void>();
          const slowService = createTestSpeedTestService(
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Deferred.await(gate)),
              Effect.as(completed)
            )
          );

          return yield* Effect.gen(function* () {
            const runner = yield* SpeedTestRunner;

            const scheduled = yield* Effect.forkChild(runner.run());
            yield* Deferred.await(started);

            expect(yield* getSpeedTestStatusHandler(runner)).toEqual({
              isRunning: true,
            });
            const manual = yield* triggerSpeedTestHandler(runner);
            expect(manual.success).toBe(false);
            if (!manual.success) {
              expect(manual.error.code).toBe("SPEED_TEST_ALREADY_RUNNING");
            }

            yield* Deferred.succeed(gate, undefined);
            yield* Fiber.join(scheduled);

            expect(yield* getSpeedTestStatusHandler(runner)).toEqual({
              isRunning: false,
            });
          }).pipe(
            Effect.provide(
              speedTestRunnerFrom(
                Layer.succeed(SpeedTestService, slowService),
                Layer.succeed(QuestDB, createTestQuestDB())
              )
            )
          );
        })
    );
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
        const result = yield* getSpeedTestHistoryHandler({ query: {} });

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
        const result = yield* getSpeedTestHistoryHandler({ query: {} });

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
          query: {
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

    it.effect("threads granularity from the query into the params", () => {
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
        querySpeedtests: ({ granularity }) => {
          expect(granularity).toBe("1h");
          return Effect.succeed(mockData);
        },
      });

      return Effect.gen(function* () {
        const result = yield* getSpeedTestHistoryHandler({
          query: {
            startTime: "2024-01-01T00:00:00Z",
            endTime: "2024-01-01T23:59:59Z",
            granularity: "1h",
          },
        });

        expect(result.data).toHaveLength(1);

        return result;
      }).pipe(Effect.provide(QuestDBTest));
    });

    it.effect("leaves granularity undefined when the query omits it", () => {
      const QuestDBTest = Layer.succeed(QuestDB, {
        ...createTestQuestDB(),
        querySpeedtests: ({ granularity }) => {
          expect(granularity).toBeUndefined();
          return Effect.succeed([]);
        },
      });

      return Effect.gen(function* () {
        const result = yield* getSpeedTestHistoryHandler({ query: {} });

        expect(result.data).toEqual([]);

        return result;
      }).pipe(Effect.provide(QuestDBTest));
    });

    it.effect(
      "passes a missing measurement through as undefined rather than 0",
      () => {
        // A 0 here would be indistinguishable from a measured 0 Mbps and would
        // drag any average computed downstream toward zero.
        const partialRow = {
          timestamp: "2024-01-01T12:00:00Z",
          source: "speedtest" as const,
          download_speed: undefined,
          upload_speed: undefined,
          latency: undefined,
        };

        const QuestDBTest = Layer.succeed(QuestDB, {
          ...createTestQuestDB(),
          querySpeedtests: () => Effect.succeed([partialRow]),
        });

        return Effect.gen(function* () {
          const result = yield* getSpeedTestHistoryHandler({ query: {} });

          expect(result.data[0].download_speed).toBeUndefined();
          expect(result.data[0].upload_speed).toBeUndefined();
          expect(result.data[0].latency).toBeUndefined();
        }).pipe(Effect.provide(QuestDBTest));
      }
    );

    it.effect("preserves a measured zero instead of dropping it", () => {
      const zeroRow = {
        timestamp: "2024-01-01T12:00:00Z",
        source: "speedtest" as const,
        download_speed: 0,
        upload_speed: 0,
        latency: 0,
      };

      const QuestDBTest = Layer.succeed(QuestDB, {
        ...createTestQuestDB(),
        querySpeedtests: () => Effect.succeed([zeroRow]),
      });

      return Effect.gen(function* () {
        const result = yield* getSpeedTestHistoryHandler({ query: {} });

        expect(result.data[0].download_speed).toBe(0);
        expect(result.data[0].upload_speed).toBe(0);
        expect(result.data[0].latency).toBe(0);
      }).pipe(Effect.provide(QuestDBTest));
    });
  });

  describe("getSpeedTestHistory time window", () => {
    const seenParamsLayer = (seen: QuerySpeedtestsParams[]) =>
      Layer.succeed(QuestDB, {
        ...createTestQuestDB(),
        querySpeedtests: (params: QuerySpeedtestsParams) => {
          seen.push(params);
          return Effect.succeed([]);
        },
      });

    it.effect("rejects a reversed range before querying", () => {
      const seen: QuerySpeedtestsParams[] = [];

      return Effect.gen(function* () {
        const error = yield* invalidTimeRangeOf(
          getSpeedTestHistoryHandler({
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
        const seen: QuerySpeedtestsParams[] = [];
        const fixedNow = new Date("2025-01-15T12:00:00Z").getTime();

        return Effect.gen(function* () {
          yield* TestClock.setTime(fixedNow);

          const result = yield* getSpeedTestHistoryHandler({ query: {} });

          expect(seen[0].startTime).toEqual(new Date(fixedNow - 3600000));
          expect(seen[0].endTime).toEqual(new Date(fixedNow));
          expect(result.meta.startTime).toBe(seen[0].startTime?.toISOString());
          expect(result.meta.endTime).toBe(seen[0].endTime?.toISOString());
        }).pipe(Effect.provide(seenParamsLayer(seen)));
      }
    );
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
            query: {
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

    it.skipIf(skipTests)(
      "should return results most-recent-first with meta matching the requested window",
      async () => {
        const program = Effect.gen(function* () {
          const db = yield* setupIntegrationTest();

          // Seed 4 speedtest rows (every 15 minutes over 60 minutes) with
          // distinct, known timestamps: 16:00, 16:15, 16:30, 16:45.
          const baseTime = new Date("2024-01-15T16:00:00Z");
          const testMetrics = createSpeedtestMetrics(baseTime, 60);
          expect(testMetrics).toHaveLength(4);

          yield* seedDatabase(db, testMetrics);

          const startTime = new Date("2024-01-15T15:00:00Z").toISOString();
          const endTime = new Date("2024-01-15T17:00:00Z").toISOString();

          const result = yield* getSpeedTestHistoryHandler({
            query: {
              startTime,
              endTime,
              limit: 10,
            },
          });

          // All 4 seeded rows fall within the window and under the limit.
          expect(result.data).toHaveLength(testMetrics.length);

          // Results come back most-recent-first: timestamps strictly descending.
          for (let i = 0; i < result.data.length - 1; i++) {
            const current = new Date(result.data[i].timestamp).getTime();
            const next = new Date(result.data[i + 1].timestamp).getTime();
            expect(current).toBeGreaterThan(next);
          }

          // meta.count reflects the returned rows and window matches the request.
          expect(result.meta.count).toBe(result.data.length);
          expect(result.meta.startTime).toBe(startTime);
          expect(result.meta.endTime).toBe(endTime);

          yield* teardownIntegrationTest(db);

          return result;
        });

        await Effect.runPromise(Effect.provide(program, testLayer));
      }
    );

    it.skipIf(skipTests)(
      "should cap result.data.length to a limit smaller than the seeded row count",
      async () => {
        const program = Effect.gen(function* () {
          const db = yield* setupIntegrationTest();

          // Seed 4 rows, then request fewer than were seeded.
          const baseTime = new Date("2024-01-15T16:00:00Z");
          const testMetrics = createSpeedtestMetrics(baseTime, 60);
          expect(testMetrics).toHaveLength(4);

          yield* seedDatabase(db, testMetrics);

          const limit = 2;
          expect(limit).toBeLessThan(testMetrics.length);

          const result = yield* getSpeedTestHistoryHandler({
            query: {
              startTime: new Date("2024-01-15T15:00:00Z").toISOString(),
              endTime: new Date("2024-01-15T17:00:00Z").toISOString(),
              limit,
            },
          });

          // The limit caps the number of returned rows.
          expect(result.data).toHaveLength(limit);
          expect(result.meta.count).toBe(result.data.length);

          // The capped rows are still the most recent, in descending order.
          for (let i = 0; i < result.data.length - 1; i++) {
            const current = new Date(result.data[i].timestamp).getTime();
            const next = new Date(result.data[i + 1].timestamp).getTime();
            expect(current).toBeGreaterThan(next);
          }

          yield* teardownIntegrationTest(db);

          return result;
        });

        await Effect.runPromise(Effect.provide(program, testLayer));
      }
    );
  });
});
