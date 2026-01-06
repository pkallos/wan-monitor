import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PingExecutor,
  PingExecutorLive,
} from "@/core/monitoring/ping-executor";
import { ConfigService } from "@/infrastructure/config/config";
import { QuestDB } from "@/infrastructure/database/questdb";
import {
  type PingError,
  PingHostUnreachableError,
  type PingResult,
  PingService,
} from "@/infrastructure/ping/service";

// Mock config
const TestConfigLive = Layer.succeed(ConfigService, {
  server: { port: 3001, host: "0.0.0.0" },
  database: {
    host: "localhost",
    port: 9000,
    protocol: "http",
    autoFlushRows: 100,
    autoFlushInterval: 1000,
    requestTimeout: 10000,
    retryTimeout: 1000,
  },
  ping: { timeout: 5, trainCount: 10, hosts: ["8.8.8.8", "1.1.1.1"] },
  auth: {
    username: "admin",
    password: "testpassword",
    jwtSecret: "test-secret",
    jwtExpiresIn: "1h",
  },
});

// Mock PingService
// Type the mock function signature explicitly for the PingService interface
type PingFn = (host: string) => Effect.Effect<PingResult, PingError, never>;
const mockPing = vi.fn<PingFn>();
const MockPingServiceLive = Layer.succeed(PingService, {
  ping: mockPing,
  pingWithConfig: vi.fn(),
  isReachable: vi.fn(),
});

// Mock QuestDB
const mockWriteMetric = vi.fn();
const MockQuestDBLive = Layer.succeed(QuestDB, {
  writeMetric: mockWriteMetric,
  queryMetrics: vi.fn(),
  querySpeedtests: vi.fn(),
  queryConnectivityStatus: vi.fn(),
  health: vi.fn(),
  close: vi.fn(),
});

// Combine layers for testing
const TestLive = Layer.provide(
  PingExecutorLive,
  Layer.mergeAll(TestConfigLive, MockPingServiceLive, MockQuestDBLive)
);

describe("PingExecutor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("executePing", () => {
    it("should execute ping and write result to database", async () => {
      const pingResult: PingResult = {
        host: "8.8.8.8",
        alive: true,
        latency: 15.5,
        packetLoss: 0,
        min: 14.0,
        max: 17.0,
        avg: 15.5,
        stddev: 1.2,
      };

      mockPing.mockReturnValue(Effect.succeed(pingResult));
      mockWriteMetric.mockReturnValue(Effect.succeed(undefined));

      const program = Effect.gen(function* () {
        const executor = yield* PingExecutor;
        return yield* executor.executePing("8.8.8.8");
      });

      const result = await Effect.runPromise(Effect.provide(program, TestLive));

      expect(result.success).toBe(true);
      expect(result.host).toBe("8.8.8.8");
      expect(result.result).toEqual(pingResult);
      expect(mockPing).toHaveBeenCalledWith("8.8.8.8");
      expect(mockWriteMetric).toHaveBeenCalled();
    });

    it("should handle ping failure and write metric with NULL latency", async () => {
      mockPing.mockReturnValue(
        Effect.fail(
          new PingHostUnreachableError("unreachable.host", "Host unreachable")
        )
      );
      mockWriteMetric.mockReturnValue(Effect.succeed(undefined));

      const program = Effect.gen(function* () {
        const executor = yield* PingExecutor;
        return yield* executor.executePing("unreachable.host");
      });

      const result = await Effect.runPromise(Effect.provide(program, TestLive));

      expect(result.success).toBe(false);
      expect(result.host).toBe("unreachable.host");
      expect(result.error).toBe("PingHostUnreachableError");
      // Should write a "down" metric with no latency (NULL in DB)
      expect(mockWriteMetric).toHaveBeenCalled();
      const writtenMetric = mockWriteMetric.mock.calls[0][0];
      expect(writtenMetric.latency).toBeUndefined();
      expect(writtenMetric.packetLoss).toBe(100);
      expect(writtenMetric.connectivityStatus).toBe("down");
    });

    it("should handle database write failure gracefully and return success=false with result", async () => {
      const pingResult: PingResult = {
        host: "8.8.8.8",
        alive: true,
        latency: 15.5,
        packetLoss: 0,
      };

      mockPing.mockReturnValue(Effect.succeed(pingResult));
      mockWriteMetric.mockReturnValue(
        Effect.fail({
          _tag: "DatabaseWriteError" as const,
          message: "DB unavailable",
        })
      );

      const program = Effect.gen(function* () {
        const executor = yield* PingExecutor;
        return yield* executor.executePing("8.8.8.8");
      });

      const result = await Effect.runPromise(Effect.provide(program, TestLive));

      expect(result.success).toBe(false);
      expect(result.host).toBe("8.8.8.8");
      expect(result.result).toEqual(pingResult);
      expect(result.error).toContain("Database write failed");
    });

    it("should ignore database write errors when ping itself fails", async () => {
      mockPing.mockReturnValue(
        Effect.fail(
          new PingHostUnreachableError("unreachable.host", "Host unreachable")
        )
      );
      mockWriteMetric.mockReturnValue(
        Effect.fail({
          _tag: "DatabaseWriteError" as const,
          message: "DB write failed",
        })
      );

      const program = Effect.gen(function* () {
        const executor = yield* PingExecutor;
        return yield* executor.executePing("unreachable.host");
      });

      const result = await Effect.runPromise(Effect.provide(program, TestLive));

      expect(result.success).toBe(false);
      expect(result.host).toBe("unreachable.host");
      expect(result.error).toBe("PingHostUnreachableError");
    });
  });

  describe("executeAll", () => {
    it("should execute pings for all configured hosts", async () => {
      const pingResult: PingResult = {
        host: "8.8.8.8",
        alive: true,
        latency: 15.5,
        packetLoss: 0,
      };

      mockPing.mockReturnValue(Effect.succeed(pingResult));
      mockWriteMetric.mockReturnValue(Effect.succeed(undefined));

      const program = Effect.gen(function* () {
        const executor = yield* PingExecutor;
        return yield* executor.executeAll();
      });

      const results = await Effect.runPromise(
        Effect.provide(program, TestLive)
      );

      // Should ping both configured hosts
      expect(results).toHaveLength(2);
      expect(mockPing).toHaveBeenCalledTimes(2);
    });
  });

  describe("executeHosts", () => {
    it("should execute pings for specified hosts", async () => {
      const pingResult: PingResult = {
        host: "custom.host",
        alive: true,
        latency: 20.0,
        packetLoss: 0,
      };

      mockPing.mockReturnValue(Effect.succeed(pingResult));
      mockWriteMetric.mockReturnValue(Effect.succeed(undefined));

      const program = Effect.gen(function* () {
        const executor = yield* PingExecutor;
        return yield* executor.executeHosts(["custom.host", "another.host"]);
      });

      const results = await Effect.runPromise(
        Effect.provide(program, TestLive)
      );

      expect(results).toHaveLength(2);
      expect(mockPing).toHaveBeenCalledWith("custom.host");
      expect(mockPing).toHaveBeenCalledWith("another.host");
    });
  });
});
