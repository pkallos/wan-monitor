import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { QuestDBService } from "@/database/questdb";
import { DbUnavailable } from "@/database/questdb";
import { createApp } from "@/server/app";
import { healthRoutes } from "@/server/routes/health";
import type { AppContext } from "@/server/types";

const createTestApp = async (context: AppContext) => {
  const app = createApp({ jwtSecret: "test-secret", authRequired: false });

  await app.register(
    async (instance) => {
      await healthRoutes(instance, context);
    },
    { prefix: "/api" }
  );

  await app.ready();
  return app;
};

describe("Health Routes", () => {
  it("/api/live returns 200 even when DB health fails", async () => {
    const db: QuestDBService = {
      health: () =>
        Effect.fail({
          _tag: "DatabaseConnectionError",
          message: "db down",
        } as const),
      writeMetric: () => Effect.void,
      queryMetrics: () => Effect.succeed([]),
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
      url: "/api/live",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("alive");
  });

  it("/api/ready returns 503 when DB health fails", async () => {
    const db: QuestDBService = {
      health: () =>
        Effect.fail({
          _tag: "DatabaseConnectionError",
          message: "db down",
        } as const),
      writeMetric: () => Effect.void,
      queryMetrics: () => Effect.succeed([]),
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
      url: "/api/ready",
    });

    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.status).toBe("unhealthy");
  });

  it("/api/ready returns DB_UNAVAILABLE when DB is unavailable", async () => {
    const db: QuestDBService = {
      health: () => Effect.fail(new DbUnavailable("db unavailable")),
      writeMetric: () => Effect.void,
      queryMetrics: () => Effect.succeed([]),
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
      url: "/api/ready",
    });

    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.status).toBe("unhealthy");
    expect(body.error).toBe("DB_UNAVAILABLE");
  });

  it("/api/health matches readiness behavior", async () => {
    const db: QuestDBService = {
      health: () =>
        Effect.fail({
          _tag: "DatabaseConnectionError",
          message: "db down",
        } as const),
      writeMetric: () => Effect.void,
      queryMetrics: () => Effect.succeed([]),
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
      url: "/api/health",
    });

    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.status).toBe("unhealthy");
  });
});
