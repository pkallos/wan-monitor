import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { QuestDBService } from "@/database/questdb";
import { DbUnavailable } from "@/database/questdb";
import { createApp } from "@/server/app";
import { metricsRoutes } from "@/server/routes/metrics";
import type { AppContext } from "@/server/types";

const createTestApp = async (context: AppContext) => {
  const app = createApp({ jwtSecret: "test-secret", authRequired: false });

  await app.register(
    async (instance) => {
      await metricsRoutes(instance, context);
    },
    { prefix: "/api/metrics" }
  );

  await app.ready();
  return app;
};

describe("Metrics Routes", () => {
  it("should return metrics data", async () => {
    const mockMetrics = [
      {
        timestamp: "2024-01-01T12:00:00.000Z",
        source: "ping" as const,
        host: "8.8.8.8",
        latency: 15.5,
        jitter: 2.1,
        packet_loss: 0,
      },
      {
        timestamp: "2024-01-01T12:01:00.000Z",
        source: "speedtest" as const,
        latency: 20.3,
        jitter: 3.5,
        download_speed: 100,
        upload_speed: 50,
      },
    ];

    const db: QuestDBService = {
      health: () => Effect.succeed({ connected: true }),
      writeMetric: () => Effect.void,
      queryMetrics: () => Effect.succeed(mockMetrics),
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
      url: "/api/metrics/",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data).toHaveLength(2);
    expect(body.meta.count).toBe(2);
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
      url: "/api/metrics/?startTime=2024-01-01T00:00:00Z&endTime=2024-01-02T00:00:00Z&host=8.8.8.8&limit=100&granularity=1m",
    });

    expect(response.statusCode).toBe(200);
  });

  it("should filter by host", async () => {
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
      url: "/api/metrics/?host=1.1.1.1",
    });

    expect(response.statusCode).toBe(200);
  });

  it("should apply limit parameter", async () => {
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
      url: "/api/metrics/?limit=50",
    });

    expect(response.statusCode).toBe(200);
  });

  it("should return 503 when database is unavailable", async () => {
    const db: QuestDBService = {
      health: () => Effect.succeed({ connected: true }),
      writeMetric: () => Effect.void,
      queryMetrics: () => Effect.fail(new DbUnavailable("DB down")),
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
      url: "/api/metrics/",
    });

    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.error).toBe("DB_UNAVAILABLE");
  });

  it("should return 500 for other errors", async () => {
    const db: QuestDBService = {
      health: () => Effect.succeed({ connected: true }),
      writeMetric: () => Effect.void,
      queryMetrics: () =>
        Effect.fail({ _tag: "DatabaseQueryError", message: "Query failed" }),
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
      url: "/api/metrics/",
    });

    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body.error).toBe("Failed to query metrics");
  });
});
