import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { getHostsHandler, triggerPingHandler } from "@/core/api/handlers/ping";
import {
  type PingExecutionResult,
  PingExecutor,
  type PingExecutorInterface,
} from "@/core/monitoring/ping-executor";
import { type AppConfig, ConfigService } from "@/infrastructure/config/config";

const createMockPingExecutor = (
  executeHostsResult: readonly PingExecutionResult[],
  executeAllResult: readonly PingExecutionResult[]
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
  executeAll: () => Effect.succeed(executeAllResult),
  executeHosts: (_hosts: readonly string[]) =>
    Effect.succeed(executeHostsResult),
});

const createMockConfig = (hosts: readonly string[]): AppConfig => ({
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

describe("Ping Handlers", () => {
  describe("triggerPing", () => {
    it.effect(
      "pings all configured hosts when no specific hosts provided",
      () => {
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
          createMockPingExecutor(mockResults, mockResults)
        );

        return Effect.gen(function* () {
          const result = yield* triggerPingHandler({ payload: null });

          expect(result.success).toBe(true);
          expect(result.results).toHaveLength(2);
          expect(result.results[0].host).toBe("8.8.8.8");
          expect(result.results[0].success).toBe(true);
          expect(result.results[1].host).toBe("1.1.1.1");
          expect(result.results[1].success).toBe(true);
        }).pipe(Effect.provide(PingExecutorTest));
      }
    );

    it.effect("pings only specified hosts when provided", () => {
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
        createMockPingExecutor(mockResults, [])
      );

      return Effect.gen(function* () {
        const result = yield* triggerPingHandler({
          payload: { hosts: ["www.google.com"] },
        });

        expect(result.success).toBe(true);
        expect(result.results).toHaveLength(1);
        expect(result.results[0].host).toBe("www.google.com");
        expect(result.results[0].success).toBe(true);
      }).pipe(Effect.provide(PingExecutorTest));
    });

    it.effect("returns error details when hosts are unreachable", () => {
      const mockResults: readonly PingExecutionResult[] = [
        {
          host: "unreachable.host",
          success: false,
          error: "Host unreachable",
        },
      ];

      const PingExecutorTest = Layer.succeed(
        PingExecutor,
        createMockPingExecutor(mockResults, mockResults)
      );

      return Effect.gen(function* () {
        const result = yield* triggerPingHandler({ payload: null });

        expect(result.success).toBe(true);
        expect(result.results).toHaveLength(1);
        expect(result.results[0].success).toBe(false);
        expect(result.results[0].error).toBe("Host unreachable");
      }).pipe(Effect.provide(PingExecutorTest));
    });
  });

  describe("getHosts", () => {
    it.effect("returns list of configured hosts", () => {
      const testHosts = ["8.8.8.8", "1.1.1.1", "cloudflare.com"];
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createMockConfig(testHosts)
      );

      return Effect.gen(function* () {
        const result = yield* getHostsHandler();
        expect(result.hosts).toEqual(testHosts);
      }).pipe(Effect.provide(ConfigServiceTest));
    });

    it.effect("returns empty list when no hosts configured", () => {
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createMockConfig([])
      );

      return Effect.gen(function* () {
        const result = yield* getHostsHandler();
        expect(result.hosts).toEqual([]);
      }).pipe(Effect.provide(ConfigServiceTest));
    });
  });
});
