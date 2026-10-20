import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { QuestDB, QuestDBLive } from "@/infrastructure/database/questdb";
import { seedDatabase } from "@/infrastructure/database/questdb/test-utils/seed";
import {
  createTestLayer,
  isQuestDBAvailable,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "@/infrastructure/database/questdb/test-utils/setup";
import { makeTestConfigLayer } from "@/test/config";

describe("QuestDB Integration", () => {
  const skipTests = !isQuestDBAvailable();

  it.skipIf(skipTests)(
    "should connect to QuestDB and pass health check",
    async () => {
      const program = Effect.gen(function* () {
        const db = yield* setupIntegrationTest();
        return yield* db.health();
      });

      const result = await Effect.runPromise(
        Effect.provide(program, createTestLayer())
      );

      expect(result.connected).toBe(true);
      expect(result.uptime).toBeGreaterThanOrEqual(0);
    }
  );

  it.skipIf(skipTests)(
    "should write a metric that QuestDB then returns",
    async () => {
      const timestamp = new Date("2024-01-15T18:00:00Z");
      const program = Effect.gen(function* () {
        const db = yield* setupIntegrationTest();
        yield* seedDatabase(db, [
          {
            timestamp,
            source: "ping",
            host: "8.8.8.8",
            latency: 25.5,
            packetLoss: 0,
            connectivityStatus: "up",
          },
        ]);

        const metrics = yield* db.queryMetrics({
          startTime: new Date(timestamp.getTime() - 60_000),
          endTime: new Date(timestamp.getTime() + 60_000),
        });
        yield* teardownIntegrationTest(db);
        return metrics;
      });

      const metrics = await Effect.runPromise(
        Effect.provide(program, createTestLayer())
      );

      expect(metrics).toHaveLength(1);
      expect(metrics[0]).toMatchObject({
        source: "ping",
        host: "8.8.8.8",
        latency: 25.5,
        packet_loss: 0,
        connectivity_status: "up",
      });
    }
  );

  it.skipIf(skipTests)(
    "should fail health check when database is unreachable",
    async () => {
      const BadConfigLive = makeTestConfigLayer({
        database: { host: "nonexistent-host" },
        ping: { hosts: ["8.8.8.8", "1.1.1.1"] },
        auth: { password: "testpassword" },
      });

      const MainLive = Layer.provide(QuestDBLive, BadConfigLive);

      const program = Effect.gen(function* () {
        const db = yield* QuestDB;
        yield* db.health();
      });

      await expect(
        Effect.runPromise(Effect.provide(program, MainLive))
      ).rejects.toThrow();
    }
  );
});
