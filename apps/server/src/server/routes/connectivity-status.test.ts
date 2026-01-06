import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
  type ConnectivityStatusRow,
  DatabaseQueryError,
  DbUnavailable,
  QuestDB,
  type QuestDBService,
} from "@/database/questdb";

const createTestQuestDBService = (
  queryEffect: Effect.Effect<
    readonly ConnectivityStatusRow[],
    DatabaseQueryError | DbUnavailable
  >
): QuestDBService => ({
  queryConnectivityStatus: () => queryEffect,
  health: () => Effect.succeed({ connected: true, uptime: 100 }),
  writeMetric: () => Effect.void,
  queryMetrics: () => Effect.succeed([]),
  querySpeedtests: () => Effect.succeed([]),
  close: () => Effect.void,
});

describe("Connectivity Status API Handlers", () => {
  describe("getConnectivityStatus handler", () => {
    it.effect("returns connectivity status with correct percentages", () => {
      const mockRows: readonly ConnectivityStatusRow[] = [
        {
          timestamp: "2024-01-01T00:00:00Z",
          up_count: 90,
          down_count: 5,
          degraded_count: 5,
          total_count: 100,
        },
        {
          timestamp: "2024-01-01T01:00:00Z",
          up_count: 95,
          down_count: 0,
          degraded_count: 5,
          total_count: 100,
        },
      ];

      const QuestDbTest = Layer.succeed(
        QuestDB,
        createTestQuestDBService(Effect.succeed(mockRows))
      );

      return Effect.gen(function* () {
        const db = yield* QuestDB;
        const rows = yield* db.queryConnectivityStatus({
          granularity: "5m",
        });

        const data = rows.map((row) => {
          const total = row.total_count || 1;
          return {
            timestamp: row.timestamp,
            status:
              row.down_count > 0
                ? ("down" as const)
                : row.degraded_count > 0
                  ? ("degraded" as const)
                  : ("up" as const),
            upPercentage: (row.up_count / total) * 100,
            downPercentage: (row.down_count / total) * 100,
            degradedPercentage: (row.degraded_count / total) * 100,
          };
        });

        expect(data).toHaveLength(2);
        expect(data[0].status).toBe("down");
        expect(data[0].upPercentage).toBe(90);
        expect(data[0].downPercentage).toBe(5);
        expect(data[0].degradedPercentage).toBe(5);
        expect(data[1].status).toBe("degraded");
        expect(data[1].upPercentage).toBe(95);
        expect(data[1].downPercentage).toBe(0);

        return data;
      }).pipe(Effect.provide(QuestDbTest));
    });

    it.effect("calculates overall uptime percentage correctly", () => {
      const mockRows: readonly ConnectivityStatusRow[] = [
        {
          timestamp: "2024-01-01T00:00:00Z",
          up_count: 80,
          down_count: 20,
          degraded_count: 0,
          total_count: 100,
        },
        {
          timestamp: "2024-01-01T01:00:00Z",
          up_count: 100,
          down_count: 0,
          degraded_count: 0,
          total_count: 100,
        },
      ];

      const QuestDbTest = Layer.succeed(
        QuestDB,
        createTestQuestDBService(Effect.succeed(mockRows))
      );

      return Effect.gen(function* () {
        const db = yield* QuestDB;
        const rows = yield* db.queryConnectivityStatus({
          granularity: "5m",
        });

        const totalPoints = rows.reduce((sum, row) => sum + row.total_count, 0);
        const totalUpPoints = rows.reduce((sum, row) => sum + row.up_count, 0);
        const uptimePercentage =
          totalPoints > 0 ? (totalUpPoints / totalPoints) * 100 : 0;

        expect(totalPoints).toBe(200);
        expect(totalUpPoints).toBe(180);
        expect(uptimePercentage).toBe(90);

        return uptimePercentage;
      }).pipe(Effect.provide(QuestDbTest));
    });

    it.effect("handles empty result set", () => {
      const QuestDbTest = Layer.succeed(
        QuestDB,
        createTestQuestDBService(Effect.succeed([]))
      );

      return Effect.gen(function* () {
        const db = yield* QuestDB;
        const rows = yield* db.queryConnectivityStatus({
          granularity: "5m",
        });

        expect(rows).toHaveLength(0);

        const totalPoints = rows.reduce((sum, row) => sum + row.total_count, 0);
        const totalUpPoints = rows.reduce((sum, row) => sum + row.up_count, 0);
        const uptimePercentage =
          totalPoints > 0 ? (totalUpPoints / totalPoints) * 100 : 0;

        expect(uptimePercentage).toBe(0);

        return rows;
      }).pipe(Effect.provide(QuestDbTest));
    });

    it.effect("determines status as 'up' when no down or degraded", () => {
      const mockRows: readonly ConnectivityStatusRow[] = [
        {
          timestamp: "2024-01-01T00:00:00Z",
          up_count: 100,
          down_count: 0,
          degraded_count: 0,
          total_count: 100,
        },
      ];

      const QuestDbTest = Layer.succeed(
        QuestDB,
        createTestQuestDBService(Effect.succeed(mockRows))
      );

      return Effect.gen(function* () {
        const db = yield* QuestDB;
        const rows = yield* db.queryConnectivityStatus({
          granularity: "5m",
        });

        const data = rows.map((row) => {
          const total = row.total_count || 1;
          return {
            status:
              row.down_count > 0
                ? ("down" as const)
                : row.degraded_count > 0
                  ? ("degraded" as const)
                  : ("up" as const),
            upPercentage: (row.up_count / total) * 100,
          };
        });

        expect(data[0].status).toBe("up");
        expect(data[0].upPercentage).toBe(100);

        return data;
      }).pipe(Effect.provide(QuestDbTest));
    });

    it.effect("prioritizes 'down' status over 'degraded'", () => {
      const mockRows: readonly ConnectivityStatusRow[] = [
        {
          timestamp: "2024-01-01T00:00:00Z",
          up_count: 80,
          down_count: 10,
          degraded_count: 10,
          total_count: 100,
        },
      ];

      const QuestDbTest = Layer.succeed(
        QuestDB,
        createTestQuestDBService(Effect.succeed(mockRows))
      );

      return Effect.gen(function* () {
        const db = yield* QuestDB;
        const rows = yield* db.queryConnectivityStatus({
          granularity: "5m",
        });

        const data = rows.map((row) => ({
          status:
            row.down_count > 0
              ? ("down" as const)
              : row.degraded_count > 0
                ? ("degraded" as const)
                : ("up" as const),
        }));

        expect(data[0].status).toBe("down");

        return data;
      }).pipe(Effect.provide(QuestDbTest));
    });

    it.effect("handles database query error", () => {
      const QuestDbTest = Layer.succeed(
        QuestDB,
        createTestQuestDBService(
          Effect.fail(new DatabaseQueryError("Query failed"))
        )
      );

      return Effect.gen(function* () {
        const db = yield* QuestDB;
        yield* db.queryConnectivityStatus({
          granularity: "5m",
        });
        return "should not reach here";
      }).pipe(
        Effect.catchAll((error) =>
          Effect.fail(`Failed to query connectivity status: ${error}`)
        ),
        Effect.either,
        Effect.map((result) => {
          expect(result._tag).toBe("Left");
          if (result._tag === "Left") {
            expect(result.left).toContain(
              "Failed to query connectivity status"
            );
          }
          return result;
        }),
        Effect.provide(QuestDbTest)
      );
    });

    it.effect("handles database unavailable error", () => {
      const QuestDbTest = Layer.succeed(
        QuestDB,
        createTestQuestDBService(
          Effect.fail(new DbUnavailable("Database not connected"))
        )
      );

      return Effect.gen(function* () {
        const db = yield* QuestDB;
        yield* db.queryConnectivityStatus({
          granularity: "5m",
        });
        return "should not reach here";
      }).pipe(
        Effect.catchAll((error) =>
          Effect.fail(`Failed to query connectivity status: ${error}`)
        ),
        Effect.either,
        Effect.map((result) => {
          expect(result._tag).toBe("Left");
          if (result._tag === "Left") {
            expect(result.left).toContain(
              "Failed to query connectivity status"
            );
          }
          return result;
        }),
        Effect.provide(QuestDbTest)
      );
    });

    it.effect("handles division by zero with total_count of 0", () => {
      const mockRows: readonly ConnectivityStatusRow[] = [
        {
          timestamp: "2024-01-01T00:00:00Z",
          up_count: 0,
          down_count: 0,
          degraded_count: 0,
          total_count: 0,
        },
      ];

      const QuestDbTest = Layer.succeed(
        QuestDB,
        createTestQuestDBService(Effect.succeed(mockRows))
      );

      return Effect.gen(function* () {
        const db = yield* QuestDB;
        const rows = yield* db.queryConnectivityStatus({
          granularity: "5m",
        });

        const data = rows.map((row) => {
          const total = row.total_count || 1;
          return {
            upPercentage: (row.up_count / total) * 100,
            downPercentage: (row.down_count / total) * 100,
            degradedPercentage: (row.degraded_count / total) * 100,
          };
        });

        expect(data[0].upPercentage).toBe(0);
        expect(data[0].downPercentage).toBe(0);
        expect(data[0].degradedPercentage).toBe(0);

        return data;
      }).pipe(Effect.provide(QuestDbTest));
    });
  });
});
