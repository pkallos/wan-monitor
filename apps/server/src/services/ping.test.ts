import { Cause, Effect, Exit, Layer, Option } from "effect";
import { describe, expect, it, vi } from "vitest";
import { ConfigService } from "@/services/config";
import {
  PingHostUnreachableError,
  PingNetworkError,
  type PingResult,
  PingService,
  PingServiceLive,
  PingTimeoutError,
} from "@/services/ping";

// Mock the ping module
vi.mock("ping", () => ({
  default: {
    promise: {
      probe: vi.fn(),
    },
  },
}));

import ping from "ping";

// The @types/ping types are incorrect - time should be number | 'unknown'
// but the types say just number. We use 'as any' for mock responses.
const mockProbe = ping.promise.probe as ReturnType<typeof vi.fn>;

// Test config layer
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

const TestPingServiceLive = Layer.provide(PingServiceLive, TestConfigLive);

describe("PingService", () => {
  describe("ping", () => {
    it("should return successful ping result", async () => {
      mockProbe.mockResolvedValueOnce({
        inputHost: "8.8.8.8",
        host: "8.8.8.8",
        alive: true,
        output: "PING 8.8.8.8...",
        time: 25.5,
        times: [25.5],
        min: "25.5",
        max: "25.5",
        avg: "25.5",
        stddev: "0.0",
        packetLoss: "0.000",
      });

      const program = Effect.gen(function* () {
        const pingService = yield* PingService;
        return yield* pingService.ping("8.8.8.8");
      });

      const result = await Effect.runPromise(
        Effect.provide(program, TestPingServiceLive)
      );

      expect(result.host).toBe("8.8.8.8");
      expect(result.alive).toBe(true);
      expect(result.latency).toBe(25.5);
      expect(result.packetLoss).toBe(0);
      expect(result.min).toBe(25.5);
      expect(result.max).toBe(25.5);
      expect(result.avg).toBe(25.5);
    });

    it("should fail with PingHostUnreachableError when host is unreachable", async () => {
      mockProbe.mockResolvedValueOnce({
        inputHost: "192.168.255.255",
        host: "unknown",
        alive: false,
        output: "Request timeout",
        time: "unknown",
        times: [],
        min: "unknown",
        max: "unknown",
        avg: "unknown",
        stddev: "unknown",
        packetLoss: "unknown",
      });

      const program = Effect.gen(function* () {
        const pingService = yield* PingService;
        return yield* pingService.ping("192.168.255.255");
      });

      const result = await Effect.runPromiseExit(
        Effect.provide(program, TestPingServiceLive)
      );

      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result)) {
        const error = Cause.failureOption(result.cause);
        expect(Option.isSome(error)).toBe(true);
        if (Option.isSome(error)) {
          expect(error.value).toMatchObject({
            _tag: "PingHostUnreachableError",
            host: "192.168.255.255",
          });
        }
      }
    });

    it("should fail with PingNetworkError on network failure", async () => {
      mockProbe.mockRejectedValueOnce(new Error("Network is down"));

      const program = Effect.gen(function* () {
        const pingService = yield* PingService;
        return yield* pingService.ping("8.8.8.8");
      });

      const result = await Effect.runPromiseExit(
        Effect.provide(program, TestPingServiceLive)
      );

      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result)) {
        const error = Cause.failureOption(result.cause);
        expect(Option.isSome(error)).toBe(true);
        if (Option.isSome(error)) {
          expect(error.value).toMatchObject({
            _tag: "PingNetworkError",
            host: "8.8.8.8",
            message: "Network is down",
          });
        }
      }
    });

    it("should fail with PingTimeoutError on timeout", async () => {
      mockProbe.mockRejectedValueOnce(new Error("ping timeout"));

      const program = Effect.gen(function* () {
        const pingService = yield* PingService;
        return yield* pingService.ping("8.8.8.8");
      });

      const result = await Effect.runPromiseExit(
        Effect.provide(program, TestPingServiceLive)
      );

      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result)) {
        const error = Cause.failureOption(result.cause);
        expect(Option.isSome(error)).toBe(true);
        if (Option.isSome(error)) {
          expect(error.value).toMatchObject({
            _tag: "PingTimeoutError",
            host: "8.8.8.8",
          });
        }
      }
    });
  });

  describe("pingWithConfig", () => {
    it("should use custom timeout and trainCount", async () => {
      mockProbe.mockResolvedValueOnce({
        inputHost: "1.1.1.1",
        host: "1.1.1.1",
        alive: true,
        output: "PING 1.1.1.1...",
        time: 10.2,
        times: [10.2, 9.8, 10.5],
        min: "9.8",
        max: "10.5",
        avg: "10.2",
        stddev: "0.3",
        packetLoss: "0.000",
      });

      const program = Effect.gen(function* () {
        const pingService = yield* PingService;
        return yield* pingService.pingWithConfig("1.1.1.1", {
          timeout: 10,
          trainCount: 5,
        });
      });

      await Effect.runPromise(Effect.provide(program, TestPingServiceLive));

      expect(mockProbe).toHaveBeenCalledWith("1.1.1.1", {
        timeout: 10,
        extra: ["-c", "5", "-i", "0.25"],
      });
    });
  });

  describe("isReachable", () => {
    it("should return true when host is reachable", async () => {
      mockProbe.mockResolvedValueOnce({
        inputHost: "8.8.8.8",
        host: "8.8.8.8",
        alive: true,
        output: "PING...",
        time: 20,
        times: [20],
        min: "20",
        max: "20",
        avg: "20",
        stddev: "0",
        packetLoss: "0",
      });

      const program = Effect.gen(function* () {
        const pingService = yield* PingService;
        return yield* pingService.isReachable("8.8.8.8");
      });

      const result = await Effect.runPromise(
        Effect.provide(program, TestPingServiceLive)
      );

      expect(result).toBe(true);
    });

    it("should return false when host is unreachable", async () => {
      mockProbe.mockResolvedValueOnce({
        inputHost: "192.168.255.255",
        host: "unknown",
        alive: false,
        output: "Request timeout",
        time: "unknown",
        times: [],
        min: "unknown",
        max: "unknown",
        avg: "unknown",
        stddev: "unknown",
        packetLoss: "unknown",
      });

      const program = Effect.gen(function* () {
        const pingService = yield* PingService;
        return yield* pingService.isReachable("192.168.255.255");
      });

      const result = await Effect.runPromise(
        Effect.provide(program, TestPingServiceLive)
      );

      expect(result).toBe(false);
    });

    it("should return false on network error", async () => {
      mockProbe.mockRejectedValueOnce(new Error("Network error"));

      const program = Effect.gen(function* () {
        const pingService = yield* PingService;
        return yield* pingService.isReachable("8.8.8.8");
      });

      const result = await Effect.runPromise(
        Effect.provide(program, TestPingServiceLive)
      );

      expect(result).toBe(false);
    });
  });
});

describe("PingResult Schema", () => {
  it("should have correct structure", () => {
    const result: PingResult = {
      host: "8.8.8.8",
      alive: true,
      latency: 25.5,
      packetLoss: 0,
      min: 25.0,
      max: 26.0,
      avg: 25.5,
      stddev: 0.5,
    };

    expect(result.host).toBe("8.8.8.8");
    expect(result.alive).toBe(true);
    expect(result.latency).toBe(25.5);
  });
});

describe("Error Types", () => {
  it("should create PingNetworkError with correct tag", () => {
    const error = new PingNetworkError("8.8.8.8", "Network down");
    expect(error._tag).toBe("PingNetworkError");
    expect(error.host).toBe("8.8.8.8");
    expect(error.message).toBe("Network down");
  });

  it("should create PingTimeoutError with correct tag", () => {
    const error = new PingTimeoutError("8.8.8.8", 5000);
    expect(error._tag).toBe("PingTimeoutError");
    expect(error.host).toBe("8.8.8.8");
    expect(error.timeoutMs).toBe(5000);
  });

  it("should create PingHostUnreachableError with correct tag", () => {
    const error = new PingHostUnreachableError("8.8.8.8", "No route");
    expect(error._tag).toBe("PingHostUnreachableError");
    expect(error.host).toBe("8.8.8.8");
    expect(error.message).toBe("No route");
  });
});
