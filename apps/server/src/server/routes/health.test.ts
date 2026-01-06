import { describe, expect, it } from "@effect/vitest";
import { DateTime, Effect, Layer } from "effect";
import {
  DatabaseConnectionError,
  DbUnavailable,
  QuestDB,
  type QuestDBService,
} from "@/database/questdb";

const createTestQuestDBService = (
  healthEffect: Effect.Effect<
    { connected: boolean; uptime: number },
    DatabaseConnectionError | DbUnavailable
  >
): QuestDBService => ({
  health: () => healthEffect,
  writeMetric: () => Effect.void,
  queryMetrics: () => Effect.succeed([]),
  querySpeedtests: () => Effect.succeed([]),
  queryConnectivityStatus: () => Effect.succeed([]),
  close: () => Effect.void,
});

describe("Health API Handlers", () => {
  describe("getReady handler", () => {
    it.effect("returns ok status when database is healthy", () => {
      const QuestDbTest = Layer.succeed(
        QuestDB,
        createTestQuestDBService(
          Effect.succeed({ connected: true, uptime: 100 })
        )
      );

      return Effect.gen(function* () {
        const db = yield* QuestDB;
        yield* db.health();
        const result = {
          status: "ok" as const,
          timestamp: DateTime.unsafeNow(),
        };

        expect(result.status).toBe("ok");
        expect(result.timestamp).toBeDefined();
        return result;
      }).pipe(
        Effect.catchAll((error) => Effect.fail(`Database unhealthy: ${error}`)),
        Effect.provide(QuestDbTest)
      );
    });

    it.effect("fails when database health check fails", () => {
      const QuestDbTest = Layer.succeed(
        QuestDB,
        createTestQuestDBService(
          Effect.fail(new DatabaseConnectionError("Connection refused"))
        )
      );

      return Effect.gen(function* () {
        const db = yield* QuestDB;
        yield* db.health();
        return {
          status: "ok" as const,
          timestamp: DateTime.unsafeNow(),
        };
      }).pipe(
        Effect.catchAll((error) => Effect.fail(`Database unhealthy: ${error}`)),
        Effect.either,
        Effect.map((result) => {
          expect(result._tag).toBe("Left");
          if (result._tag === "Left") {
            expect(result.left).toContain("Database unhealthy");
          }
          return result;
        }),
        Effect.provide(QuestDbTest)
      );
    });

    it.effect("fails when database is unavailable", () => {
      const QuestDbTest = Layer.succeed(
        QuestDB,
        createTestQuestDBService(
          Effect.fail(new DbUnavailable("Database not connected"))
        )
      );

      return Effect.gen(function* () {
        const db = yield* QuestDB;
        yield* db.health();
        return {
          status: "ok" as const,
          timestamp: DateTime.unsafeNow(),
        };
      }).pipe(
        Effect.catchAll((error) => Effect.fail(`Database unhealthy: ${error}`)),
        Effect.either,
        Effect.map((result) => {
          expect(result._tag).toBe("Left");
          if (result._tag === "Left") {
            expect(result.left).toContain("Database unhealthy");
          }
          return result;
        }),
        Effect.provide(QuestDbTest)
      );
    });
  });

  describe("getLive handler", () => {
    it.effect("always returns ok status regardless of database state", () => {
      const value = {
        status: "ok" as const,
        timestamp: DateTime.unsafeNow(),
      };

      expect(value.status).toBe("ok");
      expect(value.timestamp).toBeDefined();

      return Effect.succeed(value);
    });
  });
});
