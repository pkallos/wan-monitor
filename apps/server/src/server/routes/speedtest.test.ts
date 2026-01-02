import { mbpsToBps } from "@wan-monitor/shared";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { QuestDBService } from "@/database/questdb";
import { createApp } from "@/server/app";
import { SpeedTestErrorCode, speedtestRoutes } from "@/server/routes/speedtest";
import type { AppContext } from "@/server/types";
import {
  type SpeedTestError,
  SpeedTestExecutionError,
  SpeedTestTimeoutError,
} from "@/services/speedtest-errors";

interface SpeedTestResult {
  timestamp: Date;
  downloadSpeed: number;
  uploadSpeed: number;
  latency: number;
  jitter?: number;
  serverId?: string;
  serverName?: string;
  serverLocation?: string;
  serverCountry?: string;
  isp?: string;
  externalIp?: string;
  internalIp?: string;
}

interface SpeedTestServiceInterface {
  readonly runTest: () => Effect.Effect<SpeedTestResult, SpeedTestError, never>;
}

const createTestApp = async (context: AppContext) => {
  const app = createApp({ jwtSecret: "test-secret", authRequired: false });

  await app.register(
    async (instance) => {
      await speedtestRoutes(instance, context);
    },
    { prefix: "/api/speedtest" }
  );

  await app.ready();
  return app;
};

const mockSpeedTestResult: SpeedTestResult = {
  timestamp: new Date("2024-01-15T10:00:00Z"),
  downloadSpeed: 100.5,
  uploadSpeed: 50.25,
  latency: 15.5,
  jitter: 2.1,
  serverId: "12345",
  serverName: "Test Server",
  serverLocation: "Test City",
  serverCountry: "Test Country",
  isp: "Test ISP",
  externalIp: "1.2.3.4",
  internalIp: "192.168.1.100",
};

// Helper to create a mock QuestDBService with tracking for writeMetric calls
interface MockMetricCall {
  timestamp: Date;
  source: "ping" | "speedtest";
  latency?: number;
  jitter?: number;
  downloadBandwidth?: number;
  uploadBandwidth?: number;
  serverLocation?: string;
  isp?: string;
  externalIp?: string;
  internalIp?: string;
}

const createMockDb = (
  writeMetricCalls: MockMetricCall[],
  writeMetricError?: {
    _tag: "DatabaseWriteError";
    message: string;
  }
): QuestDBService => ({
  health: () => Effect.succeed({ connected: true }),
  writeMetric: (metric) => {
    writeMetricCalls.push(metric as unknown as MockMetricCall);
    if (writeMetricError) {
      return Effect.fail(writeMetricError);
    }
    return Effect.void;
  },
  queryMetrics: () => Effect.succeed([]),
  queryConnectivityStatus: () => Effect.succeed([]),
  close: () => Effect.void,
});

describe("Speedtest Routes", () => {
  it("POST /api/speedtest/trigger returns 200 with speed test results", async () => {
    const writeMetricCalls: MockMetricCall[] = [];
    const db = createMockDb(writeMetricCalls);

    const speedTestService: SpeedTestServiceInterface = {
      runTest: () => Effect.succeed(mockSpeedTestResult),
    };

    const context: AppContext = {
      db,
      pingExecutor: {} as AppContext["pingExecutor"],
      speedTestService,
      networkMonitor: {} as AppContext["networkMonitor"],
      config: {} as AppContext["config"],
    };

    const app = await createTestApp(context);

    const response = await app.inject({
      method: "POST",
      url: "/api/speedtest/trigger",
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.result).toBeDefined();
    expect(body.result.downloadMbps).toBe(100.5);
    expect(body.result.uploadMbps).toBe(50.25);
    expect(body.result.pingMs).toBe(15.5);
    expect(body.result.jitter).toBe(2.1);
    expect(body.result.server).toBe("Test City");
    expect(body.result.isp).toBe("Test ISP");
    expect(body.result.externalIp).toBe("1.2.3.4");
    // Verify timestamp comes from the result, not new Date()
    expect(body.timestamp).toBe("2024-01-15T10:00:00.000Z");
  });

  it("POST /api/speedtest/trigger writes result to database with correct bandwidth conversion", async () => {
    const writeMetricCalls: MockMetricCall[] = [];
    const db = createMockDb(writeMetricCalls);

    const speedTestService: SpeedTestServiceInterface = {
      runTest: () => Effect.succeed(mockSpeedTestResult),
    };

    const context: AppContext = {
      db,
      pingExecutor: {} as AppContext["pingExecutor"],
      speedTestService,
      networkMonitor: {} as AppContext["networkMonitor"],
      config: {} as AppContext["config"],
    };

    const app = await createTestApp(context);

    await app.inject({
      method: "POST",
      url: "/api/speedtest/trigger",
      payload: {},
    });

    expect(writeMetricCalls.length).toBe(1);
    const metricArg = writeMetricCalls[0];
    expect(metricArg.source).toBe("speedtest");
    expect(metricArg.latency).toBe(15.5);
    expect(metricArg.jitter).toBe(2.1);
    // Verify mbpsToBps conversion is applied correctly
    expect(metricArg.downloadBandwidth).toBe(mbpsToBps(100.5));
    expect(metricArg.uploadBandwidth).toBe(mbpsToBps(50.25));
    expect(metricArg.serverLocation).toBe("Test City");
    expect(metricArg.isp).toBe("Test ISP");
    expect(metricArg.externalIp).toBe("1.2.3.4");
    expect(metricArg.internalIp).toBe("192.168.1.100");
  });

  it("POST /api/speedtest/trigger returns 500 with structured error when speed test fails", async () => {
    const writeMetricCalls: MockMetricCall[] = [];
    const db = createMockDb(writeMetricCalls);

    const speedTestService: SpeedTestServiceInterface = {
      runTest: () =>
        Effect.fail(new SpeedTestExecutionError("Network connection failed")),
    };

    const context: AppContext = {
      db,
      pingExecutor: {} as AppContext["pingExecutor"],
      speedTestService,
      networkMonitor: {} as AppContext["networkMonitor"],
      config: {} as AppContext["config"],
    };

    const app = await createTestApp(context);

    const response = await app.inject({
      method: "POST",
      url: "/api/speedtest/trigger",
      payload: {},
    });

    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body.success).toBe(false);
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe(SpeedTestErrorCode.EXECUTION_FAILED);
    expect(body.error.message).toBe("Network connection failed");
    expect(body.timestamp).toBeDefined();
  });

  it("POST /api/speedtest/trigger returns timeout error code for timeout failures", async () => {
    const writeMetricCalls: MockMetricCall[] = [];
    const db = createMockDb(writeMetricCalls);

    const speedTestService: SpeedTestServiceInterface = {
      runTest: () => Effect.fail(new SpeedTestTimeoutError(120000)),
    };

    const context: AppContext = {
      db,
      pingExecutor: {} as AppContext["pingExecutor"],
      speedTestService,
      networkMonitor: {} as AppContext["networkMonitor"],
      config: {} as AppContext["config"],
    };

    const app = await createTestApp(context);

    const response = await app.inject({
      method: "POST",
      url: "/api/speedtest/trigger",
      payload: {},
    });

    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe(SpeedTestErrorCode.TIMEOUT);
    expect(body.error.message).toBe("Speed test timed out");
  });

  it("POST /api/speedtest/trigger still returns 200 even if DB write fails", async () => {
    const writeMetricCalls: MockMetricCall[] = [];
    const db = createMockDb(writeMetricCalls, {
      _tag: "DatabaseWriteError",
      message: "db write failed",
    });

    const speedTestService: SpeedTestServiceInterface = {
      runTest: () => Effect.succeed(mockSpeedTestResult),
    };

    const context: AppContext = {
      db,
      pingExecutor: {} as AppContext["pingExecutor"],
      speedTestService,
      networkMonitor: {} as AppContext["networkMonitor"],
      config: {} as AppContext["config"],
    };

    const app = await createTestApp(context);

    const response = await app.inject({
      method: "POST",
      url: "/api/speedtest/trigger",
      payload: {},
    });

    // Should still return 200 since the speed test itself succeeded
    // The DB write failure is caught and logged but doesn't fail the request
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.result).toBeDefined();
  });

  it("GET /api/speedtest/status returns current running status", async () => {
    const writeMetricCalls: MockMetricCall[] = [];
    const db = createMockDb(writeMetricCalls);

    const speedTestService: SpeedTestServiceInterface = {
      runTest: () => Effect.succeed(mockSpeedTestResult),
    };

    const context: AppContext = {
      db,
      pingExecutor: {} as AppContext["pingExecutor"],
      speedTestService,
      networkMonitor: {} as AppContext["networkMonitor"],
      config: {} as AppContext["config"],
    };

    const app = await createTestApp(context);

    const response = await app.inject({
      method: "GET",
      url: "/api/speedtest/status",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.isRunning).toBe(false);
  });
});

describe("Speedtest Routes - Concurrency Guard", () => {
  it("POST /api/speedtest/trigger returns 409 when speed test is already running", async () => {
    const writeMetricCalls: MockMetricCall[] = [];
    const db = createMockDb(writeMetricCalls);

    // Create a slow speed test service that takes time to complete
    let resolveSpeedTest: ((value: SpeedTestResult) => void) | null = null;
    const speedTestService: SpeedTestServiceInterface = {
      runTest: () =>
        Effect.tryPromise({
          try: () =>
            new Promise<SpeedTestResult>((resolve) => {
              resolveSpeedTest = resolve;
            }),
          catch: () => new SpeedTestExecutionError("Failed"),
        }),
    };

    const context: AppContext = {
      db,
      pingExecutor: {} as AppContext["pingExecutor"],
      speedTestService,
      networkMonitor: {} as AppContext["networkMonitor"],
      config: {} as AppContext["config"],
    };

    const app = await createTestApp(context);

    // Start first speed test (don't await - let it hang)
    const firstRequest = app.inject({
      method: "POST",
      url: "/api/speedtest/trigger",
      payload: {},
    });

    // Wait a tick for the first request to set the mutex
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Try to start second speed test - should be rejected
    const secondResponse = await app.inject({
      method: "POST",
      url: "/api/speedtest/trigger",
      payload: {},
    });

    expect(secondResponse.statusCode).toBe(409);
    const body = secondResponse.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe(SpeedTestErrorCode.ALREADY_RUNNING);
    expect(body.error.message).toContain("already in progress");

    // Clean up - resolve the first request
    // Type assertion needed because TS narrows incorrectly after closure assignment
    (resolveSpeedTest as ((value: SpeedTestResult) => void) | null)?.(
      mockSpeedTestResult
    );
    await firstRequest;
  });

  it("Mutex is released after speed test completes successfully", async () => {
    const writeMetricCalls: MockMetricCall[] = [];
    const db = createMockDb(writeMetricCalls);

    const speedTestService: SpeedTestServiceInterface = {
      runTest: () => Effect.succeed(mockSpeedTestResult),
    };

    const context: AppContext = {
      db,
      pingExecutor: {} as AppContext["pingExecutor"],
      speedTestService,
      networkMonitor: {} as AppContext["networkMonitor"],
      config: {} as AppContext["config"],
    };

    const app = await createTestApp(context);

    // First request should succeed
    const firstResponse = await app.inject({
      method: "POST",
      url: "/api/speedtest/trigger",
      payload: {},
    });
    expect(firstResponse.statusCode).toBe(200);

    // Second request should also succeed (mutex released)
    const secondResponse = await app.inject({
      method: "POST",
      url: "/api/speedtest/trigger",
      payload: {},
    });
    expect(secondResponse.statusCode).toBe(200);
  });

  it("Mutex is released after speed test fails", async () => {
    const writeMetricCalls: MockMetricCall[] = [];
    const db = createMockDb(writeMetricCalls);

    let callCount = 0;
    const speedTestService: SpeedTestServiceInterface = {
      runTest: () => {
        callCount++;
        if (callCount === 1) {
          return Effect.fail(new SpeedTestExecutionError("First call fails"));
        }
        return Effect.succeed(mockSpeedTestResult);
      },
    };

    const context: AppContext = {
      db,
      pingExecutor: {} as AppContext["pingExecutor"],
      speedTestService,
      networkMonitor: {} as AppContext["networkMonitor"],
      config: {} as AppContext["config"],
    };

    const app = await createTestApp(context);

    // First request fails
    const firstResponse = await app.inject({
      method: "POST",
      url: "/api/speedtest/trigger",
      payload: {},
    });
    expect(firstResponse.statusCode).toBe(500);

    // Second request should succeed (mutex released after failure)
    const secondResponse = await app.inject({
      method: "POST",
      url: "/api/speedtest/trigger",
      payload: {},
    });
    expect(secondResponse.statusCode).toBe(200);
  });
});
