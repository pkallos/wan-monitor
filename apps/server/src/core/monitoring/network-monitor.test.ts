import { describe, expect, it } from "@effect/vitest";
import type { NetworkMetric } from "@shared/metrics";
import {
  Clock,
  Deferred,
  type Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  References,
  Scope,
} from "effect";
import { TestClock } from "effect/testing";
import { vi } from "vitest";
import {
  type MonitorStats,
  NetworkMonitor,
  NetworkMonitorLive,
} from "@/core/monitoring/network-monitor";
import {
  type PingExecutionResult,
  PingExecutor,
  PingExecutorLive,
} from "@/core/monitoring/ping-executor";
import { SpeedTestRunner } from "@/core/monitoring/speed-test-runner";
import type { ConfigService } from "@/infrastructure/config/config";
import { DatabaseWriteError, QuestDB } from "@/infrastructure/database/questdb";
import { PingService } from "@/infrastructure/ping/service";
import {
  SpeedTestExecutionError,
  SpeedTestTimeoutError,
} from "@/infrastructure/speedtest/errors";
// Import from speedtest-service to avoid native module loading
import { SpeedTestService } from "@/infrastructure/speedtest/types";
import { makeTestConfigLayer } from "@/test/config";
import { captureLogs } from "@/test/logs";
import { emptyAnalyticsQueries } from "@/test/questdb-stubs";
import { speedTestRunnerFrom } from "@/test/speedtest-runner";

// TestClock starts at epoch 0, which the monitor's stats treat as "unset".
const BOOT_TIME = Date.parse("2026-01-01T00:00:00Z");

describe("NetworkMonitor", () => {
  const mockPingResults: readonly PingExecutionResult[] = [
    {
      host: "8.8.8.8",
      success: true,
      result: {
        host: "8.8.8.8",
        alive: true,
        latency: 15.5,
        packetLoss: 0,
        stddev: 2.1,
      },
    },
    {
      host: "1.1.1.1",
      success: true,
      result: {
        host: "1.1.1.1",
        alive: true,
        latency: 12.3,
        packetLoss: 0,
        stddev: 1.8,
      },
    },
  ];

  const MockPingExecutor = Layer.succeed(PingExecutor, {
    executePing: vi.fn(),
    executeAll: () => Effect.succeed(mockPingResults),
    executeHosts: vi.fn(),
  });

  const MockQuestDB = Layer.succeed(QuestDB, {
    writeMetric: vi.fn(() => Effect.void),
    flush: vi.fn(() => Effect.void),
    queryMetrics: vi.fn(),
    querySpeedtests: vi.fn(),
    queryConnectivityStatus: vi.fn(),
    queryLiveConnectivity: vi.fn(),
    queryEarliestTimestamp: vi.fn(),
    queryLatestPingTimestamp: vi.fn(),
    ...emptyAnalyticsQueries,
    health: vi.fn(),
    close: vi.fn(),
  });

  const MockSpeedTestService = Layer.succeed(SpeedTestService, {
    runTest: vi.fn(() =>
      Effect.fail(new SpeedTestExecutionError({ message: "Mock error" }))
    ),
  });

  const MockConfig = makeTestConfigLayer({
    ping: { hosts: ["8.8.8.8", "1.1.1.1"], timeout: 5000, intervalSeconds: 30 },
    speedtest: { intervalSeconds: 3600, timeoutSeconds: 120 },
    auth: { password: "testpassword" },
  });

  const TestLayer = NetworkMonitorLive.pipe(
    Layer.provide(MockPingExecutor),
    Layer.provide(speedTestRunnerFrom(MockSpeedTestService, MockQuestDB)),
    Layer.provide(MockConfig),
    Layer.provide(Layer.succeed(References.MinimumLogLevel, "None"))
  );

  it.effect("should get initial stats", () =>
    Effect.gen(function* () {
      const monitor = yield* NetworkMonitor;
      const stats: MonitorStats = yield* monitor.getStats();

      expect(stats.uptime).toBe(0);
      expect(stats.lastPingTime).toBeNull();
      expect(stats.successfulPings).toBe(0);
      expect(stats.failedPings).toBe(0);
      expect(stats.failedWrites).toBe(0);
      expect(stats.lastSpeedTestTime).toBeNull();
      expect(stats.successfulSpeedTests).toBe(0);
      expect(stats.failedSpeedTests).toBe(0);
    }).pipe(Effect.provide(TestLayer))
  );

  it.effect("runs one ping cycle at boot and records its stats", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(BOOT_TIME);
      const monitor = yield* NetworkMonitor;

      yield* monitor.start();
      yield* TestClock.adjust("5 seconds");

      const stats: MonitorStats = yield* monitor.getStats();
      expect(stats.uptime).toBe(5000);
      expect(stats.lastPingTime).toEqual(new Date(BOOT_TIME));
      expect(stats.successfulPings).toBe(mockPingResults.length);
      expect(stats.failedPings).toBe(0);
    }).pipe(Effect.provide(TestLayer))
  );

  it.effect("should handle ping executor returning empty results", () => {
    const EmptyResultsPingExecutor = Layer.succeed(PingExecutor, {
      executePing: vi.fn(),
      executeAll: () => Effect.succeed([]),
      executeHosts: vi.fn(),
    });

    const EmptyResultsTestLayer = NetworkMonitorLive.pipe(
      Layer.provide(EmptyResultsPingExecutor),
      Layer.provide(speedTestRunnerFrom(MockSpeedTestService, MockQuestDB)),
      Layer.provide(MockConfig),
      Layer.provide(Layer.succeed(References.MinimumLogLevel, "None"))
    );

    return Effect.gen(function* () {
      yield* TestClock.setTime(BOOT_TIME);
      const monitor = yield* NetworkMonitor;

      yield* monitor.start();

      const stats: MonitorStats = yield* monitor.getStats();
      expect(stats.successfulPings).toBe(0);
      expect(stats.failedPings).toBe(0);
      expect(stats.lastPingTime).toEqual(new Date(BOOT_TIME));
    }).pipe(Effect.provide(EmptyResultsTestLayer));
  });

  it.live("should track speed test configuration from config", () => {
    const SpeedTestConfig = makeTestConfigLayer({
      ping: {
        hosts: ["8.8.8.8", "1.1.1.1"],
        timeout: 5000,
        intervalSeconds: 30,
      },
      speedtest: { intervalSeconds: 10, timeoutSeconds: 120 },
      auth: { password: "testpassword" },
    });

    const SpeedTestTestLayer = NetworkMonitorLive.pipe(
      Layer.provide(MockPingExecutor),
      Layer.provide(speedTestRunnerFrom(MockSpeedTestService, MockQuestDB)),
      Layer.provide(SpeedTestConfig),
      Layer.provide(Layer.succeed(References.MinimumLogLevel, "None"))
    );

    return Effect.gen(function* () {
      const monitor = yield* NetworkMonitor;
      const fiber = yield* Effect.forkChild(monitor.start());

      yield* Effect.sleep("50 millis");

      const stats: MonitorStats = yield* monitor.getStats();
      expect(stats.lastSpeedTestTime).toBeNull();

      yield* Fiber.interrupt(fiber);
    }).pipe(Effect.provide(SpeedTestTestLayer));
  });

  it.effect("should handle partial ping failures in results", () => {
    const MixedResultsPingExecutor = Layer.succeed(PingExecutor, {
      executePing: vi.fn(),
      executeAll: () =>
        Effect.succeed([
          {
            host: "8.8.8.8",
            success: true,
            result: {
              host: "8.8.8.8",
              alive: true,
              latency: 15.5,
              packetLoss: 0,
              stddev: 2.1,
            },
          },
          {
            host: "1.1.1.1",
            success: false,
            error: "PingHostUnreachableError",
          },
        ]),
      executeHosts: vi.fn(),
    });

    const MixedResultsTestLayer = NetworkMonitorLive.pipe(
      Layer.provide(MixedResultsPingExecutor),
      Layer.provide(speedTestRunnerFrom(MockSpeedTestService, MockQuestDB)),
      Layer.provide(MockConfig),
      Layer.provide(Layer.succeed(References.MinimumLogLevel, "None"))
    );

    return Effect.gen(function* () {
      yield* TestClock.setTime(BOOT_TIME);
      const monitor = yield* NetworkMonitor;

      yield* monitor.start();

      const stats: MonitorStats = yield* monitor.getStats();
      expect(stats.successfulPings).toBe(1);
      expect(stats.failedPings).toBe(1);
    }).pipe(Effect.provide(MixedResultsTestLayer));
  });

  it.live(
    "should keep running the speed test loop after a failed cycle",
    () => {
      // Reproduces the bug where a single failed speed test kills the recurring
      // schedule permanently. The first cycle fails (transient error), later
      // cycles succeed. A healthy loop must recover and keep testing.
      let callCount = 0;
      const FlakySpeedTestService = Layer.succeed(SpeedTestService, {
        runTest: () =>
          Effect.suspend(() => {
            callCount += 1;
            if (callCount === 1) {
              return Effect.fail(
                new SpeedTestExecutionError({
                  message: "Transient speed test failure",
                })
              );
            }
            return Effect.succeed({
              timestamp: new Date(),
              downloadSpeed: 100,
              uploadSpeed: 20,
              latency: 15,
              jitter: 2,
            });
          }),
      });

      const FlakyTestLayer = NetworkMonitorLive.pipe(
        Layer.provide(MockPingExecutor),
        Layer.provide(speedTestRunnerFrom(FlakySpeedTestService, MockQuestDB)),
        Layer.provide(
          makeTestConfigLayer({
            ping: {
              hosts: ["8.8.8.8", "1.1.1.1"],
              timeout: 5000,
              intervalSeconds: 30,
            },
            speedtest: { intervalSeconds: 1, timeoutSeconds: 120 },
            auth: { password: "testpassword" },
          })
        ),
        Layer.provide(Layer.succeed(References.MinimumLogLevel, "None"))
      );

      return Effect.gen(function* () {
        const monitor = yield* NetworkMonitor;

        const fiber = yield* Effect.forkChild(
          Effect.gen(function* () {
            yield* monitor.start();
            return yield* Effect.never;
          })
        );

        yield* Effect.sleep("2500 millis");

        const stats: MonitorStats = yield* monitor.getStats();

        yield* Fiber.interrupt(fiber);

        // With the bug, the repeat loop terminates after the first failed cycle:
        // runTest is invoked exactly once and never recovers.
        expect(callCount).toBeGreaterThan(1);
        expect(stats.successfulSpeedTests).toBeGreaterThanOrEqual(1);
      }).pipe(Effect.provide(FlakyTestLayer));
    }
  );

  it.live("should count a speed test as failed when the DB write fails", () => {
    // The speed test itself succeeds, but persisting the result to the
    // database fails. The monitor must record this as a failed speed test
    // (not a successful one) and keep the loop alive.
    const SucceedingSpeedTestService = Layer.succeed(SpeedTestService, {
      runTest: () =>
        Effect.succeed({
          timestamp: new Date(),
          downloadSpeed: 100,
          uploadSpeed: 20,
          latency: 15,
          jitter: 2,
        }),
    });

    // Ping writes succeed; only speed-test metric writes fail, isolating the
    // failure to the speed-test accounting path.
    const FailingSpeedTestWriteQuestDB = Layer.succeed(QuestDB, {
      writeMetric: vi.fn((metric: NetworkMetric) =>
        metric.source === "speedtest"
          ? Effect.fail(
              new DatabaseWriteError({ message: "speed test write failed" })
            )
          : Effect.void
      ),
      flush: vi.fn(() => Effect.void),
      queryMetrics: vi.fn(),
      querySpeedtests: vi.fn(),
      queryConnectivityStatus: vi.fn(),
      queryLiveConnectivity: vi.fn(),
      queryEarliestTimestamp: vi.fn(),
      queryLatestPingTimestamp: vi.fn(),
      ...emptyAnalyticsQueries,
      health: vi.fn(),
      close: vi.fn(),
    });

    const FailingWriteTestLayer = NetworkMonitorLive.pipe(
      Layer.provide(MockPingExecutor),
      Layer.provide(
        speedTestRunnerFrom(
          SucceedingSpeedTestService,
          FailingSpeedTestWriteQuestDB
        )
      ),
      Layer.provide(
        makeTestConfigLayer({
          ping: {
            hosts: ["8.8.8.8", "1.1.1.1"],
            timeout: 5000,
            intervalSeconds: 30,
          },
          speedtest: { intervalSeconds: 1, timeoutSeconds: 120 },
          auth: { password: "testpassword" },
        })
      ),
      Layer.provide(Layer.succeed(References.MinimumLogLevel, "None"))
    );

    return Effect.gen(function* () {
      const monitor = yield* NetworkMonitor;

      const fiber = yield* Effect.forkChild(
        Effect.gen(function* () {
          yield* monitor.start();
          return yield* Effect.never;
        })
      );

      yield* Effect.sleep("2500 millis");

      const stats: MonitorStats = yield* monitor.getStats();

      yield* Fiber.interrupt(fiber);

      expect(stats.successfulSpeedTests).toBe(0);
      expect(stats.failedSpeedTests).toBeGreaterThanOrEqual(1);
      expect(stats.lastSpeedTestTime).toBeInstanceOf(Date);
    }).pipe(Effect.provide(FailingWriteTestLayer));
  });

  it.live("should count a failed speed test when the test times out", () => {
    // A speed-test timeout is a distinct error variant from an execution
    // error; the monitor must log it and count it as a failed speed test
    // without killing the recurring loop.
    const TimingOutSpeedTestService = Layer.succeed(SpeedTestService, {
      runTest: () =>
        Effect.fail(new SpeedTestTimeoutError({ timeoutMs: 30_000 })),
    });

    const TimeoutTestLayer = NetworkMonitorLive.pipe(
      Layer.provide(MockPingExecutor),
      Layer.provide(
        speedTestRunnerFrom(TimingOutSpeedTestService, MockQuestDB)
      ),
      Layer.provide(
        makeTestConfigLayer({
          ping: {
            hosts: ["8.8.8.8", "1.1.1.1"],
            timeout: 5000,
            intervalSeconds: 30,
          },
          speedtest: { intervalSeconds: 1, timeoutSeconds: 120 },
          auth: { password: "testpassword" },
        })
      ),
      Layer.provide(Layer.succeed(References.MinimumLogLevel, "None"))
    );

    return Effect.gen(function* () {
      const monitor = yield* NetworkMonitor;

      const fiber = yield* Effect.forkChild(
        Effect.gen(function* () {
          yield* monitor.start();
          return yield* Effect.never;
        })
      );

      yield* Effect.sleep("2500 millis");

      const stats: MonitorStats = yield* monitor.getStats();

      yield* Fiber.interrupt(fiber);

      expect(stats.successfulSpeedTests).toBe(0);
      expect(stats.failedSpeedTests).toBeGreaterThanOrEqual(1);
    }).pipe(Effect.provide(TimeoutTestLayer));
  });

  it.live("logs the timeout duration when a speed test times out", () => {
    const logs = captureLogs();
    const TimingOutSpeedTestService = Layer.succeed(SpeedTestService, {
      runTest: () =>
        Effect.fail(new SpeedTestTimeoutError({ timeoutMs: 30_000 })),
    });

    const LoggingLayer = NetworkMonitorLive.pipe(
      Layer.provide(MockPingExecutor),
      Layer.provide(
        speedTestRunnerFrom(TimingOutSpeedTestService, MockQuestDB)
      ),
      Layer.provide(
        makeTestConfigLayer({
          speedtest: { intervalSeconds: 1, timeoutSeconds: 120 },
          auth: { password: "testpassword" },
        })
      )
    );

    return Effect.gen(function* () {
      const monitor = yield* NetworkMonitor;

      const fiber = yield* Effect.forkChild(
        Effect.gen(function* () {
          yield* monitor.start();
          return yield* Effect.never;
        })
      );

      yield* Effect.sleep("1500 millis");
      yield* Fiber.interrupt(fiber);

      const failures = logs.entries.filter(
        (entry) =>
          entry.level === "Error" && entry.text.includes("Speed test failed")
      );
      expect(failures.length).toBeGreaterThanOrEqual(1);
      expect(failures[0]?.text).toContain("SpeedTestTimeoutError");
      expect(failures[0]?.text).toContain("30000ms");
    }).pipe(Effect.provide(LoggingLayer), Effect.provide(logs.layer));
  });

  it.live("holds the shared runner during a scheduled speed test", () => {
    const gate = Effect.runSync(Deferred.make<void>());
    const started = Effect.runSync(Deferred.make<void>());
    const GatedSpeedTestService = Layer.succeed(SpeedTestService, {
      runTest: () =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(gate)),
          Effect.as({ timestamp: new Date(), downloadSpeed: 100 })
        ),
    });
    const RunnerLayer = speedTestRunnerFrom(GatedSpeedTestService, MockQuestDB);
    const SharedRunnerLayer = Layer.merge(
      NetworkMonitorLive.pipe(
        Layer.provide(MockPingExecutor),
        Layer.provide(RunnerLayer),
        Layer.provide(MockConfig)
      ),
      RunnerLayer
    ).pipe(Layer.provide(Layer.succeed(References.MinimumLogLevel, "None")));

    return Effect.gen(function* () {
      const monitor = yield* NetworkMonitor;
      const runner = yield* SpeedTestRunner;

      const fiber = yield* Effect.forkChild(
        Effect.gen(function* () {
          yield* monitor.start();
          return yield* Effect.never;
        })
      );
      yield* Deferred.await(started);

      expect(yield* runner.isRunning()).toBe(true);
      expect(Option.isNone(yield* runner.runIfIdle())).toBe(true);

      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.interrupt(fiber);
    }).pipe(Effect.provide(SharedRunnerLayer));
  });

  it.live(
    "stamps a speed test cycle when its run finishes, not when it queued",
    () => {
      const gate = Effect.runSync(Deferred.make<void>());
      const started = Effect.runSync(Deferred.make<void>());
      const finished = { timestamp: new Date(), downloadSpeed: 100 };
      let calls = 0;
      const QueuedSpeedTestService = Layer.succeed(SpeedTestService, {
        runTest: () =>
          Effect.suspend(() => {
            calls += 1;
            return calls === 1
              ? Deferred.succeed(started, undefined).pipe(
                  Effect.andThen(Deferred.await(gate)),
                  Effect.as(finished)
                )
              : Effect.succeed(finished);
          }),
      });
      const RunnerLayer = speedTestRunnerFrom(
        QueuedSpeedTestService,
        MockQuestDB
      );
      const QueuedLayer = Layer.merge(
        NetworkMonitorLive.pipe(
          Layer.provide(MockPingExecutor),
          Layer.provide(RunnerLayer),
          Layer.provide(MockConfig)
        ),
        RunnerLayer
      ).pipe(Layer.provide(Layer.succeed(References.MinimumLogLevel, "None")));

      return Effect.gen(function* () {
        const monitor = yield* NetworkMonitor;
        const runner = yield* SpeedTestRunner;

        const manual = yield* Effect.forkChild(runner.runIfIdle());
        yield* Deferred.await(started);
        const fiber = yield* Effect.forkChild(
          Effect.gen(function* () {
            yield* monitor.start();
            return yield* Effect.never;
          })
        );
        yield* Effect.sleep("100 millis");

        const releasedAt = yield* Clock.currentTimeMillis;
        yield* Deferred.succeed(gate, undefined);
        yield* Fiber.join(manual);
        yield* Effect.sleep("100 millis");
        const stats: MonitorStats = yield* monitor.getStats();
        yield* Fiber.interrupt(fiber);

        expect(stats.successfulSpeedTests).toBe(1);
        expect(stats.lastSpeedTestTime?.getTime()).toBeGreaterThanOrEqual(
          releasedAt
        );
      }).pipe(Effect.provide(QueuedLayer));
    }
  );

  it.live(
    "should maintain consistent counters after concurrent ping and speedtest cycles",
    () => {
      // PHI-150: Verify that Ref-based stats remain consistent when ping and
      // speedtest cycles run concurrently. Each cycle increments counters
      // atomically via Ref.update, so the final snapshot should reflect the
      // exact number of operations completed.
      const pingCallCount = { value: 0 };
      const speedTestCallCount = { value: 0 };

      const ConcurrentPingExecutor = Layer.succeed(PingExecutor, {
        executePing: vi.fn(),
        executeAll: () =>
          Effect.sync(() => {
            pingCallCount.value += 1;
            return mockPingResults;
          }),
        executeHosts: vi.fn(),
      });

      const ConcurrentSpeedTestService = Layer.succeed(SpeedTestService, {
        runTest: () =>
          Effect.sync(() => {
            speedTestCallCount.value += 1;
            return {
              timestamp: new Date(),
              downloadSpeed: 100,
              uploadSpeed: 20,
              latency: 15,
              jitter: 2,
            };
          }),
      });

      const ConcurrentConfig = makeTestConfigLayer({
        ping: {
          hosts: ["8.8.8.8", "1.1.1.1"],
          timeout: 5000,
          intervalSeconds: 1,
        },
        speedtest: { intervalSeconds: 1, timeoutSeconds: 120 },
        auth: { password: "testpassword" },
      });

      const ConcurrentTestLayer = NetworkMonitorLive.pipe(
        Layer.provide(ConcurrentPingExecutor),
        Layer.provide(
          speedTestRunnerFrom(ConcurrentSpeedTestService, MockQuestDB)
        ),
        Layer.provide(ConcurrentConfig),
        Layer.provide(Layer.succeed(References.MinimumLogLevel, "None"))
      );

      return Effect.gen(function* () {
        const monitor = yield* NetworkMonitor;

        const fiber = yield* Effect.forkChild(
          Effect.gen(function* () {
            yield* monitor.start();
            return yield* Effect.never;
          })
        );

        // Let both loops run concurrently for a short window
        yield* Effect.sleep("2500 millis");

        const stats: MonitorStats = yield* monitor.getStats();

        yield* Fiber.interrupt(fiber);

        // Counters must be internally consistent: successful + failed pings
        // should equal the total ping calls times the number of hosts per call.
        const totalPingResults = pingCallCount.value * mockPingResults.length;
        expect(stats.successfulPings + stats.failedPings).toBe(
          totalPingResults
        );

        // Speed test counters: successful + failed should equal total calls
        expect(stats.successfulSpeedTests + stats.failedSpeedTests).toBe(
          speedTestCallCount.value
        );

        // All pings in mockPingResults are successful
        expect(stats.successfulPings).toBe(totalPingResults);
        expect(stats.failedPings).toBe(0);

        // All speed tests succeeded and DB writes succeeded (mock)
        expect(stats.successfulSpeedTests).toBe(speedTestCallCount.value);
        expect(stats.failedSpeedTests).toBe(0);
      }).pipe(Effect.provide(ConcurrentTestLayer));
    }
  );
});

describe("NetworkMonitor ping write failures", () => {
  const hosts = ["8.8.8.8", "1.1.1.1"];

  const failingSpeedTest = Layer.succeed(SpeedTestService, {
    runTest: vi.fn(() =>
      Effect.fail(new SpeedTestExecutionError({ message: "Mock error" }))
    ),
  });

  const baseLayers = Layer.mergeAll(
    makeTestConfigLayer({
      ping: { hosts, timeout: 5000, intervalSeconds: 30 },
      speedtest: { intervalSeconds: 3600, timeoutSeconds: 120 },
      auth: { password: "testpassword" },
    }),
    Layer.succeed(References.MinimumLogLevel, "None")
  );

  const questDBWith = (
    writeMetric: () => Effect.Effect<void, DatabaseWriteError>
  ) =>
    Layer.succeed(QuestDB, {
      writeMetric,
      flush: vi.fn(() => Effect.void),
      queryMetrics: vi.fn(),
      querySpeedtests: vi.fn(),
      queryConnectivityStatus: vi.fn(),
      queryLiveConnectivity: vi.fn(),
      queryEarliestTimestamp: vi.fn(),
      queryLatestPingTimestamp: vi.fn(),
      ...emptyAnalyticsQueries,
      health: vi.fn(),
      close: vi.fn(),
    });

  const monitorWith = (
    pingExecutor: Layer.Layer<PingExecutor, never, ConfigService | QuestDB>,
    db: Layer.Layer<QuestDB>
  ) =>
    NetworkMonitorLive.pipe(
      Layer.provide(pingExecutor),
      Layer.provide(speedTestRunnerFrom(failingSpeedTest, db)),
      Layer.provide(db),
      Layer.provide(baseLayers)
    );

  const statsAfterBoot = Effect.gen(function* () {
    const monitor = yield* NetworkMonitor;
    yield* monitor.start();
    return yield* monitor.getStats();
  });

  const withExecutorResults = (results: readonly PingExecutionResult[]) => {
    const cycles = { count: 0 };
    const executor = Layer.succeed(PingExecutor, {
      executePing: vi.fn(),
      executeAll: () =>
        Effect.sync(() => {
          cycles.count += 1;
          return results;
        }),
      executeHosts: vi.fn(),
    });
    const layer = monitorWith(
      executor,
      questDBWith(() => Effect.void)
    );
    return { cycles, layer };
  };

  it.live("counts a failed write apart from a failed ping", () => {
    const { cycles, layer } = withExecutorResults([
      { host: "8.8.8.8", success: true, writeError: "DB unavailable" },
      { host: "1.1.1.1", success: true },
    ]);

    return Effect.gen(function* () {
      const stats = yield* statsAfterBoot;

      expect(cycles.count).toBe(1);
      expect(stats.failedPings).toBe(0);
      expect(stats.successfulPings).toBe(2 * cycles.count);
      expect(stats.failedWrites).toBe(cycles.count);
    }).pipe(Effect.provide(layer));
  });

  it.live(
    "counts a lost down row as both a failed ping and a failed write",
    () => {
      const { cycles, layer } = withExecutorResults([
        {
          host: "8.8.8.8",
          success: false,
          error: "PingHostUnreachableError",
          writeError: "DB write failed",
        },
        { host: "1.1.1.1", success: true },
      ]);

      return Effect.gen(function* () {
        const stats = yield* statsAfterBoot;

        expect(stats.failedPings).toBe(cycles.count);
        expect(stats.successfulPings).toBe(cycles.count);
        expect(stats.failedWrites).toBe(cycles.count);
      }).pipe(Effect.provide(layer));
    }
  );

  it.live(
    "does not count successful pings as failed while the database is down",
    () => {
      const layer = monitorWith(
        PingExecutorLive.pipe(
          Layer.provide(
            Layer.succeed(PingService, {
              ping: (host: string) =>
                Effect.succeed({
                  host,
                  alive: true,
                  latency: 10,
                  packetLoss: 0,
                }),
              pingWithConfig: vi.fn(),
              isReachable: vi.fn(),
            })
          )
        ),
        questDBWith(() =>
          Effect.fail(new DatabaseWriteError({ message: "DB unavailable" }))
        )
      );

      return Effect.gen(function* () {
        const stats = yield* statsAfterBoot;

        expect(stats.failedPings).toBe(0);
        expect(stats.successfulPings).toBeGreaterThanOrEqual(hosts.length);
        expect(stats.failedWrites).toBe(stats.successfulPings);
      }).pipe(Effect.provide(layer));
    }
  );
});

describe("NetworkMonitor loops", () => {
  const pingResults: readonly PingExecutionResult[] = [
    {
      host: "8.8.8.8",
      success: true,
      result: {
        host: "8.8.8.8",
        alive: true,
        latency: 10,
        packetLoss: 0,
        stddev: 1,
      },
    },
    {
      host: "1.1.1.1",
      success: true,
      result: {
        host: "1.1.1.1",
        alive: true,
        latency: 12,
        packetLoss: 0,
        stddev: 1,
      },
    },
  ];

  const database = Layer.succeed(QuestDB, {
    writeMetric: vi.fn(() => Effect.void),
    flush: vi.fn(() => Effect.void),
    queryMetrics: vi.fn(),
    querySpeedtests: vi.fn(),
    queryConnectivityStatus: vi.fn(),
    queryLiveConnectivity: vi.fn(),
    queryEarliestTimestamp: vi.fn(),
    queryLatestPingTimestamp: vi.fn(),
    ...emptyAnalyticsQueries,
    health: vi.fn(),
    close: vi.fn(),
  });

  const countingSpeedTest = () => {
    const calls = { count: 0 };
    const layer = Layer.succeed(SpeedTestService, {
      runTest: () =>
        Effect.suspend(() => {
          calls.count += 1;
          return Effect.fail(
            new SpeedTestExecutionError({ message: "Mock error" })
          );
        }),
    });
    return { calls, layer };
  };

  const monitorOver = (
    executor: Layer.Layer<PingExecutor>,
    pingIntervalSeconds: number,
    speedTest: Layer.Layer<SpeedTestService> = countingSpeedTest().layer
  ) =>
    NetworkMonitorLive.pipe(
      Layer.provide(executor),
      Layer.provide(speedTestRunnerFrom(speedTest, database)),
      Layer.provide(
        makeTestConfigLayer({
          ping: {
            hosts: ["8.8.8.8", "1.1.1.1"],
            intervalSeconds: pingIntervalSeconds,
          },
          speedtest: { intervalSeconds: 60 },
        })
      ),
      Layer.provide(Layer.succeed(References.MinimumLogLevel, "None"))
    );

  const countingExecutor = (cycleDuration?: Duration.Input) => {
    const calls = { count: 0 };
    const layer = Layer.succeed(PingExecutor, {
      executePing: vi.fn(),
      executeAll: () =>
        Effect.suspend(() => {
          calls.count += 1;
          return cycleDuration === undefined
            ? Effect.succeed(pingResults)
            : Effect.sleep(cycleDuration).pipe(Effect.as(pingResults));
        }),
      executeHosts: vi.fn(),
    });
    return { calls, layer };
  };

  it.effect("runs exactly one ping cycle at boot", () => {
    const { calls, layer } = countingExecutor();

    return Effect.gen(function* () {
      yield* TestClock.setTime(BOOT_TIME);
      const monitor = yield* NetworkMonitor;

      yield* monitor.start();
      yield* TestClock.adjust("1 second");

      expect(calls.count).toBe(1);
      expect((yield* monitor.getStats()).successfulPings).toBe(2);
    }).pipe(Effect.provide(monitorOver(layer, 30)));
  });

  it.effect("runs one more ping cycle per configured interval", () => {
    const { calls, layer } = countingExecutor();

    return Effect.gen(function* () {
      yield* TestClock.setTime(BOOT_TIME);
      const monitor = yield* NetworkMonitor;
      yield* monitor.start();

      yield* TestClock.adjust("14 seconds");
      expect(calls.count).toBe(1);

      yield* TestClock.adjust("1 second");
      expect(calls.count).toBe(2);

      yield* TestClock.adjust("15 seconds");
      expect(calls.count).toBe(3);
    }).pipe(Effect.provide(monitorOver(layer, 15)));
  });

  it.effect("holds a fixed cadence when a ping cycle takes time", () => {
    const { calls, layer } = countingExecutor("8 seconds");

    return Effect.gen(function* () {
      yield* TestClock.setTime(BOOT_TIME);
      const monitor = yield* NetworkMonitor;
      yield* Effect.forkChild(monitor.start());

      // Boot cycle ends at 8s; the loop's first run is one interval later.
      yield* TestClock.adjust("38 seconds");
      expect(calls.count).toBe(2);

      // A spaced schedule would wait out the 8s cycle and start the third
      // run at 76s.
      yield* TestClock.adjust("30 seconds");
      expect(calls.count).toBe(3);
    }).pipe(Effect.provide(monitorOver(layer, 30)));
  });

  it.effect("keeps the loops running after the starting fiber ends", () => {
    const { calls, layer } = countingExecutor();
    const speed = countingSpeedTest();

    return Effect.gen(function* () {
      yield* TestClock.setTime(BOOT_TIME);
      const monitor = yield* NetworkMonitor;

      yield* Fiber.join(yield* Effect.forkChild(monitor.start()));

      yield* TestClock.adjust("30 seconds");
      expect(calls.count).toBe(2);
      expect(speed.calls.count).toBe(1);

      yield* TestClock.adjust("30 seconds");
      expect(calls.count).toBe(3);
      expect(speed.calls.count).toBe(2);
    }).pipe(Effect.provide(monitorOver(layer, 30, speed.layer)));
  });

  it.effect("stops the loops when the provided scope closes", () => {
    const { calls, layer } = countingExecutor();
    const speed = countingSpeedTest();

    return Effect.gen(function* () {
      yield* TestClock.setTime(BOOT_TIME);
      const monitor = yield* NetworkMonitor;
      const scope = yield* Scope.make();

      yield* monitor.start().pipe(Scope.provide(scope));
      yield* TestClock.adjust("1 second");
      yield* Scope.close(scope, Exit.void);
      yield* TestClock.adjust("300 seconds");

      expect(calls.count).toBe(1);
      expect(speed.calls.count).toBe(1);
    }).pipe(Effect.provide(monitorOver(layer, 30, speed.layer)));
  });

  // Same shape as index.ts (scoped program inside Effect.provide), which can't
  // be imported without starting the server.
  it.effect("stops the loops before the layers they depend on release", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(BOOT_TIME);
      const events: string[] = [];
      const secondCycleStarted = yield* Deferred.make<void>();
      let cycles = 0;
      const executor = Layer.effect(
        PingExecutor,
        Effect.gen(function* () {
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              events.push("executor released");
            })
          );
          return {
            executePing: vi.fn(),
            executeHosts: vi.fn(),
            executeAll: () =>
              Effect.suspend(() => {
                cycles += 1;
                return cycles === 1
                  ? Effect.succeed(pingResults)
                  : Deferred.succeed(secondCycleStarted, undefined).pipe(
                      Effect.andThen(Effect.never),
                      Effect.onInterrupt(() =>
                        Effect.sync(() => {
                          events.push("cycle interrupted");
                        })
                      )
                    );
              }),
          };
        })
      );

      yield* Effect.gen(function* () {
        const monitor = yield* NetworkMonitor;
        yield* monitor.start();
        yield* TestClock.adjust("30 seconds");
        yield* Deferred.await(secondCycleStarted);
      }).pipe(Effect.scoped, Effect.provide(monitorOver(executor, 30)));

      expect(events).toEqual(["cycle interrupted", "executor released"]);
    })
  );
});
