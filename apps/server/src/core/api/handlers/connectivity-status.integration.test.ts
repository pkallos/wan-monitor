import type { NetworkMetric } from "@shared/metrics";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { getConnectivityStatusHandler } from "@/core/api/handlers/connectivity-status";
import { seedDatabase } from "@/infrastructure/database/questdb/test-utils/seed";
import {
  createTestLayer,
  isQuestDBAvailable,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "@/infrastructure/database/questdb/test-utils/setup";

/**
 * Integration tests for /connectivity-status endpoint
 * Tests aggregation logic against seeded QuestDB test database
 *
 * These tests run conditionally when QUESTDB_AVAILABLE=true
 */
describe("Connectivity Status Integration Tests", () => {
  const skipTests = !isQuestDBAvailable();
  const testLayer = createTestLayer();

  /**
   * Creates deterministic connectivity status test data for a 30-minute window.
   * 60 records total across 6 five-minute buckets with predictable status distributions:
   *
   * - Bucket 1 (00:00-00:05): 100% up (10 records)
   * - Bucket 2 (00:05-00:10): 80% up, 20% degraded (8 up + 2 degraded)
   * - Bucket 3 (00:10-00:15): 50% up, 30% degraded, 20% down (5 up + 3 degraded + 2 down)
   * - Bucket 4 (00:15-00:20): 100% down (10 records)
   * - Bucket 5 (00:20-00:25): 90% up, 10% degraded (9 up + 1 degraded)
   * - Bucket 6 (00:25-00:30): 70% up, 30% down (7 up + 3 down)
   *
   * Overall: 39 up / 60 total = 65% uptime
   */
  const createConnectivityTestData = (
    baseTime: Date
  ): {
    metrics: NetworkMetric[];
    expectedBuckets: Array<{
      up: number;
      degraded: number;
      down: number;
      status: "up" | "degraded" | "down";
    }>;
    expectedUptimePercentage: number;
  } => {
    const baseMs = baseTime.getTime();
    const metrics: NetworkMetric[] = [];

    // Bucket 1: 00:00-00:05 - 100% up (10 records, all up)
    for (let i = 0; i < 10; i++) {
      metrics.push({
        timestamp: new Date(baseMs + i * 30000),
        source: "ping",
        host: "8.8.8.8",
        latency: 15.0 + i * 0.5,
        jitter: 1.0,
        packetLoss: 0.0,
        connectivityStatus: "up",
      });
    }

    // Bucket 2: 00:05-00:10 - 80% up, 20% degraded (8 up + 2 degraded)
    for (let i = 0; i < 8; i++) {
      metrics.push({
        timestamp: new Date(baseMs + 5 * 60000 + i * 30000),
        source: "ping",
        host: "8.8.8.8",
        latency: 20.0 + i * 0.5,
        jitter: 1.5,
        packetLoss: 0.0,
        connectivityStatus: "up",
      });
    }
    for (let i = 0; i < 2; i++) {
      metrics.push({
        timestamp: new Date(baseMs + 5 * 60000 + (8 + i) * 30000),
        source: "ping",
        host: "8.8.8.8",
        latency: 30.0,
        jitter: 5.0,
        packetLoss: 10.0, // >= 5% packet loss = degraded
        connectivityStatus: "degraded",
      });
    }

    // Bucket 3: 00:10-00:15 - 50% up, 30% degraded, 20% down
    for (let i = 0; i < 5; i++) {
      metrics.push({
        timestamp: new Date(baseMs + 10 * 60000 + i * 30000),
        source: "ping",
        host: "8.8.8.8",
        latency: 18.0 + i * 0.5,
        jitter: 1.0,
        packetLoss: 0.0,
        connectivityStatus: "up",
      });
    }
    for (let i = 0; i < 3; i++) {
      metrics.push({
        timestamp: new Date(baseMs + 10 * 60000 + (5 + i) * 30000),
        source: "ping",
        host: "8.8.8.8",
        latency: 25.0,
        jitter: 4.0,
        packetLoss: 8.0, // >= 5% packet loss = degraded
        connectivityStatus: "degraded",
      });
    }
    for (let i = 0; i < 2; i++) {
      metrics.push({
        timestamp: new Date(baseMs + 10 * 60000 + (8 + i) * 30000),
        source: "ping",
        host: "8.8.8.8",
        latency: -1.0,
        jitter: 0.0,
        packetLoss: 100.0,
        connectivityStatus: "down",
      });
    }

    // Bucket 4: 00:15-00:20 - 100% down (10 records)
    for (let i = 0; i < 10; i++) {
      metrics.push({
        timestamp: new Date(baseMs + 15 * 60000 + i * 30000),
        source: "ping",
        host: "8.8.8.8",
        latency: -1.0,
        jitter: 0.0,
        packetLoss: 100.0,
        connectivityStatus: "down",
      });
    }

    // Bucket 5: 00:20-00:25 - 90% up, 10% degraded (9 up + 1 degraded)
    for (let i = 0; i < 9; i++) {
      metrics.push({
        timestamp: new Date(baseMs + 20 * 60000 + i * 30000),
        source: "ping",
        host: "8.8.8.8",
        latency: 12.0 + i * 0.5,
        jitter: 0.8,
        packetLoss: 0.0,
        connectivityStatus: "up",
      });
    }
    metrics.push({
      timestamp: new Date(baseMs + 20 * 60000 + 9 * 30000),
      source: "ping",
      host: "8.8.8.8",
      latency: 22.0,
      jitter: 3.0,
      packetLoss: 7.0, // >= 5% packet loss = degraded
      connectivityStatus: "degraded",
    });

    // Bucket 6: 00:25-00:30 - 70% up, 30% down (7 up + 3 down)
    for (let i = 0; i < 7; i++) {
      metrics.push({
        timestamp: new Date(baseMs + 25 * 60000 + i * 30000),
        source: "ping",
        host: "8.8.8.8",
        latency: 16.0 + i * 0.5,
        jitter: 1.2,
        packetLoss: 0.0,
        connectivityStatus: "up",
      });
    }
    for (let i = 0; i < 3; i++) {
      metrics.push({
        timestamp: new Date(baseMs + 25 * 60000 + (7 + i) * 30000),
        source: "ping",
        host: "8.8.8.8",
        latency: -1.0,
        jitter: 0.0,
        packetLoss: 100.0,
        connectivityStatus: "down",
      });
    }

    return {
      metrics,
      expectedBuckets: [
        { up: 100, degraded: 0, down: 0, status: "up" },
        { up: 80, degraded: 20, down: 0, status: "degraded" },
        { up: 50, degraded: 30, down: 20, status: "down" },
        { up: 0, degraded: 0, down: 100, status: "down" },
        { up: 90, degraded: 10, down: 0, status: "degraded" },
        { up: 70, degraded: 0, down: 30, status: "down" },
      ],
      expectedUptimePercentage: 65, // 39 up / 60 total = 65%
    };
  };

  /**
   * Creates sparse test data with intentional gaps for testing time series gaps.
   * Only populates two 5-minute buckets with a 15-minute gap between them.
   */
  const createSparseTestData = (
    baseTime: Date
  ): {
    metrics: NetworkMetric[];
    expectedBucketCount: number;
    expectedUptimePercentage: number;
  } => {
    const baseMs = baseTime.getTime();
    const metrics: NetworkMetric[] = [];

    // First bucket: 00:00-00:05 (10 records, all up)
    for (let i = 0; i < 10; i++) {
      metrics.push({
        timestamp: new Date(baseMs + i * 30000),
        source: "ping",
        host: "8.8.8.8",
        latency: 15.0,
        jitter: 1.0,
        packetLoss: 0.0,
        connectivityStatus: "up",
      });
    }

    // Gap from 00:05-00:20 (no data)

    // Last bucket: 00:20-00:25 (10 records, all up)
    for (let i = 0; i < 10; i++) {
      metrics.push({
        timestamp: new Date(baseMs + 20 * 60000 + i * 30000),
        source: "ping",
        host: "8.8.8.8",
        latency: 18.0,
        jitter: 1.0,
        packetLoss: 0.0,
        connectivityStatus: "up",
      });
    }

    return {
      metrics,
      expectedBucketCount: 2,
      expectedUptimePercentage: 100, // All 20 records are up
    };
  };

  it.skipIf(skipTests)(
    "calculates uptimePercentage correctly with mixed status data",
    async () => {
      const baseTime = new Date("2024-01-20T10:00:00.000Z");
      const testData = createConnectivityTestData(baseTime);

      const program = Effect.gen(function* () {
        const db = yield* setupIntegrationTest();

        // Seed test data using shared utility (handles flush)
        yield* seedDatabase(db, testData.metrics);

        // Query with 5-minute granularity
        const result = yield* getConnectivityStatusHandler({
          urlParams: {
            startTime: baseTime.toISOString(),
            endTime: new Date(baseTime.getTime() + 30 * 60000).toISOString(),
            granularity: "5m",
          },
        });

        // Verify we got exactly 6 buckets (one per 5-minute interval)
        expect(result.data).toHaveLength(6);

        // Verify each bucket has the expected percentages
        for (let i = 0; i < result.data.length; i++) {
          expect(result.data[i].upPercentage).toBe(
            testData.expectedBuckets[i].up
          );
          expect(result.data[i].degradedPercentage).toBe(
            testData.expectedBuckets[i].degraded
          );
          expect(result.data[i].downPercentage).toBe(
            testData.expectedBuckets[i].down
          );
          expect(result.data[i].status).toBe(
            testData.expectedBuckets[i].status
          );
        }

        // Verify overall uptime: 39 up / 60 total = 65%
        expect(result.meta.uptimePercentage).toBe(
          testData.expectedUptimePercentage
        );

        // Verify metadata
        expect(result.meta.count).toBe(result.data.length);
        expect(result.meta.startTime).toBe(baseTime.toISOString());
        expect(result.meta.endTime).toBe(
          new Date(baseTime.getTime() + 30 * 60000).toISOString()
        );

        // Cleanup
        yield* teardownIntegrationTest(db);
      });

      await Effect.runPromise(Effect.provide(program, testLayer));
    }
  );

  it.skipIf(skipTests)(
    "aligns data points with requested granularity",
    async () => {
      const baseTime = new Date("2024-01-20T11:00:00.000Z");
      const testData = createConnectivityTestData(baseTime);

      const program = Effect.gen(function* () {
        const db = yield* setupIntegrationTest();

        // Seed test data
        yield* seedDatabase(db, testData.metrics);

        const endTime = new Date(baseTime.getTime() + 30 * 60000).toISOString();

        // Test 1-minute granularity (should produce more data points)
        const result1m = yield* getConnectivityStatusHandler({
          urlParams: {
            startTime: baseTime.toISOString(),
            endTime,
            granularity: "1m",
          },
        });

        // 30 minutes with 1-minute buckets - we have 60 records spread across 30 minutes
        // Each minute should have 2 records (every 30 seconds)
        // So we expect exactly 30 data points (one per minute)
        expect(result1m.data).toHaveLength(30);
        expect(result1m.meta.count).toBe(30);

        // Test 15-minute granularity (should produce fewer data points)
        const result15m = yield* getConnectivityStatusHandler({
          urlParams: {
            startTime: baseTime.toISOString(),
            endTime,
            granularity: "15m",
          },
        });

        // 30 minutes with 15-minute buckets = 2 data points
        expect(result15m.data).toHaveLength(2);
        expect(result15m.meta.count).toBe(2);

        // Verify timestamps align with bucket boundaries (1-minute)
        const timestamps1m = result1m.data.map((d) => new Date(d.timestamp));
        for (let i = 1; i < timestamps1m.length; i++) {
          const diff =
            timestamps1m[i].getTime() - timestamps1m[i - 1].getTime();
          expect(diff).toBe(60000); // 1 minute in milliseconds
        }

        // Verify timestamps align with bucket boundaries (15-minute)
        const timestamps15m = result15m.data.map((d) => new Date(d.timestamp));
        for (let i = 1; i < timestamps15m.length; i++) {
          const diff =
            timestamps15m[i].getTime() - timestamps15m[i - 1].getTime();
          expect(diff).toBe(900000); // 15 minutes in milliseconds
        }

        // Cleanup
        yield* teardownIntegrationTest(db);
      });

      await Effect.runPromise(Effect.provide(program, testLayer));
    }
  );

  it.skipIf(skipTests)(
    "handles gaps in time series data correctly",
    async () => {
      const baseTime = new Date("2024-01-20T12:00:00.000Z");
      const testData = createSparseTestData(baseTime);

      const program = Effect.gen(function* () {
        const db = yield* setupIntegrationTest();

        // Seed sparse test data
        yield* seedDatabase(db, testData.metrics);

        // Query with 5-minute granularity
        const result = yield* getConnectivityStatusHandler({
          urlParams: {
            startTime: baseTime.toISOString(),
            endTime: new Date(baseTime.getTime() + 30 * 60000).toISOString(),
            granularity: "5m",
          },
        });

        // Should return exactly 2 buckets (00:00-00:05 and 00:20-00:25)
        // QuestDB SAMPLE BY only returns buckets that have data
        expect(result.data).toHaveLength(testData.expectedBucketCount);

        // Each bucket has 10 records, all up (100% up, 0% down, 0% degraded)
        for (const dataPoint of result.data) {
          expect(dataPoint.upPercentage).toBe(100);
          expect(dataPoint.downPercentage).toBe(0);
          expect(dataPoint.degradedPercentage).toBe(0);
          expect(dataPoint.status).toBe("up");
        }

        // Overall uptime should be 100% (all 20 records are up)
        expect(result.meta.uptimePercentage).toBe(
          testData.expectedUptimePercentage
        );

        // Cleanup
        yield* teardownIntegrationTest(db);
      });

      await Effect.runPromise(Effect.provide(program, testLayer));
    }
  );
});
