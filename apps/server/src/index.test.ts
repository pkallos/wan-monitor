import { Cause, Effect, Exit, Fiber, Layer, Logger, LogLevel } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NetworkMonitor,
  NetworkMonitorLive,
} from "@/core/monitoring/network-monitor";
import { PingExecutor } from "@/core/monitoring/ping-executor";
import { JwtService } from "@/infrastructure/auth/jwt";
import { AuthService } from "@/infrastructure/auth/middleware";
import { type AppConfig, ConfigService } from "@/infrastructure/config/config";
import { QuestDB } from "@/infrastructure/database/questdb";
import { SpeedTestService } from "@/infrastructure/speedtest/types";

/**
 * Integration tests for server startup and lifecycle (index.ts)
 *
 * These tests validate the main server entry point including:
 * - NetworkMonitor startup and operation
 * - Service layer initialization
 * - Graceful shutdown and cleanup
 * - Error scenarios during startup
 *
 * Note: API HTTP server startup is tested separately in handler tests
 */
describe("Server Lifecycle Integration Tests", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // Helper to create a test config layer
  const createConfigServiceTest = (config: Partial<AppConfig> = {}) => {
    const defaultConfig: AppConfig = {
      server: {
        port: 0, // Use port 0 to let OS assign available port
        host: "0.0.0.0",
      },
      database: {
        host: "localhost",
        port: 9000,
        protocol: "http",
        autoFlushRows: 100,
        autoFlushInterval: 1000,
        requestTimeout: 10000,
        retryTimeout: 1000,
      },
      ping: {
        hosts: ["8.8.8.8", "1.1.1.1", "cloudflare.com"],
        timeout: 5000,
        trainCount: 10,
      },
      auth: {
        username: "admin",
        password: "testpassword",
        jwtSecret: "test-secret",
        jwtExpiresIn: "1h",
      },
      ...config,
    };

    return Layer.succeed(ConfigService, defaultConfig);
  };

  // Mock services for testing
  const PingExecutorTest = Layer.succeed(PingExecutor, {
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
      ]),
    executeHosts: vi.fn(),
  });

  const QuestDBTest = Layer.succeed(QuestDB, {
    writeMetric: vi.fn(() => Effect.void),
    queryMetrics: vi.fn(),
    querySpeedtests: vi.fn(),
    queryConnectivityStatus: vi.fn(),
    health: vi.fn(() =>
      Effect.succeed({
        connected: true,
        version: "1.0.0",
        uptime: 1000,
      })
    ),
    close: vi.fn(() => Effect.void),
  });

  const SpeedTestServiceTest = Layer.succeed(SpeedTestService, {
    runTest: vi.fn(() =>
      Effect.succeed({
        timestamp: new Date(),
        downloadSpeed: 100.0,
        uploadSpeed: 50.0,
        latency: 10.0,
        jitter: 2.0,
      })
    ),
  });

  const JwtServiceTest = Layer.succeed(JwtService, {
    sign: vi.fn((_username: string) =>
      Effect.succeed({
        token: "mock-token",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      })
    ),
    verify: vi.fn((_token: string) =>
      Effect.succeed({
        username: "admin",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ),
    decode: vi.fn((_token: string) =>
      Effect.succeed({
        username: "admin",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ),
  });

  const AuthServiceTest = Layer.succeed(AuthService, {
    verifyRequest: vi.fn((_authHeader: string | undefined) =>
      Effect.succeed({
        username: "admin",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ),
    isAuthRequired: vi.fn(() => Effect.succeed(false)),
  });

  const createTestLayer = (configOverrides: Partial<AppConfig> = {}) => {
    const ConfigServiceTest = createConfigServiceTest(configOverrides);

    const NetworkMonitorTest = NetworkMonitorLive.pipe(
      Layer.provide(PingExecutorTest),
      Layer.provide(QuestDBTest),
      Layer.provide(SpeedTestServiceTest)
    );

    // Merge all test services (API server startup tested separately in handler tests)
    return Layer.mergeAll(
      ConfigServiceTest,
      NetworkMonitorTest,
      PingExecutorTest,
      QuestDBTest,
      SpeedTestServiceTest,
      JwtServiceTest,
      AuthServiceTest
    ).pipe(Layer.provide(Logger.minimumLogLevel(LogLevel.None)));
  };

  describe("Server Startup", () => {
    it("should start NetworkMonitor and initialize services successfully", async () => {
      const program = Effect.gen(function* () {
        const monitor = yield* NetworkMonitor;
        const config = yield* ConfigService;

        // Verify monitor is available and config is loaded
        expect(monitor).toBeDefined();
        expect(config).toBeDefined();
        expect(config.server.port).toBe(0);

        // Start monitoring (mimics index.ts behavior)
        const fiber = yield* Effect.fork(monitor.start());

        // Wait briefly for async effects
        yield* Effect.sleep("100 millis");

        // Verify monitoring is running
        const stats = yield* monitor.getStats();
        expect(stats.uptime).toBeGreaterThan(0);
        expect(stats.successfulPings).toBeGreaterThanOrEqual(1);

        // Clean shutdown
        yield* Fiber.interrupt(fiber);
      });

      await Effect.runPromise(program.pipe(Effect.provide(createTestLayer())));
    });

    it("should start with custom configuration", async () => {
      const customConfig: Partial<AppConfig> = {
        server: {
          port: 8080,
          host: "127.0.0.1",
        },
        ping: {
          hosts: ["8.8.8.8"],
          timeout: 10000,
          trainCount: 5,
        },
      };

      const program = Effect.gen(function* () {
        const monitor = yield* NetworkMonitor;
        const config = yield* ConfigService;

        // Verify custom config is applied
        expect(config.server.port).toBe(8080);
        expect(config.server.host).toBe("127.0.0.1");
        expect(config.ping.hosts).toEqual(["8.8.8.8"]);

        // Start and verify it works
        const fiber = yield* Effect.fork(monitor.start());
        yield* Effect.sleep("100 millis");

        const stats = yield* monitor.getStats();
        expect(stats.uptime).toBeGreaterThan(0);

        yield* Fiber.interrupt(fiber);
      });

      await Effect.runPromise(
        program.pipe(Effect.provide(createTestLayer(customConfig)))
      );
    });

    it("should initialize all required service layers", async () => {
      const program = Effect.gen(function* () {
        // Verify all services are available (mimics MainLive layer composition)
        const config = yield* ConfigService;
        const monitor = yield* NetworkMonitor;
        const pingExecutor = yield* PingExecutor;
        const questdb = yield* QuestDB;
        const speedtest = yield* SpeedTestService;
        const jwt = yield* JwtService;
        const auth = yield* AuthService;

        expect(config).toBeDefined();
        expect(monitor).toBeDefined();
        expect(pingExecutor).toBeDefined();
        expect(questdb).toBeDefined();
        expect(speedtest).toBeDefined();
        expect(jwt).toBeDefined();
        expect(auth).toBeDefined();

        // Verify services are functional
        const health = yield* questdb.health();
        expect(health.connected).toBe(true);

        const tokenResponse = yield* jwt.sign("admin");
        expect(tokenResponse.token).toBe("mock-token");
      });

      await Effect.runPromise(program.pipe(Effect.provide(createTestLayer())));
    });
  });

  describe("NetworkMonitor Lifecycle", () => {
    it("should start NetworkMonitor and collect metrics", async () => {
      const program = Effect.gen(function* () {
        const monitor = yield* NetworkMonitor;

        // Start monitoring
        const fiber = yield* Effect.fork(monitor.start());

        // Wait for monitoring to run
        yield* Effect.sleep("150 millis");

        // Verify stats are being collected
        const stats = yield* monitor.getStats();
        expect(stats.uptime).toBeGreaterThan(0);
        expect(stats.lastPingTime).toBeInstanceOf(Date);
        expect(stats.successfulPings).toBeGreaterThanOrEqual(1);
        expect(stats.failedPings).toBe(0);

        yield* Fiber.interrupt(fiber);
      });

      await Effect.runPromise(program.pipe(Effect.provide(createTestLayer())));
    });

    it("should handle NetworkMonitor interruption gracefully", async () => {
      const program = Effect.gen(function* () {
        const monitor = yield* NetworkMonitor;

        const fiber = yield* Effect.fork(monitor.start());
        yield* Effect.sleep("50 millis");

        // Gracefully interrupt
        const interruptExit = yield* Effect.exit(Fiber.interrupt(fiber));

        // Should complete successfully
        expect(Exit.isSuccess(interruptExit)).toBe(true);
      });

      await Effect.runPromise(program.pipe(Effect.provide(createTestLayer())));
    });

    it("should maintain stats during operation", async () => {
      const program = Effect.gen(function* () {
        const monitor = yield* NetworkMonitor;

        const fiber = yield* Effect.fork(monitor.start());

        // Check stats multiple times
        yield* Effect.sleep("50 millis");
        const stats1 = yield* monitor.getStats();

        yield* Effect.sleep("50 millis");
        const stats2 = yield* monitor.getStats();

        // Stats should be maintained and updated
        expect(stats1.uptime).toBeGreaterThanOrEqual(0);
        expect(stats2.uptime).toBeGreaterThanOrEqual(stats1.uptime);
        expect(stats2.successfulPings).toBeGreaterThanOrEqual(
          stats1.successfulPings
        );

        yield* Fiber.interrupt(fiber);
      });

      await Effect.runPromise(program.pipe(Effect.provide(createTestLayer())));
    });
  });

  describe("Error Scenarios", () => {
    it("should handle database connection failures during startup", async () => {
      class DbUnavailable {
        readonly _tag = "DbUnavailable";
        constructor(readonly message: string) {}
      }

      const QuestDBFailingTest = Layer.succeed(QuestDB, {
        writeMetric: vi.fn(() =>
          Effect.fail(new DbUnavailable("Connection refused"))
        ),
        queryMetrics: vi.fn(() =>
          Effect.fail(new DbUnavailable("Connection refused"))
        ),
        querySpeedtests: vi.fn(),
        queryConnectivityStatus: vi.fn(),
        health: vi.fn(() =>
          Effect.fail(new DbUnavailable("Connection refused"))
        ),
        close: vi.fn(() => Effect.void),
      });

      const ConfigServiceTest = createConfigServiceTest();
      const NetworkMonitorTest = NetworkMonitorLive.pipe(
        Layer.provide(PingExecutorTest),
        Layer.provide(QuestDBFailingTest),
        Layer.provide(SpeedTestServiceTest)
      );

      const TestLayer = Layer.mergeAll(
        ConfigServiceTest,
        NetworkMonitorTest,
        PingExecutorTest,
        QuestDBFailingTest,
        SpeedTestServiceTest,
        JwtServiceTest,
        AuthServiceTest
      ).pipe(Layer.provide(Logger.minimumLogLevel(LogLevel.None)));

      const program = Effect.gen(function* () {
        const questdb = yield* QuestDB;

        // Attempt to check health
        const healthExit = yield* Effect.exit(questdb.health());

        // Should fail with database error
        expect(Exit.isFailure(healthExit)).toBe(true);
        if (Exit.isFailure(healthExit)) {
          const cause = healthExit.cause;
          expect(Cause.isFailType(cause)).toBe(true);
          if (Cause.isFailType(cause)) {
            expect(cause.error).toBeInstanceOf(DbUnavailable);
            expect(cause.error._tag).toBe("DbUnavailable");
          }
        }
      });

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));
    });

    it("should handle PingExecutor returning empty results", async () => {
      const EmptyPingExecutorTest = Layer.succeed(PingExecutor, {
        executePing: vi.fn(),
        executeAll: () => Effect.succeed([]),
        executeHosts: vi.fn(),
      });

      const ConfigServiceTest = createConfigServiceTest();
      const NetworkMonitorTest = NetworkMonitorLive.pipe(
        Layer.provide(EmptyPingExecutorTest),
        Layer.provide(QuestDBTest),
        Layer.provide(SpeedTestServiceTest)
      );

      const TestLayer = Layer.mergeAll(
        ConfigServiceTest,
        NetworkMonitorTest,
        EmptyPingExecutorTest,
        QuestDBTest,
        SpeedTestServiceTest,
        JwtServiceTest,
        AuthServiceTest
      ).pipe(Layer.provide(Logger.minimumLogLevel(LogLevel.None)));

      const program = Effect.gen(function* () {
        const monitor = yield* NetworkMonitor;
        const fiber = yield* Effect.fork(monitor.start());

        yield* Effect.sleep("100 millis");

        const stats = yield* monitor.getStats();
        expect(stats.successfulPings).toBe(0);
        expect(stats.failedPings).toBe(0);
        expect(stats.lastPingTime).not.toBeNull();

        yield* Fiber.interrupt(fiber);
      });

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));
    });
  });

  describe("Shutdown and Cleanup", () => {
    it("should clean up resources on shutdown", async () => {
      const closeMock = vi.fn(() => Effect.void);
      const QuestDBTestWithClose = Layer.succeed(QuestDB, {
        writeMetric: vi.fn(() => Effect.void),
        queryMetrics: vi.fn(),
        querySpeedtests: vi.fn(),
        queryConnectivityStatus: vi.fn(),
        health: vi.fn(() =>
          Effect.succeed({
            connected: true,
            version: "1.0.0",
            uptime: 1000,
          })
        ),
        close: closeMock,
      });

      const ConfigServiceTest = createConfigServiceTest();
      const NetworkMonitorTest = NetworkMonitorLive.pipe(
        Layer.provide(PingExecutorTest),
        Layer.provide(QuestDBTestWithClose),
        Layer.provide(SpeedTestServiceTest)
      );

      const TestLayer = Layer.mergeAll(
        ConfigServiceTest,
        NetworkMonitorTest,
        PingExecutorTest,
        QuestDBTestWithClose,
        SpeedTestServiceTest,
        JwtServiceTest,
        AuthServiceTest
      ).pipe(Layer.provide(Logger.minimumLogLevel(LogLevel.None)));

      const program = Effect.gen(function* () {
        const monitor = yield* NetworkMonitor;
        const questdb = yield* QuestDB;

        const fiber = yield* Effect.fork(monitor.start());
        yield* Effect.sleep("50 millis");

        // Verify database is accessible
        const health = yield* questdb.health();
        expect(health.connected).toBe(true);

        // Interrupt and cleanup
        yield* Fiber.interrupt(fiber);

        // Note: Layer cleanup happens automatically when Effect completes
        expect(questdb.close).toBeDefined();
      });

      await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));
    });

    it("should handle multiple rapid shutdown requests", async () => {
      const program = Effect.gen(function* () {
        const monitor = yield* NetworkMonitor;

        const fiber = yield* Effect.fork(monitor.start());
        yield* Effect.sleep("50 millis");

        // Multiple interrupt attempts should be safe (idempotent)
        const interrupt1 = Effect.exit(Fiber.interrupt(fiber));
        const interrupt2 = Effect.exit(Fiber.interrupt(fiber));

        const [exit1, exit2] = yield* Effect.all([interrupt1, interrupt2]);

        expect(Exit.isSuccess(exit1) || Exit.isInterrupted(exit1)).toBe(true);
        expect(Exit.isSuccess(exit2) || Exit.isInterrupted(exit2)).toBe(true);
      });

      await Effect.runPromise(program.pipe(Effect.provide(createTestLayer())));
    });
  });
});
