import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { type AppConfig, ConfigService } from "@/services/config";
import {
  type PingExecutionResult,
  PingExecutor,
  type PingExecutorInterface,
} from "@/services/ping-executor";

const createTestPingExecutorService = (
  executeHostsEffect: Effect.Effect<readonly PingExecutionResult[], never>,
  executeAllEffect: Effect.Effect<readonly PingExecutionResult[], never>
): PingExecutorInterface => ({
  executePing: (host: string) =>
    Effect.succeed({
      host,
      success: true,
      result: {
        host,
        alive: true,
        latency: 25.5,
        packetLoss: 0,
        min: 24.0,
        max: 27.0,
        avg: 25.5,
        stddev: 1.5,
      },
    }),
  executeAll: () => executeAllEffect,
  executeHosts: (_hosts: readonly string[]) => executeHostsEffect,
});

const createTestConfigService = (hosts: readonly string[]): AppConfig => ({
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
  ping: {
    timeout: 5,
    trainCount: 10,
    hosts,
  },
  auth: {
    username: "admin",
    password: "",
    jwtSecret: "test-secret",
    jwtExpiresIn: "24h",
  },
});

describe("Ping API Handlers", () => {
  describe("triggerPing handler", () => {
    it.effect("executes all hosts when no hosts specified", () => {
      const mockResults: readonly PingExecutionResult[] = [
        {
          host: "8.8.8.8",
          success: true,
          result: {
            host: "8.8.8.8",
            alive: true,
            latency: 15.5,
            packetLoss: 0,
            min: 14.0,
            max: 17.0,
            avg: 15.5,
            stddev: 1.0,
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
            min: 11.0,
            max: 13.0,
            avg: 12.3,
            stddev: 0.8,
          },
        },
      ];

      const PingExecutorTest = Layer.succeed(
        PingExecutor,
        createTestPingExecutorService(
          Effect.succeed(mockResults),
          Effect.succeed(mockResults)
        )
      );

      return Effect.gen(function* () {
        const pingExecutor = yield* PingExecutor;
        const results = yield* pingExecutor.executeAll();

        expect(results).toHaveLength(2);
        expect(results[0].host).toBe("8.8.8.8");
        expect(results[0].success).toBe(true);
        expect(results[1].host).toBe("1.1.1.1");
        expect(results[1].success).toBe(true);
        return results;
      }).pipe(Effect.provide(PingExecutorTest));
    });

    it.effect("executes specific hosts when hosts array provided", () => {
      const mockResults: readonly PingExecutionResult[] = [
        {
          host: "www.google.com",
          success: true,
          result: {
            host: "www.google.com",
            alive: true,
            latency: 25.5,
            packetLoss: 0,
            min: 24.0,
            max: 27.0,
            avg: 25.5,
            stddev: 1.5,
          },
        },
      ];

      const PingExecutorTest = Layer.succeed(
        PingExecutor,
        createTestPingExecutorService(
          Effect.succeed(mockResults),
          Effect.succeed([])
        )
      );

      return Effect.gen(function* () {
        const pingExecutor = yield* PingExecutor;
        const results = yield* pingExecutor.executeHosts(["www.google.com"]);

        expect(results).toHaveLength(1);
        expect(results[0].host).toBe("www.google.com");
        expect(results[0].success).toBe(true);
        return results;
      }).pipe(Effect.provide(PingExecutorTest));
    });

    it.effect("handles ping execution errors gracefully", () => {
      const mockResults: readonly PingExecutionResult[] = [
        {
          host: "unreachable.host",
          success: false,
          error: "Host unreachable",
        },
      ];

      const PingExecutorTest = Layer.succeed(
        PingExecutor,
        createTestPingExecutorService(
          Effect.succeed(mockResults),
          Effect.succeed(mockResults)
        )
      );

      return Effect.gen(function* () {
        const pingExecutor = yield* PingExecutor;
        const results = yield* pingExecutor.executeAll();

        expect(results).toHaveLength(1);
        expect(results[0].success).toBe(false);
        expect(results[0].error).toBe("Host unreachable");
        return results;
      }).pipe(Effect.provide(PingExecutorTest));
    });
  });

  describe("getHosts handler", () => {
    it.effect("returns configured ping hosts", () => {
      const testHosts = ["8.8.8.8", "1.1.1.1", "cloudflare.com"];
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createTestConfigService(testHosts)
      );

      return Effect.gen(function* () {
        const config = yield* ConfigService;

        expect(config.ping.hosts).toEqual(testHosts);
        return config.ping.hosts;
      }).pipe(Effect.provide(ConfigServiceTest));
    });

    it.effect("returns empty array when no hosts configured", () => {
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createTestConfigService([])
      );

      return Effect.gen(function* () {
        const config = yield* ConfigService;

        expect(config.ping.hosts).toEqual([]);
        return config.ping.hosts;
      }).pipe(Effect.provide(ConfigServiceTest));
    });
  });
});
