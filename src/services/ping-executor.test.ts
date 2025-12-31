import { Effect, Layer } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QuestDB } from '@/database/questdb';
import { ConfigService } from '@/services/config';
import { type PingResult, PingService } from '@/services/ping';
import { PingExecutor, PingExecutorLive } from '@/services/ping-executor';

// Mock config
const TestConfigLive = Layer.succeed(ConfigService, {
  server: { port: 3001, host: '0.0.0.0' },
  database: { host: 'localhost', port: 9000 },
  ping: { timeout: 5, retries: 1, hosts: ['8.8.8.8', '1.1.1.1'] },
});

// Mock PingService
// biome-ignore lint/suspicious/noExplicitAny: Mock needs flexible typing
const mockPing = vi.fn<[string], Effect.Effect<PingResult, any>>();
const MockPingServiceLive = Layer.succeed(PingService, {
  ping: mockPing,
  pingWithConfig: vi.fn(),
  isReachable: vi.fn(),
});

// Mock QuestDB
const mockWriteMetric = vi.fn();
const MockQuestDBLive = Layer.succeed(QuestDB, {
  writeMetric: mockWriteMetric,
  health: vi.fn(),
  close: vi.fn(),
});

// Combine layers for testing
const TestLive = Layer.provide(
  PingExecutorLive,
  Layer.mergeAll(TestConfigLive, MockPingServiceLive, MockQuestDBLive)
);

describe('PingExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('executePing', () => {
    it('should execute ping and write result to database', async () => {
      const pingResult: PingResult = {
        host: '8.8.8.8',
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
        return yield* executor.executePing('8.8.8.8');
      });

      const result = await Effect.runPromise(Effect.provide(program, TestLive));

      expect(result.success).toBe(true);
      expect(result.host).toBe('8.8.8.8');
      expect(result.result).toEqual(pingResult);
      expect(mockPing).toHaveBeenCalledWith('8.8.8.8');
      expect(mockWriteMetric).toHaveBeenCalled();
    });

    it('should handle ping failure and still write metric', async () => {
      mockPing.mockReturnValue(
        Effect.fail({ _tag: 'PingHostUnreachableError' as const })
      );
      mockWriteMetric.mockReturnValue(Effect.succeed(undefined));

      const program = Effect.gen(function* () {
        const executor = yield* PingExecutor;
        return yield* executor.executePing('unreachable.host');
      });

      const result = await Effect.runPromise(Effect.provide(program, TestLive));

      expect(result.success).toBe(false);
      expect(result.host).toBe('unreachable.host');
      expect(result.error).toBe('PingHostUnreachableError');
      // Should still try to write a "down" metric
      expect(mockWriteMetric).toHaveBeenCalled();
    });
  });

  describe('executeAll', () => {
    it('should execute pings for all configured hosts', async () => {
      const pingResult: PingResult = {
        host: '8.8.8.8',
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

  describe('executeHosts', () => {
    it('should execute pings for specified hosts', async () => {
      const pingResult: PingResult = {
        host: 'custom.host',
        alive: true,
        latency: 20.0,
        packetLoss: 0,
      };

      mockPing.mockReturnValue(Effect.succeed(pingResult));
      mockWriteMetric.mockReturnValue(Effect.succeed(undefined));

      const program = Effect.gen(function* () {
        const executor = yield* PingExecutor;
        return yield* executor.executeHosts(['custom.host', 'another.host']);
      });

      const results = await Effect.runPromise(
        Effect.provide(program, TestLive)
      );

      expect(results).toHaveLength(2);
      expect(mockPing).toHaveBeenCalledWith('custom.host');
      expect(mockPing).toHaveBeenCalledWith('another.host');
    });
  });
});
