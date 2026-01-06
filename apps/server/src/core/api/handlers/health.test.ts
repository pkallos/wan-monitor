import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { getLiveHandler, getReadyHandler } from "@/core/api/handlers/health";
import {
  QuestDB,
  type QuestDBService,
} from "@/infrastructure/database/questdb";
import { DatabaseConnectionError } from "@/infrastructure/database/questdb/errors";

const createMockQuestDB = (healthy: boolean): QuestDBService => ({
  health: () =>
    healthy
      ? Effect.succeed({ connected: true, version: "1.0.0", uptime: 100 })
      : Effect.fail(new DatabaseConnectionError("Database connection failed")),
  writeMetric: () => Effect.void,
  queryMetrics: () => Effect.succeed([]),
  querySpeedtests: () => Effect.succeed([]),
  queryConnectivityStatus: () => Effect.succeed([]),
  close: () => Effect.void,
});

describe("Health Handlers", () => {
  describe("getReady", () => {
    it.effect("returns ok status when database is healthy", () => {
      const QuestDBTest = Layer.succeed(QuestDB, createMockQuestDB(true));

      return Effect.gen(function* () {
        const result = yield* getReadyHandler();

        expect(result.status).toBe("ok");
        expect(result.timestamp).toBeDefined();
      }).pipe(Effect.provide(QuestDBTest));
    });

    it.effect("fails when database is unhealthy", () => {
      const QuestDBTest = Layer.succeed(QuestDB, createMockQuestDB(false));

      return Effect.gen(function* () {
        const result = yield* Effect.either(getReadyHandler());

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toContain("Database unhealthy");
        }
      }).pipe(Effect.provide(QuestDBTest));
    });
  });

  describe("getLive", () => {
    it.effect("always returns ok status", () => {
      return Effect.gen(function* () {
        const result = yield* getLiveHandler();

        expect(result.status).toBe("ok");
        expect(result.timestamp).toBeDefined();
      });
    });
  });
});
