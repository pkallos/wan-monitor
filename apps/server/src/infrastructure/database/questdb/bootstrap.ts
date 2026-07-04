import {
  buildAddColumnSql,
  buildCreateTableSql,
  missingColumns,
  NETWORK_METRICS_TABLE,
  SCHEMA_VERSION,
} from "@wan-monitor/shared/db-schema";
import { Effect } from "effect";
import type { Client as PgClient } from "pg";
import { DatabaseConnectionError } from "@/infrastructure/database/questdb/errors";
import { errorMessage } from "@/infrastructure/database/questdb/util";

interface ColumnNameRow {
  readonly name: string;
}

/**
 * Detect the "column already exists" class of error QuestDB raises when an
 * `ALTER TABLE ADD COLUMN` targets a column that is already present. This
 * happens in a benign race: ILP schema-on-write can create a column between our
 * introspection and our ALTER. Treating it as success makes the migration
 * idempotent regardless of concurrent writers, and is more robust than
 * `ADD COLUMN IF NOT EXISTS` (which still errors when the racing column was
 * created with a different type — see QuestDB PR #5675).
 */
export const isDuplicateColumnError = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("already exists") || normalized.includes("duplicate")
  );
};

/**
 * Introspect the columns that currently exist on the metrics table. Returns an
 * empty list for a table that does not exist yet (the preceding CREATE makes
 * this the normal fresh-database path).
 */
const introspectColumns = (
  pgClient: PgClient
): Effect.Effect<readonly string[], DatabaseConnectionError> =>
  Effect.tryPromise({
    try: async () => {
      const result = await pgClient.query(
        `SELECT "column" AS name FROM table_columns('${NETWORK_METRICS_TABLE}')`
      );
      return (result.rows as ColumnNameRow[]).map((row) => row.name);
    },
    catch: (error) =>
      new DatabaseConnectionError(
        `Schema introspection failed: ${errorMessage(error)}`
      ),
  });

/**
 * Idempotently bootstrap and migrate the `network_metrics` schema.
 *
 * 1. `CREATE TABLE IF NOT EXISTS` with the canonical schema (fresh databases).
 * 2. Introspect the existing columns and `ALTER TABLE ADD COLUMN` for any
 *    canonical column that is missing (forward-only migration for tables
 *    created before a column was added, e.g. by ILP schema-on-write).
 *
 * All statements are additive and non-destructive, so this is safe to run on
 * every connection establishment and existing data is always preserved.
 */
export const bootstrapSchema = (
  pgClient: PgClient
): Effect.Effect<void, DatabaseConnectionError> =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => pgClient.query(buildCreateTableSql()),
      catch: (error) =>
        new DatabaseConnectionError(
          `Schema bootstrap (create table) failed: ${errorMessage(error)}`
        ),
    });

    const existing = yield* introspectColumns(pgClient);
    const toAdd = missingColumns(existing);

    let added = 0;
    for (const column of toAdd) {
      const outcome = yield* Effect.tryPromise({
        try: () => pgClient.query(buildAddColumnSql(column)),
        catch: (error) =>
          new DatabaseConnectionError(
            `Schema migration (add column ${column.name}) failed: ${errorMessage(
              error
            )}`
          ),
      }).pipe(
        Effect.as("added" as const),
        // A concurrent writer (ILP schema-on-write) may have created the column
        // between introspection and this ALTER. That is benign and idempotent,
        // so swallow the duplicate-column error and keep going; any other
        // failure is real and propagates to tear down the connection.
        Effect.catchAll((error) =>
          isDuplicateColumnError(error.message)
            ? Effect.succeed("raced" as const)
            : Effect.fail(error)
        )
      );

      if (outcome === "added") {
        added += 1;
        yield* Effect.logInfo(
          `QuestDB schema migration: added column ${column.name} ${column.type}`
        );
      } else {
        yield* Effect.logInfo(
          `QuestDB schema migration: column ${column.name} was created concurrently, skipping`
        );
      }
    }

    yield* Effect.logInfo(
      `QuestDB schema bootstrapped (version ${SCHEMA_VERSION}, ${added} column(s) migrated)`
    );
  });
