import {
  buildCreateTableSql,
  NETWORK_METRICS_COLUMNS,
} from "@wan-monitor/shared/db-schema";
import { Effect } from "effect";
import { Client as PgClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bootstrapSchema,
  isDuplicateColumnError,
} from "@/infrastructure/database/questdb/bootstrap";
import { isQuestDBAvailable } from "@/infrastructure/database/questdb/test-utils/setup";
import { errorMessage } from "@/infrastructure/database/questdb/util";

/**
 * Forward/backward compatibility for the schema bootstrap, exercised against a
 * real QuestDB (integration mode). Verifies that:
 *  - a pre-existing table missing newer columns is migrated forward, with
 *    existing rows preserved (backward compatibility);
 *  - a table already at the canonical schema is left untouched and the
 *    migration is idempotent (forward compatibility);
 *  - a fresh (absent) table is created with the full canonical schema.
 */
const skip = !isQuestDBAvailable();

describe("QuestDB schema bootstrap — forward/backward compatibility", () => {
  let client: PgClient;

  beforeAll(async () => {
    if (skip) return;
    // Default to 8812 (the app's config.ts DB_PG_PORT default, also used by
    // CI's coverage job service container). Integration mode overrides this to
    // 8912 via DB_PG_PORT for the isolated test container.
    client = new PgClient({
      host: process.env.DB_HOST ?? "localhost",
      port: Number(process.env.DB_PG_PORT ?? 8812),
      database: "qdb",
      user: "admin",
      password: "quest",
    });
    await client.connect();
  });

  afterAll(async () => {
    if (skip) return;
    // Leave a clean canonical table so any following integration file starts
    // from a known-good state.
    await client.query("DROP TABLE IF EXISTS network_metrics");
    await client.query(buildCreateTableSql());
    await client.end();
  });

  const listColumns = async (): Promise<string[]> => {
    const result = await client.query(
      `SELECT "column" AS name FROM table_columns('network_metrics')`
    );
    return (result.rows as { name: string }[]).map((row) => row.name);
  };

  const rowCount = async (): Promise<number> => {
    const result = await client.query(
      "SELECT count() AS c FROM network_metrics"
    );
    return Number((result.rows[0] as { c: string | number }).c);
  };

  /** Poll until a predicate holds; WAL DDL/inserts commit asynchronously. */
  const waitFor = async (
    predicate: () => Promise<boolean>,
    timeoutMs = 15_000,
    intervalMs = 250
  ): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;
    while (Date.now() < deadline) {
      try {
        if (await predicate()) return;
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(
      `waitFor timed out: ${lastError ?? "predicate never true"}`
    );
  };

  const hasAllCanonicalColumns = async (): Promise<boolean> => {
    const columns = await listColumns();
    return NETWORK_METRICS_COLUMNS.every((c) => columns.includes(c.name));
  };

  it.skipIf(skip)(
    "migrates a pre-existing table missing speedtest columns and preserves existing rows (backward compat)",
    async () => {
      // Simulate a legacy table created before speedtest columns existed
      // (e.g. an instance that only ever wrote ping metrics via ILP).
      await client.query("DROP TABLE IF EXISTS network_metrics");
      await client.query(
        `CREATE TABLE network_metrics (
          timestamp TIMESTAMP,
          source SYMBOL,
          host SYMBOL,
          latency DOUBLE,
          jitter DOUBLE,
          packet_loss DOUBLE,
          connectivity_status STRING
        ) TIMESTAMP(timestamp) PARTITION BY DAY WAL;`
      );

      // Seed one legacy row so we can prove data survives the migration.
      await client.query(
        `INSERT INTO network_metrics (timestamp, source, host, latency, connectivity_status)
         VALUES ('2024-01-15T12:00:00.000000Z', 'ping', '8.8.8.8', 21.5, 'up')`
      );
      await waitFor(async () => (await rowCount()) === 1);

      // Run the migration against the legacy table.
      await Effect.runPromise(bootstrapSchema(client));

      // Every canonical column is now present (speedtest columns were added).
      await waitFor(hasAllCanonicalColumns);

      // The pre-existing row is preserved with its original values intact.
      const result = await client.query(
        `SELECT source, host, latency, connectivity_status FROM network_metrics`
      );
      expect(result.rows.length).toBe(1);
      const row = result.rows[0] as {
        source: string;
        host: string;
        latency: number;
        connectivity_status: string;
      };
      expect(row.source).toBe("ping");
      expect(row.host).toBe("8.8.8.8");
      expect(Number(row.latency)).toBeCloseTo(21.5);
      expect(row.connectivity_status).toBe("up");
    }
  );

  it.skipIf(skip)(
    "is idempotent and non-destructive when the table already matches the canonical schema (forward compat)",
    async () => {
      await client.query("DROP TABLE IF EXISTS network_metrics");
      await client.query(buildCreateTableSql());
      await client.query(
        `INSERT INTO network_metrics (timestamp, source, host, latency)
         VALUES ('2024-01-15T12:00:00.000000Z', 'ping', '1.1.1.1', 10)`
      );
      await waitFor(async () => (await rowCount()) === 1);

      const before = (await listColumns()).sort();

      // Run twice to prove idempotency.
      await Effect.runPromise(bootstrapSchema(client));
      await Effect.runPromise(bootstrapSchema(client));

      const after = (await listColumns()).sort();
      expect(after).toEqual(before);
      // Data is untouched by a no-op bootstrap.
      expect(await rowCount()).toBe(1);
    }
  );

  it.skipIf(skip)(
    "creates the full canonical schema on a fresh (absent) table",
    async () => {
      await client.query("DROP TABLE IF EXISTS network_metrics");

      await Effect.runPromise(bootstrapSchema(client));

      await waitFor(hasAllCanonicalColumns);
      const columns = await listColumns();
      for (const column of NETWORK_METRICS_COLUMNS) {
        expect(columns).toContain(column.name);
      }
    }
  );

  it.skipIf(skip)(
    "recognizes QuestDB's real duplicate-column error so the race hardening actually fires",
    async () => {
      // Guards against QuestDB changing its error wording: the race hardening is
      // only effective if isDuplicateColumnError() matches the real message.
      await client.query("DROP TABLE IF EXISTS network_metrics");
      await client.query(buildCreateTableSql());

      let caught: string | undefined;
      try {
        // `isp` already exists in the canonical schema; adding it again is
        // exactly the collision an ILP-vs-bootstrap race would produce.
        await client.query("ALTER TABLE network_metrics ADD COLUMN isp STRING");
      } catch (error) {
        caught = errorMessage(error);
      }

      expect(caught).toBeDefined();
      expect(isDuplicateColumnError(caught ?? "")).toBe(true);
    }
  );
});
