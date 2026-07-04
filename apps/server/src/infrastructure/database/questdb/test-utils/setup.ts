import { buildCreateTableSql } from "@wan-monitor/shared/db-schema";
import { ConfigProvider, Data, Effect, Layer, Schedule } from "effect";
import { ConfigServiceLive } from "@/infrastructure/config/config";
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
 * worker's TRUNCATE can no longer wipe another worker's freshly-seeded rows.
 * Files within a single worker still run sequentially, so a single shared table
 * per worker is safe. `VITEST_POOL_ID` is assigned per worker by the pool and
 * falls back to "1" outside the pool (e.g. a direct import).
 */
export const TEST_TABLE = `network_metrics_test_${
  process.env.VITEST_POOL_ID ?? "1"
}`;

/**
 * Error for test database cleanup failures
 */
export class TestCleanupError extends Data.TaggedError("TestCleanupError")<{
  readonly message: string;
}> {}

/**
 * Check if QuestDB is available for integration tests.
 * Tests should be skipped if this returns false.
 */
export const isQuestDBAvailable = (): boolean => {
  return process.env.QUESTDB_AVAILABLE === "true";
};

/**
 * ConfigProvider that points the ConfigService-driven production code paths
 * (ILP writer, query builders, schema bootstrap) at this worker's table.
 *
 * It overrides only `DB_TABLE` and falls back to the environment for every
 * other key (DB_HOST, DB_PORT, ... supplied by vitest.config integration
 * mode). This is the Effect-idiomatic way to inject test configuration — no
 * `process.env` mutation, and the override is scoped to the test layer rather
 * than leaking into the whole worker process.
 */
const testConfigProvider = (): ConfigProvider.ConfigProvider =>
  ConfigProvider.fromMap(new Map([["DB_TABLE", TEST_TABLE]])).pipe(
    ConfigProvider.orElse(() => ConfigProvider.fromEnv())
  );

/**
 * Create the Effect Layer stack for integration tests.
 * This includes ConfigService (backed by {@link testConfigProvider}) and
 * QuestDB with real connections.
 */
export const createTestLayer = () =>
  Layer.provide(
    QuestDBLive,
    Layer.provide(
      ConfigServiceLive,
      Layer.setConfigProvider(testConfigProvider())
    )
  );

/**
 * Poll interval and overall timeout for readiness checks. Integration tests
 * replaced fixed sleeps with polling so each step waits exactly as long as
 * needed: QuestDB connection setup, table creation, and TRUNCATE all complete
 * asynchronously, and a fixed sleep is both slower (on the happy path) and
 * flakier (under CI load) than converging on the real signal.
 */
const POLL_INTERVAL = "100 millis";
const POLL_TIMEOUT = "10 seconds";

const readinessSchedule = Schedule.spaced(POLL_INTERVAL).pipe(
  Schedule.upTo(POLL_TIMEOUT)
);

/**
 * Count rows in network_metrics via the QuestDB HTTP API. Fails if the table
 * does not exist yet or the query errors, which makes it a natural readiness
 * probe when wrapped in a retry.
 */
const countMetricRows = (): Effect.Effect<number, TestCleanupError> =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(
        `${QUESTDB_HTTP_URL}/exec?query=${encodeURIComponent(
          `SELECT count() FROM ${TEST_TABLE}`
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
 * Poll until the network_metrics table is queryable (exists and answers a
 * count query), replacing a fixed post-CREATE sleep. Table metadata becomes
 * visible asynchronously after CREATE TABLE.
 */
const waitForTableReady = (): Effect.Effect<void, TestCleanupError> =>
  Effect.gen(function* () {
    yield* countMetricRows();
  }).pipe(Effect.retry(readinessSchedule));

/**
 * Poll until the table is empty after a TRUNCATE, replacing a fixed sleep.
 * TRUNCATE on a WAL table commits asynchronously, so the row count converges
 * to zero shortly after the HTTP call returns.
 */
const waitForTableEmpty = (): Effect.Effect<void, TestCleanupError> =>
  Effect.gen(function* () {
    const count = yield* countMetricRows();
    if (count > 0) {
      return yield* Effect.fail(
        new TestCleanupError({
          message: `Table still has ${count} rows after truncate`,
        })
      );
    }
  }).pipe(Effect.retry(readinessSchedule));

/**
 * Initialize the test database.
 * Creates the network_metrics table with full schema if it doesn't exist.
 * This ensures consistent schema for all tests.
 */
const initializeDatabase = () =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: async () => {
        // Use the canonical schema so integration tests, CI, E2E, and the
        // server bootstrap all create an identical table (no drift). The
        // per-worker table name isolates parallel workers from each other.
        const createQuery = buildCreateTableSql(TEST_TABLE);

        const createResponse = await fetch(
          `${QUESTDB_HTTP_URL}/exec?query=${encodeURIComponent(createQuery)}`,
          {
            method: "GET",
          }
        );

        if (!createResponse.ok) {
          throw new Error(
            `Failed to create ${TEST_TABLE} table: ${createResponse.status}`
          );
        }

        return true;
      },
      catch: (error) =>
        new TestCleanupError({ message: `Database init failed: ${error}` }),
    });

    // Wait until the table is actually queryable rather than sleeping a fixed
    // interval (table metadata becomes visible asynchronously after CREATE).
    yield* waitForTableReady();
  });

/**
 * Clean up test data from the database.
 * Truncates the network_metrics table to remove all data.
 * This is faster and more reliable than DROP/CREATE.
 */
export const cleanupDatabase = (_db: QuestDB["Type"]) =>
  Effect.gen(function* () {
    // First ensure table exists
    yield* initializeDatabase();

    // Truncate the table to remove all data
    yield* Effect.tryPromise({
      try: async () => {
        const truncateResponse = await fetch(
          `${QUESTDB_HTTP_URL}/exec?query=${encodeURIComponent(
            `TRUNCATE TABLE ${TEST_TABLE}`
          )}`,
          {
            method: "GET",
          }
        );

        if (!truncateResponse.ok) {
          const text = await truncateResponse.text();
          throw new Error(
            `Failed to truncate ${TEST_TABLE} table: ${truncateResponse.status} - ${text}`
          );
        }

        return true;
      },
      catch: (error) =>
        new TestCleanupError({ message: `Cleanup failed: ${error}` }),
    });

    // Wait until the table is empty rather than sleeping a fixed interval
    // (TRUNCATE on a WAL table commits asynchronously).
    yield* waitForTableEmpty();
  });

/**
 * Setup function to run before integration tests.
 * Ensures QuestDB is connected and database is clean.
 */
export const setupIntegrationTest = () =>
  Effect.gen(function* () {
    const db = yield* QuestDB;

    // Poll the health check until the background connection loop has
    // established a connection, instead of sleeping a fixed interval.
    yield* db.health().pipe(Effect.retry(readinessSchedule));

    // Clean database
    yield* cleanupDatabase(db);

    return db;
  });

/**
 * Teardown function to run after integration tests.
 * Cleans up test data.
 */
export const teardownIntegrationTest = (db: QuestDB["Type"]) =>
  Effect.gen(function* () {
    yield* cleanupDatabase(db);
  });
