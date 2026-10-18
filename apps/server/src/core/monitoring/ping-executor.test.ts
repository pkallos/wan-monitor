import { Effect, Layer, Logger } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PingExecutor,
  PingExecutorLive,
} from "@/core/monitoring/ping-executor";
import {
  DatabaseWriteError,
  DbUnavailable,
  QuestDB,
} from "@/infrastructure/database/questdb";
import {
  type PingError,
  PingHostUnreachableError,
  type PingResult,
  PingService,
} from "@/infrastructure/ping/service";
import { makeTestConfigLayer } from "@/test/config";
import { emptyAnalyticsQueries } from "@/test/questdb-stubs";

// Mock config
const TestConfigLive = makeTestConfigLayer({
  ping: { hosts: ["8.8.8.8", "1.1.1.1"] },
  auth: { password: "testpassword" },
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
  flush: vi.fn(),
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

// Combine layers for testing
const TestLive = Layer.provide(
  PingExecutorLive,
  Layer.mergeAll(TestConfigLive, MockPingServiceLive, MockQuestDBLive)
);

const captureLogs = () => {
  const entries: { level: string; text: string }[] = [];
  const layer = Logger.layer([
    Logger.make<unknown, void>(({ logLevel, message }) => {
      entries.push({ level: logLevel, text: String(message) });
    }),
  ]);
  return { entries, layer };
};

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

    it("should write a down metric when the ping succeeds but reports unreachable", async () => {
      const pingResult: PingResult = {
        host: "8.8.8.8",
        alive: false,
        latency: 0,
        packetLoss: 100,
        min: 0,
        max: 0,
        avg: 0,
        stddev: 0,
      };

      mockPing.mockReturnValue(Effect.succeed(pingResult));
      mockWriteMetric.mockReturnValue(Effect.succeed(undefined));

      const program = Effect.gen(function* () {
        const executor = yield* PingExecutor;
        return yield* executor.executePing("8.8.8.8");
      });

      const result = await Effect.runPromise(Effect.provide(program, TestLive));

      expect(result.success).toBe(true);
      expect(mockWriteMetric).toHaveBeenCalled();
      const writtenMetric = mockWriteMetric.mock.calls[0][0];
      expect(writtenMetric.connectivityStatus).toBe("down");
    });

    it("should handle ping failure and write metric with NULL latency", async () => {
      mockPing.mockReturnValue(
        Effect.fail(
          new PingHostUnreachableError({
            host: "unreachable.host",
            message: "Host unreachable",
          })
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

    it("should keep success true and report writeError when a good ping fails to write", async () => {
      const pingResult: PingResult = {
        host: "8.8.8.8",
        alive: true,
        latency: 15.5,
        packetLoss: 0,
      };
      const logs = captureLogs();

      mockPing.mockReturnValue(Effect.succeed(pingResult));
      mockWriteMetric.mockReturnValue(
        Effect.fail(new DatabaseWriteError({ message: "DB unavailable" }))
      );

      const program = Effect.gen(function* () {
        const executor = yield* PingExecutor;
        return yield* executor.executePing("8.8.8.8");
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(TestLive), Effect.provide(logs.layer))
      );

      expect(result.success).toBe(true);
      expect(result.host).toBe("8.8.8.8");
      expect(result.result).toEqual(pingResult);
      expect(result.writeError).toBe("DB unavailable");
      expect(result.error).toBeUndefined();
      expect(logs.entries).toHaveLength(1);
      expect(logs.entries[0]?.level).toBe("Error");
      expect(logs.entries[0]?.text).toContain("8.8.8.8");
    });

    it("should log an error and report writeError when the down row cannot be written", async () => {
      const logs = captureLogs();

      mockPing.mockReturnValue(
        Effect.fail(
          new PingHostUnreachableError({
            host: "unreachable.host",
            message: "Host unreachable",
          })
        )
      );
      mockWriteMetric.mockReturnValue(
        Effect.fail(new DatabaseWriteError({ message: "DB write failed" }))
      );

      const program = Effect.gen(function* () {
        const executor = yield* PingExecutor;
        return yield* executor.executePing("unreachable.host");
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(TestLive), Effect.provide(logs.layer))
      );

      expect(result.success).toBe(false);
      expect(result.host).toBe("unreachable.host");
      expect(result.error).toBe("PingHostUnreachableError");
      expect(result.writeError).toBe("DB write failed");
      expect(logs.entries).toHaveLength(1);
      expect(logs.entries[0]?.level).toBe("Error");
      expect(logs.entries[0]?.text).toContain("unreachable.host");
      expect(logs.entries[0]?.text).toContain("DB write failed");
    });

    it("should name the failure tag in the log so an outage reads differently from a bad write", async () => {
      const logs = captureLogs();

      mockPing.mockReturnValue(
        Effect.fail(
          new PingHostUnreachableError({
            host: "unreachable.host",
            message: "Host unreachable",
          })
        )
      );
      mockWriteMetric.mockReturnValue(
        Effect.fail(new DbUnavailable({ message: "QuestDB write timed out" }))
      );

      const program = Effect.gen(function* () {
        const executor = yield* PingExecutor;
        return yield* executor.executePing("unreachable.host");
      });

      await Effect.runPromise(
        program.pipe(Effect.provide(TestLive), Effect.provide(logs.layer))
      );

      expect(logs.entries[0]?.text).toContain("DbUnavailable");
    });

    it("should neither log nor report writeError when the write succeeds", async () => {
      const logs = captureLogs();

      mockPing.mockReturnValue(
        Effect.fail(
          new PingHostUnreachableError({
            host: "unreachable.host",
            message: "Host unreachable",
          })
        )
      );
      mockWriteMetric.mockReturnValue(Effect.succeed(undefined));

      const program = Effect.gen(function* () {
        const executor = yield* PingExecutor;
        return yield* executor.executePing("unreachable.host");
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(TestLive), Effect.provide(logs.layer))
      );

      expect(result.writeError).toBeUndefined();
      expect(logs.entries).toEqual([]);
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

    it("should stamp every host in a cycle with the identical timestamp, even when one fails", async () => {
      mockPing.mockImplementation((host: string) =>
        host === "flaky.host"
          ? Effect.fail(
              new PingHostUnreachableError({
                host,
                message: "Host unreachable",
              })
            )
          : Effect.succeed({
              host,
              alive: true,
              latency: 12.0,
              packetLoss: 0,
            } satisfies PingResult)
      );
      mockWriteMetric.mockReturnValue(Effect.succeed(undefined));

      const program = Effect.gen(function* () {
        const executor = yield* PingExecutor;
        return yield* executor.executeHosts(["stable.host", "flaky.host"]);
      });

      await Effect.runPromise(Effect.provide(program, TestLive));

      const timestamps = mockWriteMetric.mock.calls.map(
        ([metric]) => metric.timestamp
      );
      expect(timestamps).toHaveLength(2);
      expect(timestamps[0]).toBeInstanceOf(Date);
      // A downstream quorum query groups a cycle by exact timestamp equality
      // (see buildQueryConnectivityStatus), so every host in one executeHosts
      // call must share the identical Date instance value, not just be close.
      expect(timestamps[0].getTime()).toBe(timestamps[1].getTime());
    });
  });
});
