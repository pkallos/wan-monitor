import { buildCreateTableSql } from "@wan-monitor/shared/db-schema";
import { ConfigProvider, Data, Effect, Layer, Schedule } from "effect";
import { ConfigServiceLive } from "@/infrastructure/config/config";
import { SchemaMigratorLive } from "@/infrastructure/database/questdb/migrations/service";
import {
  QuestDB,
  QuestDBLive,
} from "@/infrastructure/database/questdb/service";

/**
 * Base URL for the QuestDB HTTP API used by integration tests.
 *
 * Resolved from the environment so integration tests can target an isolated
 * dockerized QuestDB (see vitest.config.ts integration mode) instead of the
 * dev database. Precedence:
 *   1. QUESTDB_HTTP_URL (explicit override)
 *   2. http://${DB_HOST}:${DB_PORT} (matches the server's REST/exec endpoint)
 *   3. http://localhost:9000 (default dev/CI port)
 * Shared by all test utilities so the endpoint is defined in exactly one place.
 */
const resolveQuestDBHttpUrl = (): string => {
  const explicit = process.env.QUESTDB_HTTP_URL;
  if (explicit && explicit.length > 0) {
    return explicit.replace(/\/+$/, "");
  }
  const host = process.env.DB_HOST ?? "localhost";
  const port = process.env.DB_PORT ?? "9000";
  return `http://${host}:${port}`;
};

export const QUESTDB_HTTP_URL = resolveQuestDBHttpUrl();

/**
 * Per-worker metrics table name for integration tests.
 *
 * Each Vitest worker gets its own table (`network_metrics_test_<pool-id>`) so
 * that test files running in parallel across workers never collide: one
 * worker's TRUNCATE cannot wipe another worker's seeded rows.
 * Files within a single worker still run sequentially, so a single shared table
 * per worker is safe. `VITEST_POOL_ID` is assigned per worker by the pool and
 * falls back to "1" outside the pool (e.g. a direct import).
 */
export const TEST_TABLE = `network_metrics_test_${
  process.env.VITEST_POOL_ID ?? "1"
}`;

/**
 * A failure preparing, reading or cleaning a test table.
 */
export class TestCleanupError extends Data.TaggedError("TestCleanupError")<{
  readonly message: string;
}> {}

/**
 * Whether the test harness flagged QuestDB as available
 * (QUESTDB_AVAILABLE=true). Integration tests skip when it is false.
 */
export const isQuestDBAvailable = (): boolean => {
  return process.env.QUESTDB_AVAILABLE === "true";
};

/**
 * ConfigProvider that points the ConfigService-driven production code paths
 * (ILP writer, query builders, schema migrations) at the given table.
 *
 * It overrides only `DB_TABLE` and falls back to the environment for every
 * other key (DB_HOST, DB_PORT, ... supplied by vitest.config integration
 * mode). It never mutates `process.env`: the override is scoped to the test
 * layer rather than leaking into the whole worker process.
 */
const testConfigProvider = (table: string): ConfigProvider.ConfigProvider =>
  ConfigProvider.fromUnknown({ DB_TABLE: table }).pipe(
    ConfigProvider.orElse(ConfigProvider.fromEnv())
  );

/**
 * Layer for integration tests: QuestDB over real connections, configured
 * through {@link testConfigProvider}.
 */
export const createTestLayer = (table: string = TEST_TABLE) =>
  Layer.provide(
    QuestDBLive,
    Layer.provide(
      ConfigServiceLive,
      ConfigProvider.layer(testConfigProvider(table))
    )
  );

/**
 * The schema migrator against the given table, backed by the same config
 * injection as {@link createTestLayer}.
 */
export const createMigratorTestLayer = (table: string) =>
  Layer.provide(
    SchemaMigratorLive,
    Layer.provide(
      ConfigServiceLive,
      ConfigProvider.layer(testConfigProvider(table))
    )
  );

/**
 * Run a statement through the QuestDB HTTP API and return its result rows.
 * Rejects when QuestDB reports an error.
 */
export const queryQuestDB = async (
  sql: string
): Promise<readonly (readonly unknown[])[]> => {
  const response = await fetch(
    `${QUESTDB_HTTP_URL}/exec?query=${encodeURIComponent(sql)}`
  );
  const body = (await response.json()) as {
    error?: string;
    dataset?: readonly (readonly unknown[])[];
  };
  if (body.error !== undefined) {
    throw new Error(`${body.error} [${sql}]`);
  }
  return body.dataset ?? [];
};

/**
 * Connection setup, table creation and TRUNCATE complete asynchronously, so
 * tests poll for the real signal instead of sleeping.
 */
const POLL_INTERVAL = "100 millis";
const POLL_TIMEOUT = "10 seconds";

const readinessSchedule = Schedule.spaced(POLL_INTERVAL).pipe(
  Schedule.upTo({ duration: POLL_TIMEOUT })
);

/**
 * Count rows in `table` via the QuestDB HTTP API. Fails if the table does not
 * exist yet or the query errors, so wrapping it in a retry makes a readiness
 * probe.
 */
const countMetricRows = (
  table: string
): Effect.Effect<number, TestCleanupError> =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(
        `${QUESTDB_HTTP_URL}/exec?query=${encodeURIComponent(
          `SELECT count() FROM ${table}`
        )}`
      );
      if (!response.ok) {
        throw new Error(`Count query failed: ${response.status}`);
      }
      const body = (await response.json()) as {
        dataset?: ReadonlyArray<ReadonlyArray<number>>;
      };
      return body.dataset?.[0]?.[0] ?? 0;
    },
    catch: (error) =>
      new TestCleanupError({
        message: `Failed to count metric rows: ${error}`,
      }),
  });

/**
 * Poll until `table` is queryable (exists and answers a count query). Table
 * metadata becomes visible asynchronously after CREATE TABLE.
 */
const waitForTableReady = (
  table: string
): Effect.Effect<void, TestCleanupError> =>
  Effect.gen(function* () {
    yield* countMetricRows(table);
  }).pipe(Effect.retry(readinessSchedule));

/**
 * Poll until the table is empty after a TRUNCATE, which commits asynchronously
 * on a WAL table.
 */
const waitForTableEmpty = (
  table: string
): Effect.Effect<void, TestCleanupError> =>
  Effect.gen(function* () {
    const count = yield* countMetricRows(table);
    if (count > 0) {
      return yield* Effect.fail(
        new TestCleanupError({
          message: `Table still has ${count} row${count === 1 ? "" : "s"} after truncate`,
        })
      );
    }
  }).pipe(Effect.retry(readinessSchedule));

/** Create the table with the canonical schema if it doesn't exist, then wait until it is queryable. */
const initializeDatabase = (name: string) =>
  Effect.gen(function* () {
    const createSql = buildCreateTableSql(name);
    yield* Effect.tryPromise({
      try: async () => {
        const createResponse = await fetch(
          `${QUESTDB_HTTP_URL}/exec?query=${encodeURIComponent(createSql)}`,
          {
            method: "GET",
          }
        );

        if (!createResponse.ok) {
          throw new Error(
            `Failed to create ${name} table: ${createResponse.status}`
          );
        }

        return true;
      },
      catch: (error) =>
        new TestCleanupError({ message: `Database init failed: ${error}` }),
    });

    yield* waitForTableReady(name);
  });

/**
 * Drop a table together with the tables the migrations keep beside it: the
 * ledger, plus the copy and renamed original of an interrupted rebuild.
 */
export const dropTableFamily = (table: string) =>
  Effect.tryPromise({
    try: async () => {
      for (const name of [
        table,
        `${table}__rebuild`,
        `${table}__previous`,
        `${table}_migrations`,
      ]) {
        await queryQuestDB(`DROP TABLE IF EXISTS ${name}`);
      }
    },
    catch: (error) =>
      new TestCleanupError({ message: `Table drop failed: ${error}` }),
  });

/**
 * Clean up test data from the database.
 * Truncates the table to remove all data.
 * This is faster and more reliable than DROP/CREATE.
 */
export const cleanupDatabase = (
  _db: QuestDB["Service"],
  table: string = TEST_TABLE
) =>
  Effect.gen(function* () {
    yield* initializeDatabase(table);

    yield* Effect.tryPromise({
      try: async () => {
        const truncateResponse = await fetch(
          `${QUESTDB_HTTP_URL}/exec?query=${encodeURIComponent(
            `TRUNCATE TABLE ${table}`
          )}`,
          {
            method: "GET",
          }
        );

        if (!truncateResponse.ok) {
          const text = await truncateResponse.text();
          throw new Error(
            `Failed to truncate ${table} table: ${truncateResponse.status} - ${text}`
          );
        }

        return true;
      },
      catch: (error) =>
        new TestCleanupError({ message: `Cleanup failed: ${error}` }),
    });

    yield* waitForTableEmpty(table);
  });

/**
 * Setup function to run before integration tests.
 * Ensures QuestDB is connected and database is clean.
 */
export const setupIntegrationTest = (table: string = TEST_TABLE) =>
  Effect.gen(function* () {
    const db = yield* QuestDB;

    yield* db.health().pipe(Effect.retry(readinessSchedule));

    yield* cleanupDatabase(db, table);

    return db;
  });

/**
 * Teardown function to run after integration tests.
 * Cleans up test data.
 */
export const teardownIntegrationTest = (
  db: QuestDB["Service"],
  table: string = TEST_TABLE
) =>
  Effect.gen(function* () {
    yield* cleanupDatabase(db, table);
  });
