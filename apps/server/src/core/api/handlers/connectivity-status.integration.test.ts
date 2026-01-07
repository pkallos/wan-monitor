import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { getConnectivityStatusHandler } from "@/core/api/handlers/connectivity-status";
import { ConfigServiceLive } from "@/infrastructure/config/config";
import { QuestDB, QuestDBLive } from "@/infrastructure/database/questdb";

/**
 * Integration tests for /connectivity-status endpoint
 * Tests aggregation logic against seeded QuestDB test database
 *
 * These tests run conditionally when QUESTDB_AVAILABLE=true
 */
describe("Connectivity Status Integration Tests", () => {
  const isQuestDBAvailable = process.env.QUESTDB_AVAILABLE === "true";

  /**
   * Seeds deterministic ping data into QuestDB for testing
   * Creates a mix of up/degraded/down statuses over a fixed time range
   */
  const seedTestData = Effect.gen(function* () {
    const db = yield* QuestDB;

    // Wait for connection to establish
    yield* Effect.sleep("2000 millis");

    // Test data covers 2024-01-01 00:00:00 to 00:30:00 (30 minutes)
    // Using 5-minute granularity should produce 6 data points
    const baseTime = new Date("2024-01-01T00:00:00.000Z").getTime();

    const testData = [
      // Bucket 1: 00:00-00:05 - 100% up (10 records, all up)
      ...Array.from({ length: 10 }, (_, i) => ({
        timestamp: new Date(baseTime + i * 30000), // Every 30 seconds
        source: "ping" as const,
        host: "8.8.8.8",
        latency: 15.0 + i * 0.5, // 15-19.5ms
        jitter: 1.0,
        packet_loss: 0.0,
        connectivity_status: "up" as const,
      })),

      // Bucket 2: 00:05-00:10 - 80% up, 20% degraded (10 records: 8 up, 2 degraded)
      ...Array.from({ length: 8 }, (_, i) => ({
        timestamp: new Date(baseTime + 5 * 60000 + i * 30000),
        source: "ping" as const,
        host: "8.8.8.8",
        latency: 20.0 + i * 0.5,
        jitter: 1.5,
        packet_loss: 0.0,
        connectivity_status: "up" as const,
      })),
      ...Array.from({ length: 2 }, (_, i) => ({
        timestamp: new Date(baseTime + 5 * 60000 + (8 + i) * 30000),
        source: "ping" as const,
        host: "8.8.8.8",
        latency: 30.0,
        jitter: 5.0,
        packet_loss: 10.0, // >= 5% packet loss = degraded
        connectivity_status: "up" as const,
      })),

      // Bucket 3: 00:10-00:15 - 50% up, 30% degraded, 20% down
      ...Array.from({ length: 5 }, (_, i) => ({
        timestamp: new Date(baseTime + 10 * 60000 + i * 30000),
        source: "ping" as const,
        host: "8.8.8.8",
        latency: 18.0 + i * 0.5,
        jitter: 1.0,
        packet_loss: 0.0,
        connectivity_status: "up" as const,
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        timestamp: new Date(baseTime + 10 * 60000 + (5 + i) * 30000),
        source: "ping" as const,
        host: "8.8.8.8",
        latency: 25.0,
        jitter: 4.0,
        packet_loss: 8.0, // >= 5% packet loss = degraded
        connectivity_status: "up" as const,
      })),
      ...Array.from({ length: 2 }, (_, i) => ({
        timestamp: new Date(baseTime + 10 * 60000 + (8 + i) * 30000),
        source: "ping" as const,
        host: "8.8.8.8",
        latency: -1.0, // Negative latency = down
        jitter: 0.0,
        packet_loss: 100.0,
        connectivity_status: "down" as const,
      })),

      // Bucket 4: 00:15-00:20 - 100% down (10 records, all down)
      ...Array.from({ length: 10 }, (_, i) => ({
        timestamp: new Date(baseTime + 15 * 60000 + i * 30000),
        source: "ping" as const,
        host: "8.8.8.8",
        latency: -1.0,
        jitter: 0.0,
        packet_loss: 100.0,
        connectivity_status: "down" as const,
      })),

      // Bucket 5: 00:20-00:25 - 90% up, 10% degraded (10 records: 9 up, 1 degraded)
      ...Array.from({ length: 9 }, (_, i) => ({
        timestamp: new Date(baseTime + 20 * 60000 + i * 30000),
        source: "ping" as const,
        host: "8.8.8.8",
        latency: 12.0 + i * 0.5,
        jitter: 0.8,
        packet_loss: 0.0,
        connectivity_status: "up" as const,
      })),
      {
        timestamp: new Date(baseTime + 20 * 60000 + 9 * 30000),
        source: "ping" as const,
        host: "8.8.8.8",
        latency: 22.0,
        jitter: 3.0,
        packet_loss: 7.0, // >= 5% packet loss = degraded
        connectivity_status: "up" as const,
      },

      // Bucket 6: 00:25-00:30 - 70% up, 30% down (10 records: 7 up, 3 down)
      ...Array.from({ length: 7 }, (_, i) => ({
        timestamp: new Date(baseTime + 25 * 60000 + i * 30000),
        source: "ping" as const,
        host: "8.8.8.8",
        latency: 16.0 + i * 0.5,
        jitter: 1.2,
        packet_loss: 0.0,
        connectivity_status: "up" as const,
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        timestamp: new Date(baseTime + 25 * 60000 + (7 + i) * 30000),
        source: "ping" as const,
        host: "8.8.8.8",
        latency: -1.0,
        jitter: 0.0,
        packet_loss: 100.0,
        connectivity_status: "down" as const,
      })),
    ];

    // Insert all test data
    for (const record of testData) {
      yield* db.writeMetric({
        timestamp: record.timestamp,
        source: record.source as "ping" | "speedtest",
        host: record.host,
        latency: record.latency,
        jitter: record.jitter,
        packetLoss: record.packet_loss,
        connectivityStatus: record.connectivity_status,
      });
    }

    // Small delay to ensure data is written
    yield* Effect.sleep("500 millis");
  });

  /**
   * Error type for cleanup failures
   */
  class CleanupError {
    readonly _tag = "CleanupError";
    constructor(readonly message: string) {}
  }

  /**
   * Cleans up test data after tests complete
   */
  const cleanupTestData = Effect.gen(function* () {
    yield* QuestDB;

    // Delete test data from 2024-01-01
    yield* Effect.tryPromise({
      try: () =>
        fetch(
          "http://localhost:9000/exec?" +
            new URLSearchParams({
              query:
                "DELETE FROM network_metrics WHERE timestamp >= '2024-01-01T00:00:00.000Z' AND timestamp < '2024-01-02T00:00:00.000Z'",
            })
        ),
      catch: (error) =>
        new CleanupError(`Failed to cleanup test data: ${error}`),
    });

    yield* Effect.sleep("500 millis");
  });

  const MainLive = Layer.provide(QuestDBLive, ConfigServiceLive);

  it.skipIf(!isQuestDBAvailable)(
    "calculates uptimePercentage correctly with mixed status data",
    async () => {
      const program = Effect.gen(function* () {
        // Seed test data
        yield* seedTestData;

        // Query with 5-minute granularity
        const result = yield* getConnectivityStatusHandler({
          urlParams: {
            startTime: "2024-01-01T00:00:00.000Z",
            endTime: "2024-01-01T00:30:00.000Z",
            granularity: "5m",
          },
        });

        // Verify we got data back
        expect(result.data.length).toBeGreaterThan(0);

        // Verify the aggregated uptime percentage across all buckets
        // Total: 60 records, Up: 39, Expected: 65%
        expect(result.meta.uptimePercentage).toBeCloseTo(65, 1);

        // Verify metadata
        expect(result.meta.count).toBe(result.data.length);
        expect(result.meta.startTime).toBe("2024-01-01T00:00:00.000Z");
        expect(result.meta.endTime).toBe("2024-01-01T00:30:00.000Z");

        // Cleanup
        yield* cleanupTestData;
      });

      await Effect.runPromise(Effect.provide(program, MainLive));
    }
  );

  it.skipIf(!isQuestDBAvailable)(
    "aligns data points with requested granularity",
    async () => {
      const program = Effect.gen(function* () {
        // Seed test data
        yield* seedTestData;

        // Test 1-minute granularity (should produce more data points)
        const result1m = yield* getConnectivityStatusHandler({
          urlParams: {
            startTime: "2024-01-01T00:00:00.000Z",
            endTime: "2024-01-01T00:30:00.000Z",
            granularity: "1m",
          },
        });

        // 30 minutes with 1-minute buckets = 30 data points
        expect(result1m.data.length).toBeGreaterThan(0);
        expect(result1m.meta.count).toBe(result1m.data.length);

        // Test 15-minute granularity (should produce fewer data points)
        const result15m = yield* getConnectivityStatusHandler({
          urlParams: {
            startTime: "2024-01-01T00:00:00.000Z",
            endTime: "2024-01-01T00:30:00.000Z",
            granularity: "15m",
          },
        });

        // 30 minutes with 15-minute buckets = 2 data points
        expect(result15m.data).toHaveLength(2);
        expect(result15m.meta.count).toBe(2);

        // Verify timestamps align with bucket boundaries
        const timestamps1m = result1m.data.map((d) => new Date(d.timestamp));
        for (let i = 1; i < timestamps1m.length; i++) {
          const diff =
            timestamps1m[i].getTime() - timestamps1m[i - 1].getTime();
          expect(diff).toBe(60000); // 1 minute in milliseconds
        }

        const timestamps15m = result15m.data.map((d) => new Date(d.timestamp));
        for (let i = 1; i < timestamps15m.length; i++) {
          const diff =
            timestamps15m[i].getTime() - timestamps15m[i - 1].getTime();
          expect(diff).toBe(900000); // 15 minutes in milliseconds
        }

        // Cleanup
        yield* cleanupTestData;
      });

      await Effect.runPromise(Effect.provide(program, MainLive));
    }
  );

  it.skipIf(!isQuestDBAvailable)(
    "handles gaps in time series data correctly",
    async () => {
      const program = Effect.gen(function* () {
        const db = yield* QuestDB;

        // Wait for connection
        yield* Effect.sleep("2000 millis");

        // Seed data with intentional gaps
        // Create data only for 00:00-00:05 and 00:20-00:25 (15-minute gap)
        const baseTime = new Date("2024-01-01T00:00:00.000Z").getTime();

        const sparseData = [
          // First bucket: 00:00-00:05 (10 records, all up)
          ...Array.from({ length: 10 }, (_, i) => ({
            timestamp: new Date(baseTime + i * 30000),
            source: "ping" as const,
            host: "8.8.8.8",
            latency: 15.0,
            jitter: 1.0,
            packet_loss: 0.0,
            connectivity_status: "up" as const,
          })),

          // Gap from 00:05-00:20 (no data)

          // Last bucket: 00:20-00:25 (10 records, all up)
          ...Array.from({ length: 10 }, (_, i) => ({
            timestamp: new Date(baseTime + 20 * 60000 + i * 30000),
            source: "ping" as const,
            host: "8.8.8.8",
            latency: 18.0,
            jitter: 1.0,
            packet_loss: 0.0,
            connectivity_status: "up" as const,
          })),
        ];

        for (const record of sparseData) {
          yield* db.writeMetric({
            timestamp: record.timestamp,
            source: record.source as "ping" | "speedtest",
            host: record.host,
            latency: record.latency,
            jitter: record.jitter,
            packetLoss: record.packet_loss,
            connectivityStatus: record.connectivity_status,
          });
        }

        yield* Effect.sleep("500 millis");

        // Query with 5-minute granularity
        const result = yield* getConnectivityStatusHandler({
          urlParams: {
            startTime: "2024-01-01T00:00:00.000Z",
            endTime: "2024-01-01T00:30:00.000Z",
            granularity: "5m",
          },
        });

        // Should only return buckets with data (no zero-filled gaps)
        // QuestDB SAMPLE BY only returns buckets that have data
        expect(result.data.length).toBeGreaterThan(0);
        expect(result.data.length).toBeLessThanOrEqual(6);

        // Verify all returned data points show 100% up
        for (const dataPoint of result.data) {
          expect(dataPoint.upPercentage).toBe(100);
          expect(dataPoint.downPercentage).toBe(0);
          expect(dataPoint.degradedPercentage).toBe(0);
        }

        // Overall uptime should be 100% (all data is up)
        expect(result.meta.uptimePercentage).toBe(100);

        // Cleanup
        yield* cleanupTestData;
      });

      await Effect.runPromise(Effect.provide(program, MainLive));
    }
  );
});
