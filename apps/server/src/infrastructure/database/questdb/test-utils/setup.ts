import { Data, Effect, Layer } from "effect";
import { ConfigServiceLive } from "@/infrastructure/config/config";
import {
  QuestDB,
  QuestDBLive,
} from "@/infrastructure/database/questdb/service";

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
 * Create the Effect Layer stack for integration tests.
 * This includes ConfigService and QuestDB with real connections.
 */
export const createTestLayer = () => {
  return Layer.provide(QuestDBLive, ConfigServiceLive);
};

/**
 * Wait for QuestDB connection to be established.
 * Should be called at the start of each test that needs a database connection.
 */
export const waitForConnection = () => {
  return Effect.sleep("2000 millis");
};

/**
 * Initialize the test database.
 * Creates the network_metrics table with full schema if it doesn't exist.
 * This ensures consistent schema for all tests.
 */
const initializeDatabase = () =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: async () => {
        // Create table with full schema to ensure consistent column types
        const createQuery = `
          CREATE TABLE IF NOT EXISTS network_metrics (
            source SYMBOL,
            host SYMBOL,
            latency DOUBLE,
            jitter DOUBLE,
            packet_loss DOUBLE,
            connectivity_status STRING,
            download_bandwidth LONG,
            upload_bandwidth LONG,
            server_location STRING,
            isp STRING,
            external_ip STRING,
            internal_ip STRING,
            timestamp TIMESTAMP
          ) timestamp(timestamp) PARTITION BY DAY;
        `;

        const createResponse = await fetch(
          `http://localhost:9000/exec?query=${encodeURIComponent(createQuery)}`,
          {
            method: "GET",
          }
        );

        if (!createResponse.ok) {
          throw new Error(
            `Failed to create network_metrics table: ${createResponse.status}`
          );
        }

        return true;
      },
      catch: (error) =>
        new TestCleanupError({ message: `Database init failed: ${error}` }),
    });

    // Wait for table creation to be processed
    yield* Effect.sleep("1000 millis");
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
          "http://localhost:9000/exec?query=TRUNCATE%20TABLE%20network_metrics",
          {
            method: "GET",
          }
        );

        if (!truncateResponse.ok) {
          const text = await truncateResponse.text();
          throw new Error(
            `Failed to truncate network_metrics table: ${truncateResponse.status} - ${text}`
          );
        }

        return true;
      },
      catch: (error) =>
        new TestCleanupError({ message: `Cleanup failed: ${error}` }),
    });

    // Wait for truncate to be processed
    yield* Effect.sleep("1000 millis");
  });

/**
 * Setup function to run before integration tests.
 * Ensures QuestDB is connected and database is clean.
 */
export const setupIntegrationTest = () =>
  Effect.gen(function* () {
    const db = yield* QuestDB;

    // Wait for connection
    yield* waitForConnection();

    // Verify connection with health check
    yield* db.health();

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
