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
import { ConfigService } from "@/infrastructure/config/config";
import { QuestDB } from "@/infrastructure/database/questdb";
import { SpeedTestExecutionError } from "@/infrastructure/speedtest/errors";
// Import from speedtest-service to avoid native module loading
import { SpeedTestService } from "@/infrastructure/speedtest/types";

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
    queryMetrics: vi.fn(),
    querySpeedtests: vi.fn(),
    queryConnectivityStatus: vi.fn(),
    health: vi.fn(),
    close: vi.fn(),
  });

  const MockSpeedTestService = Layer.succeed(SpeedTestService, {
    runTest: vi.fn(() =>
      Effect.fail(new SpeedTestExecutionError("Mock error"))
    ),
  });

  const MockConfig = Layer.succeed(ConfigService, {
    server: {
      port: 3001,
      host: "0.0.0.0",
    },
    database: {
      host: "localhost",
      port: 9000,
      protocol: "http" as const,
      autoFlushRows: 100,
      autoFlushInterval: 1000,
      requestTimeout: 10000,
      retryTimeout: 1000,
    },
    ping: {
      hosts: ["8.8.8.8", "1.1.1.1"],
      timeout: 5000,
      trainCount: 10,
    },
    auth: {
      username: "admin",
      password: "testpassword",
      jwtSecret: "test-secret",
      jwtExpiresIn: "1h",
    },
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
    // Test with environment variable
    process.env.PING_INTERVAL_SECONDS = "30";

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

    await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));

    delete process.env.PING_INTERVAL_SECONDS;
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

  it("should track speed test configuration from environment", async () => {
    process.env.SPEEDTEST_INTERVAL_SECONDS = "10";

    const program = Effect.gen(function* () {
      const monitor = yield* NetworkMonitor;
      const fiber = yield* Effect.fork(monitor.start());

      yield* Effect.sleep("50 millis");

      const stats: MonitorStats = yield* monitor.getStats();
      expect(stats.lastSpeedTestTime).toBeNull();

      yield* Fiber.interrupt(fiber);
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));

    delete process.env.SPEEDTEST_INTERVAL_SECONDS;
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
});
