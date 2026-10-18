import { createServer } from "node:net";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { Client } from "pg";
import { vi } from "vitest";
import {
  MIGRATION_STATEMENT_TIMEOUT_MS,
  migrationClientConfig,
  pgMigrationContext,
  SchemaMigrator,
  SchemaMigratorLive,
} from "@/infrastructure/database/questdb/migrations/service";
import { makeTestConfigLayer } from "@/test/config";

const stubbedClient = (query: Client["query"]): Client =>
  Object.assign(new Client(), { query });

const unusedPort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" ? address?.port : undefined;
      server.close(() =>
        port === undefined ? reject(new Error("no port")) : resolve(port)
      );
    });
  });

describe("migrationClientConfig", () => {
  it("raises QuestDB's statement timeout to 30 minutes for the session", () => {
    expect(MIGRATION_STATEMENT_TIMEOUT_MS).toBe(1_800_000);
    expect(
      migrationClientConfig({ host: "questdb", pgPort: 5432 })
    ).toMatchObject({
      host: "questdb",
      port: 5432,
      database: "qdb",
      options: "-c statement_timeout=1800000",
      query_timeout: 1_800_000,
    });
  });
});

describe("pgMigrationContext", () => {
  it.effect("returns the rows of a statement and passes its parameters", () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ v: 1 }] });
    const ctx = pgMigrationContext(stubbedClient(query), "metrics", true);

    return Effect.gen(function* () {
      const rows = yield* ctx.query("SELECT $1", [7]);

      expect(rows).toEqual([{ v: 1 }]);
      expect(query).toHaveBeenCalledWith("SELECT $1", [7]);
    });
  });

  it("carries the table and whether it may rewrite tables", () => {
    const client = stubbedClient(vi.fn());

    expect(pgMigrationContext(client, "metrics", true)).toMatchObject({
      table: "metrics",
      canRewriteTables: true,
    });
    expect(pgMigrationContext(client, "metrics", false).canRewriteTables).toBe(
      false
    );
  });

  it.effect("reports a rejected statement as a transient query failure", () => {
    const ctx = pgMigrationContext(
      stubbedClient(vi.fn().mockRejectedValue(new Error("disk full"))),
      "metrics",
      true
    );

    return Effect.gen(function* () {
      const error = yield* Effect.flip(ctx.query("INSERT INTO metrics"));

      expect(error.kind).toBe("transient");
      expect(error.step).toBe("query");
      expect(error.message).toBe("disk full");
    });
  });
});

describe("SchemaMigrator", () => {
  it.live(
    "reports an unreachable database as a transient connect failure",
    () =>
      Effect.gen(function* () {
        const pgPort = yield* Effect.promise(unusedPort);
        const migrator = yield* SchemaMigrator.pipe(
          Effect.provide(
            Layer.provide(
              SchemaMigratorLive,
              makeTestConfigLayer({ database: { host: "127.0.0.1", pgPort } })
            )
          )
        );

        const error = yield* Effect.flip(
          migrator.migrate({ canRewriteTables: true })
        );

        expect(error.kind).toBe("transient");
        expect(error.step).toBe("connect");
        expect(error.message).toContain("Could not connect to run migrations");
      })
  );
});
