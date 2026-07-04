import type { NetworkMetric } from "@shared/metrics";
import { Effect, Fiber, Layer, Logger, LogLevel } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  type MonitorStats,
  NetworkMonitor,
  NetworkMonitorLive,
} from "@/core/monitoring/network-monitor";
import {
  type PingExecutionResult,
  PingExecutor,
} from "@/core/monitoring/ping-executor";
import { DatabaseWriteError, QuestDB } from "@/infrastructure/database/questdb";
import {
  SpeedTestExecutionError,
  SpeedTestTimeoutError,
} from "@/infrastructure/speedtest/errors";
// Import from speedtest-service to avoid native module loading
import { SpeedTestService } from "@/infrastructure/speedtest/types";
import { makeTestConfigLayer } from "@/test/config";

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
    auth: { password: "testpassword", jwtExpiresIn: "1h" },
  });

  const TestLayer = NetworkMonitorLive.pipe(
    Layer.provide(MockPingExecutor),
    Layer.provide(MockQuestDB),
    Layer.provide(MockSpeedTestService),
    Layer.provide(MockConfig),
    Layer.provide(Logger.minimumLogLevel(LogLevel.None))
  );

  it("should get initial stats", async () => {
    const program = Effect.gen(function* () {
      const monitor = yield* NetworkMonitor;
      const stats: MonitorStats = yield* monitor.getStats();

      expect(stats.uptime).toBe(0);
      expect(stats.lastPingTime).toBeNull();
      expect(stats.successfulPings).toBe(0);
      expect(stats.failedPings).toBe(0);
      expect(stats.lastSpeedTestTime).toBeNull();
      expect(stats.successfulSpeedTests).toBe(0);
      expect(stats.failedSpeedTests).toBe(0);
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));
  });

  it("should start monitoring and update stats after initial ping", async () => {
    const program = Effect.gen(function* () {
      const monitor = yield* NetworkMonitor;

      // Fork the start and interrupt after assertions
      const fiber = yield* Effect.fork(monitor.start());

      // Wait briefly for async effects
      yield* Effect.sleep("100 millis");

      const stats: MonitorStats = yield* monitor.getStats();

      expect(stats.uptime).toBeGreaterThan(0);
      expect(stats.lastPingTime).toBeInstanceOf(Date);
      // The scheduled task runs immediately after start, so we get 2 cycles x 2 hosts = 4
      expect(stats.successfulPings).toBeGreaterThanOrEqual(2);
      expect(stats.failedPings).toBe(0);

      // Interrupt the background monitor
      yield* Fiber.interrupt(fiber);
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));
  });

  it("should respect custom ping interval from config", async () => {
    const CustomPingConfig = makeTestConfigLayer({
      ping: {
        hosts: ["8.8.8.8", "1.1.1.1"],
        timeout: 5000,
        intervalSeconds: 30,
      },
      speedtest: { intervalSeconds: 3600, timeoutSeconds: 120 },
      auth: { password: "testpassword", jwtExpiresIn: "1h" },
    });

    const CustomPingTestLayer = NetworkMonitorLive.pipe(
      Layer.provide(MockPingExecutor),
      Layer.provide(MockQuestDB),
      Layer.provide(MockSpeedTestService),
      Layer.provide(CustomPingConfig),
      Layer.provide(Logger.minimumLogLevel(LogLevel.None))
    );

    const program = Effect.gen(function* () {
      const monitor = yield* NetworkMonitor;
      const fiber = yield* Effect.fork(monitor.start());
      yield* Effect.sleep("100 millis");
      const stats: MonitorStats = yield* monitor.getStats();

      // Should have run initial ping
      expect(stats.successfulPings).toBeGreaterThan(0);

      // Interrupt the background monitor
      yield* Fiber.interrupt(fiber);
    });

    await Effect.runPromise(program.pipe(Effect.provide(CustomPingTestLayer)));
  });

  it("should handle ping executor returning empty results", async () => {
    const EmptyResultsPingExecutor = Layer.succeed(PingExecutor, {
      executePing: vi.fn(),
      executeAll: () => Effect.succeed([]),
      executeHosts: vi.fn(),
    });

    const EmptyResultsTestLayer = NetworkMonitorLive.pipe(
      Layer.provide(EmptyResultsPingExecutor),
      Layer.provide(MockQuestDB),
      Layer.provide(MockSpeedTestService),
      Layer.provide(MockConfig),
      Layer.provide(Logger.minimumLogLevel(LogLevel.None))
    );

    const program = Effect.gen(function* () {
      const monitor = yield* NetworkMonitor;
      const fiber = yield* Effect.fork(monitor.start());

      yield* Effect.sleep("100 millis");

      const stats: MonitorStats = yield* monitor.getStats();
      expect(stats.successfulPings).toBe(0);
      expect(stats.failedPings).toBe(0);
      expect(stats.lastPingTime).not.toBeNull();

      yield* Fiber.interrupt(fiber);
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(EmptyResultsTestLayer))
    );
  });

  it("should track speed test configuration from config", async () => {
    const SpeedTestConfig = makeTestConfigLayer({
      ping: {
        hosts: ["8.8.8.8", "1.1.1.1"],
        timeout: 5000,
        intervalSeconds: 30,
      },
      speedtest: { intervalSeconds: 10, timeoutSeconds: 120 },
      auth: { password: "testpassword", jwtExpiresIn: "1h" },
    });

    const SpeedTestTestLayer = NetworkMonitorLive.pipe(
      Layer.provide(MockPingExecutor),
      Layer.provide(MockQuestDB),
      Layer.provide(MockSpeedTestService),
      Layer.provide(SpeedTestConfig),
      Layer.provide(Logger.minimumLogLevel(LogLevel.None))
    );

    const program = Effect.gen(function* () {
      const monitor = yield* NetworkMonitor;
      const fiber = yield* Effect.fork(monitor.start());

      yield* Effect.sleep("50 millis");

      const stats: MonitorStats = yield* monitor.getStats();
      expect(stats.lastSpeedTestTime).toBeNull();

      yield* Fiber.interrupt(fiber);
    });

    await Effect.runPromise(program.pipe(Effect.provide(SpeedTestTestLayer)));
  });

  it("should handle partial ping failures in results", async () => {
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
      Layer.provide(MockQuestDB),
      Layer.provide(MockSpeedTestService),
      Layer.provide(MockConfig),
      Layer.provide(Logger.minimumLogLevel(LogLevel.None))
    );

    const program = Effect.gen(function* () {
      const monitor = yield* NetworkMonitor;
      const fiber = yield* Effect.fork(monitor.start());

      yield* Effect.sleep("100 millis");

      const stats: MonitorStats = yield* monitor.getStats();
      expect(stats.successfulPings).toBe(1);
      expect(stats.failedPings).toBe(1);

      yield* Fiber.interrupt(fiber);
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(MixedResultsTestLayer))
    );
  });

  it("should keep running the speed test loop after a failed cycle", async () => {
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
      Layer.provide(MockQuestDB),
      Layer.provide(FlakySpeedTestService),
      Layer.provide(
        makeTestConfigLayer({
          ping: {
            hosts: ["8.8.8.8", "1.1.1.1"],
            timeout: 5000,
            intervalSeconds: 30,
          },
          speedtest: { intervalSeconds: 1, timeoutSeconds: 120 },
          auth: { password: "testpassword", jwtExpiresIn: "1h" },
        })
      ),
      Layer.provide(Logger.minimumLogLevel(LogLevel.None))
    );

    const program = Effect.gen(function* () {
      const monitor = yield* NetworkMonitor;

      // Keep the parent fiber alive (as index.ts does with Effect.never) so the
      // forked monitoring loops are not interrupted when start() returns.
      const fiber = yield* Effect.fork(
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
    });

    await Effect.runPromise(program.pipe(Effect.provide(FlakyTestLayer)));
  });

  it("should count a speed test as failed when the DB write fails", async () => {
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
          ? Effect.fail(new DatabaseWriteError("speed test write failed"))
          : Effect.void
      ),
      flush: vi.fn(() => Effect.void),
      queryMetrics: vi.fn(),
      querySpeedtests: vi.fn(),
      queryConnectivityStatus: vi.fn(),
      health: vi.fn(),
      close: vi.fn(),
    });

    const FailingWriteTestLayer = NetworkMonitorLive.pipe(
      Layer.provide(MockPingExecutor),
      Layer.provide(FailingSpeedTestWriteQuestDB),
      Layer.provide(SucceedingSpeedTestService),
      Layer.provide(
        makeTestConfigLayer({
          ping: {
            hosts: ["8.8.8.8", "1.1.1.1"],
            timeout: 5000,
            intervalSeconds: 30,
          },
          speedtest: { intervalSeconds: 1, timeoutSeconds: 120 },
          auth: { password: "testpassword", jwtExpiresIn: "1h" },
        })
      ),
      Layer.provide(Logger.minimumLogLevel(LogLevel.None))
    );

    const program = Effect.gen(function* () {
      const monitor = yield* NetworkMonitor;

      // Keep the parent fiber alive so the forked speed-test loop survives.
      const fiber = yield* Effect.fork(
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
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(FailingWriteTestLayer))
    );
  });

  it("should count a failed speed test when the test times out", async () => {
    // A speed-test timeout is a distinct error variant from an execution
    // error; the monitor must log it and count it as a failed speed test
    // without killing the recurring loop.
    const TimingOutSpeedTestService = Layer.succeed(SpeedTestService, {
      runTest: () =>
        Effect.fail(new SpeedTestTimeoutError({ timeoutMs: 30_000 })),
    });

    const TimeoutTestLayer = NetworkMonitorLive.pipe(
      Layer.provide(MockPingExecutor),
      Layer.provide(MockQuestDB),
      Layer.provide(TimingOutSpeedTestService),
      Layer.provide(
        makeTestConfigLayer({
          ping: {
            hosts: ["8.8.8.8", "1.1.1.1"],
            timeout: 5000,
            intervalSeconds: 30,
          },
          speedtest: { intervalSeconds: 1, timeoutSeconds: 120 },
          auth: { password: "testpassword", jwtExpiresIn: "1h" },
        })
      ),
      Layer.provide(Logger.minimumLogLevel(LogLevel.None))
    );

    const program = Effect.gen(function* () {
      const monitor = yield* NetworkMonitor;

      const fiber = yield* Effect.fork(
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
    });

    await Effect.runPromise(program.pipe(Effect.provide(TimeoutTestLayer)));
  });

  it("should maintain consistent counters after concurrent ping and speedtest cycles", async () => {
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
      auth: { password: "testpassword", jwtExpiresIn: "1h" },
    });

    const ConcurrentTestLayer = NetworkMonitorLive.pipe(
      Layer.provide(ConcurrentPingExecutor),
      Layer.provide(MockQuestDB),
      Layer.provide(ConcurrentSpeedTestService),
      Layer.provide(ConcurrentConfig),
      Layer.provide(Logger.minimumLogLevel(LogLevel.None))
    );

    const program = Effect.gen(function* () {
      const monitor = yield* NetworkMonitor;

      const fiber = yield* Effect.fork(
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
      expect(stats.successfulPings + stats.failedPings).toBe(totalPingResults);

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
    });

    await Effect.runPromise(program.pipe(Effect.provide(ConcurrentTestLayer)));
  });
});
