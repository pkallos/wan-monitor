import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { QuestDBService } from "@/database/questdb";
import { DbUnavailable } from "@/database/questdb";
import { createApp } from "@/server/app";
import { connectivityStatusRoutes } from "@/server/routes/connectivity-status";
import type { AppContext } from "@/server/types";

const createTestApp = async (context: AppContext) => {
  const app = createApp({ jwtSecret: "test-secret", authRequired: false });

  await app.register(
    async (instance) => {
      await connectivityStatusRoutes(instance, context);
    },
    { prefix: "/api/connectivity-status" }
  );

  await app.ready();
  return app;
};

describe("Connectivity Status Routes", () => {
  it("should return connectivity status data", async () => {
    const mockRows = [
      {
        timestamp: "2024-01-01T12:00:00.000Z",
        up_count: 45,
        down_count: 3,
        degraded_count: 2,
        total_count: 50,
      },
      {
        timestamp: "2024-01-01T12:05:00.000Z",
        up_count: 48,
        down_count: 0,
        degraded_count: 2,
        total_count: 50,
      },
    ];

    const db: QuestDBService = {
      health: () => Effect.succeed({ connected: true }),
      writeMetric: () => Effect.void,
      queryMetrics: () => Effect.succeed([]),
      querySpeedtests: () => Effect.succeed([]),
      queryConnectivityStatus: () => Effect.succeed(mockRows),
      close: () => Effect.void,
    };

    const context: AppContext = {
      db,
      pingExecutor: {} as AppContext["pingExecutor"],
      speedTestService: {} as AppContext["speedTestService"],
      networkMonitor: {} as AppContext["networkMonitor"],
      config: {} as AppContext["config"],
    };

    const app = await createTestApp(context);

    const response = await app.inject({
      method: "GET",
      url: "/api/connectivity-status/",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data).toHaveLength(2);
    expect(body.data[0].status).toBe("down");
    expect(body.data[1].status).toBe("degraded");
    expect(body.meta.uptimePercentage).toBeCloseTo(93, 0);
  });

  it("should handle down status correctly", async () => {
    const mockRows = [
      {
        timestamp: "2024-01-01T12:00:00.000Z",
        up_count: 0,
        down_count: 50,
        degraded_count: 0,
        total_count: 50,
      },
    ];

    const db: QuestDBService = {
      health: () => Effect.succeed({ connected: true }),
      writeMetric: () => Effect.void,
      queryMetrics: () => Effect.succeed([]),
      querySpeedtests: () => Effect.succeed([]),
      queryConnectivityStatus: () => Effect.succeed(mockRows),
      close: () => Effect.void,
    };

    const context: AppContext = {
      db,
      pingExecutor: {} as AppContext["pingExecutor"],
      speedTestService: {} as AppContext["speedTestService"],
      networkMonitor: {} as AppContext["networkMonitor"],
      config: {} as AppContext["config"],
    };

    const app = await createTestApp(context);

    const response = await app.inject({
      method: "GET",
      url: "/api/connectivity-status/",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data[0].status).toBe("down");
    expect(body.data[0].downPercentage).toBe(100);
    expect(body.meta.uptimePercentage).toBe(0);
  });

  it("should handle up status correctly", async () => {
    const mockRows = [
      {
        timestamp: "2024-01-01T12:00:00.000Z",
        up_count: 50,
        down_count: 0,
        degraded_count: 0,
        total_count: 50,
      },
    ];

    const db: QuestDBService = {
      health: () => Effect.succeed({ connected: true }),
      writeMetric: () => Effect.void,
      queryMetrics: () => Effect.succeed([]),
      querySpeedtests: () => Effect.succeed([]),
      queryConnectivityStatus: () => Effect.succeed(mockRows),
      close: () => Effect.void,
    };

    const context: AppContext = {
      db,
      pingExecutor: {} as AppContext["pingExecutor"],
      speedTestService: {} as AppContext["speedTestService"],
      networkMonitor: {} as AppContext["networkMonitor"],
      config: {} as AppContext["config"],
    };

    const app = await createTestApp(context);

    const response = await app.inject({
      method: "GET",
      url: "/api/connectivity-status/",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data[0].status).toBe("up");
    expect(body.data[0].upPercentage).toBe(100);
    expect(body.meta.uptimePercentage).toBe(100);
  });

  it("should accept query parameters", async () => {
    const db: QuestDBService = {
      health: () => Effect.succeed({ connected: true }),
      writeMetric: () => Effect.void,
      queryMetrics: () => Effect.succeed([]),
      querySpeedtests: () => Effect.succeed([]),
      queryConnectivityStatus: () => Effect.succeed([]),
      close: () => Effect.void,
    };

    const context: AppContext = {
      db,
      pingExecutor: {} as AppContext["pingExecutor"],
      speedTestService: {} as AppContext["speedTestService"],
      networkMonitor: {} as AppContext["networkMonitor"],
      config: {} as AppContext["config"],
    };

    const app = await createTestApp(context);

    const response = await app.inject({
      method: "GET",
      url: "/api/connectivity-status/?startTime=2024-01-01T00:00:00Z&endTime=2024-01-02T00:00:00Z&granularity=1m",
    });

    expect(response.statusCode).toBe(200);
  });

  it("should return 503 when database is unavailable", async () => {
    const db: QuestDBService = {
      health: () => Effect.succeed({ connected: true }),
      writeMetric: () => Effect.void,
      queryMetrics: () => Effect.succeed([]),
      querySpeedtests: () => Effect.succeed([]),
      queryConnectivityStatus: () => Effect.fail(new DbUnavailable("DB down")),
      close: () => Effect.void,
    };

    const context: AppContext = {
      db,
      pingExecutor: {} as AppContext["pingExecutor"],
      speedTestService: {} as AppContext["speedTestService"],
      networkMonitor: {} as AppContext["networkMonitor"],
      config: {} as AppContext["config"],
    };

    const app = await createTestApp(context);

    const response = await app.inject({
      method: "GET",
      url: "/api/connectivity-status/",
    });

    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.error).toBe("DB_UNAVAILABLE");
  });

  it("should return 500 for other errors", async () => {
    const db: QuestDBService = {
      health: () => Effect.succeed({ connected: true }),
      writeMetric: () => Effect.void,
      queryMetrics: () => Effect.succeed([]),
      querySpeedtests: () => Effect.succeed([]),
      queryConnectivityStatus: () =>
        Effect.fail({ _tag: "DatabaseQueryError", message: "Query failed" }),
      close: () => Effect.void,
    };

    const context: AppContext = {
      db,
      pingExecutor: {} as AppContext["pingExecutor"],
      speedTestService: {} as AppContext["speedTestService"],
      networkMonitor: {} as AppContext["networkMonitor"],
      config: {} as AppContext["config"],
    };

    const app = await createTestApp(context);

    const response = await app.inject({
      method: "GET",
      url: "/api/connectivity-status/",
    });

    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body.error).toBe("Failed to query connectivity status");
  });
});
