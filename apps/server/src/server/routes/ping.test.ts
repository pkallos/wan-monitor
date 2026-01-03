import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "@/server/app";
import { pingRoutes } from "@/server/routes/ping";
import type { AppContext } from "@/server/types";
import type { AppConfig } from "@/services/config";
import type { PingExecutionResult } from "@/services/ping-executor";

const createTestApp = async (context: AppContext) => {
  const app = createApp({ jwtSecret: "test-secret", authRequired: false });

  await app.register(
    async (instance) => {
      await pingRoutes(instance, context);
    },
    { prefix: "/api/ping" }
  );

  await app.ready();
  return app;
};

describe("Ping Routes", () => {
  it("POST /trigger should execute pings for all configured hosts", async () => {
    const mockResults: readonly PingExecutionResult[] = [
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

    const executeAll = vi.fn(() => Effect.succeed(mockResults));

    const context: AppContext = {
      db: {
        health: () => Effect.succeed({ connected: true }),
        writeMetric: () => Effect.void,
        queryMetrics: () => Effect.succeed([]),
        querySpeedtests: () => Effect.succeed([]),
        queryConnectivityStatus: () => Effect.succeed([]),
        close: () => Effect.void,
      },
      pingExecutor: {
        executePing: vi.fn(),
        executeAll,
        executeHosts: vi.fn(),
      },
      speedTestService: {} as AppContext["speedTestService"],
      networkMonitor: {} as AppContext["networkMonitor"],
      config: {
        ping: {
          hosts: ["8.8.8.8", "1.1.1.1"],
          timeout: 5,
          trainCount: 10,
        },
      } as unknown as AppConfig,
    };

    const app = await createTestApp(context);

    const response = await app.inject({
      method: "POST",
      url: "/api/ping/trigger",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.results).toHaveLength(2);
    expect(executeAll).toHaveBeenCalled();
  });

  it("POST /trigger should execute pings for specified hosts", async () => {
    const mockResults: readonly PingExecutionResult[] = [
      {
        host: "8.8.8.8",
        success: true,
        result: {
          host: "8.8.8.8",
          alive: true,
          latency: 15.5,
          packetLoss: 0,
        },
      },
    ];

    const executeHosts = vi.fn(() => Effect.succeed(mockResults));

    const context: AppContext = {
      db: {
        health: () => Effect.succeed({ connected: true }),
        writeMetric: () => Effect.void,
        queryMetrics: () => Effect.succeed([]),
        querySpeedtests: () => Effect.succeed([]),
        queryConnectivityStatus: () => Effect.succeed([]),
        close: () => Effect.void,
      },
      pingExecutor: {
        executePing: vi.fn(),
        executeAll: vi.fn(),
        executeHosts,
      },
      speedTestService: {} as AppContext["speedTestService"],
      networkMonitor: {} as AppContext["networkMonitor"],
      config: {} as unknown as AppConfig,
    };

    const app = await createTestApp(context);

    const response = await app.inject({
      method: "POST",
      url: "/api/ping/trigger",
      payload: { hosts: ["8.8.8.8"] },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.results).toHaveLength(1);
    expect(executeHosts).toHaveBeenCalledWith(["8.8.8.8"]);
  });

  it("POST /trigger should return 500 on error", async () => {
    const executeAll = vi.fn().mockImplementation(() => {
      throw new Error("Ping execution failed");
    });

    const context: AppContext = {
      db: {
        health: () => Effect.succeed({ connected: true }),
        writeMetric: () => Effect.void,
        queryMetrics: () => Effect.succeed([]),
        querySpeedtests: () => Effect.succeed([]),
        queryConnectivityStatus: () => Effect.succeed([]),
        close: () => Effect.void,
      },
      pingExecutor: {
        executePing: vi.fn(),
        executeAll,
        executeHosts: vi.fn(),
      },
      speedTestService: {} as AppContext["speedTestService"],
      networkMonitor: {} as AppContext["networkMonitor"],
      config: {} as unknown as AppConfig,
    };

    const app = await createTestApp(context);

    const response = await app.inject({
      method: "POST",
      url: "/api/ping/trigger",
    });

    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body.success).toBe(false);
    expect(body.error).toBeDefined();
  });

  it("GET /hosts should return configured ping hosts", async () => {
    const context: AppContext = {
      db: {
        health: () => Effect.succeed({ connected: true }),
        writeMetric: () => Effect.void,
        queryMetrics: () => Effect.succeed([]),
        querySpeedtests: () => Effect.succeed([]),
        queryConnectivityStatus: () => Effect.succeed([]),
        close: () => Effect.void,
      },
      pingExecutor: {
        executePing: vi.fn(),
        executeAll: vi.fn(),
        executeHosts: vi.fn(),
      },
      speedTestService: {} as AppContext["speedTestService"],
      networkMonitor: {} as AppContext["networkMonitor"],
      config: {
        ping: {
          hosts: ["8.8.8.8", "1.1.1.1", "1.0.0.1"],
          timeout: 5,
          trainCount: 10,
        },
      } as unknown as AppConfig,
    };

    const app = await createTestApp(context);

    const response = await app.inject({
      method: "GET",
      url: "/api/ping/hosts",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.hosts).toEqual(["8.8.8.8", "1.1.1.1", "1.0.0.1"]);
  });
});
