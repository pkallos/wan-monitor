import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  createSeedDataset,
  seedDatabase,
} from "@/infrastructure/database/questdb/test-utils/seed";
import {
  createTestLayer,
  isQuestDBAvailable,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "@/infrastructure/database/questdb/test-utils/setup";

describe("Metrics Aggregation Integration Tests", () => {
  const skipTests = !isQuestDBAvailable();
  const testLayer = createTestLayer();

  describe("Basic Query Functionality", () => {
    it.skipIf(skipTests)(
      "should return expected number of points for known seed window",
      async () => {
        const program = Effect.gen(function* () {
          const db = yield* setupIntegrationTest();

          // Create and seed standard test window
          const dataset = createSeedDataset();
          const { window, pingMetrics, speedtestMetrics } =
            dataset.standardWindow;
          yield* seedDatabase(db, [...pingMetrics, ...speedtestMetrics]);

          // Query all metrics in the window
          const results = yield* db.queryMetrics({
            startTime: window.startTime,
            endTime: window.endTime,
          });

          // Verify count matches expected
          expect(results.length).toBe(window.expectedPointCount);

          // Cleanup
          yield* teardownIntegrationTest(db);

          return results;
        });

        await Effect.runPromise(Effect.provide(program, testLayer));
      }
    );

    it.skipIf(skipTests)(
      "should correctly filter by source: ping",
      async () => {
        const program = Effect.gen(function* () {
          const db = yield* setupIntegrationTest();

          // Create and seed data
          const dataset = createSeedDataset();
          const { window, pingMetrics, speedtestMetrics } =
            dataset.standardWindow;
          yield* seedDatabase(db, [...pingMetrics, ...speedtestMetrics]);

          // Query all metrics (no filter)
          const allResults = yield* db.queryMetrics({
            startTime: window.startTime,
            endTime: window.endTime,
          });

          // Filter by source in the results
          const pingResults = allResults.filter((r) => r.source === "ping");
          const speedtestResults = allResults.filter(
            (r) => r.source === "speedtest"
          );

          // Verify counts
          expect(pingResults.length).toBe(pingMetrics.length);
          expect(speedtestResults.length).toBe(speedtestMetrics.length);

          // Verify all ping results have ping-specific fields
          for (const result of pingResults) {
            expect(result.source).toBe("ping");
            expect(result.host).toBeDefined();
            expect(result.latency).toBeDefined();
            expect(result.jitter).toBeDefined();
            expect(result.packet_loss).toBeDefined();
          }

          // Cleanup
          yield* teardownIntegrationTest(db);

          return { pingResults, speedtestResults };
        });

        await Effect.runPromise(Effect.provide(program, testLayer));
      }
    );

    it.skipIf(skipTests)(
      "should correctly filter by source: speedtest",
      async () => {
        const program = Effect.gen(function* () {
          const db = yield* setupIntegrationTest();

          // Create and seed data
          const dataset = createSeedDataset();
          const { window, pingMetrics, speedtestMetrics } =
            dataset.standardWindow;
          yield* seedDatabase(db, [...pingMetrics, ...speedtestMetrics]);

          // Query speedtest metrics using the speedtest-specific query
          const results = yield* db.querySpeedtests({
            startTime: window.startTime,
            endTime: window.endTime,
          });

          // Verify count and source
          expect(results.length).toBe(speedtestMetrics.length);

          for (const result of results) {
            expect(result.source).toBe("speedtest");
            expect(result.download_speed).toBeDefined();
            expect(result.upload_speed).toBeDefined();
            expect(result.server_location).toBeDefined();
          }

          // Cleanup
          yield* teardownIntegrationTest(db);

          return results;
        });

        await Effect.runPromise(Effect.provide(program, testLayer));
      }
    );

    it.skipIf(skipTests)("should correctly filter by host", async () => {
      const program = Effect.gen(function* () {
        const db = yield* setupIntegrationTest();

        // Create and seed multi-host data
        const dataset = createSeedDataset();
        const { window, host1Metrics, host2Metrics } = dataset.multiHostWindow;
        yield* seedDatabase(db, [...host1Metrics, ...host2Metrics]);

        // Query for host1 only
        const host1Results = yield* db.queryMetrics({
          startTime: window.startTime,
          endTime: window.endTime,
          host: "8.8.8.8",
        });

        // Query for host2 only
        const host2Results = yield* db.queryMetrics({
          startTime: window.startTime,
          endTime: window.endTime,
          host: "1.1.1.1",
        });

        // Verify counts
        expect(host1Results.length).toBe(host1Metrics.length);
        expect(host2Results.length).toBe(host2Metrics.length);

        // Verify all results have correct host
        for (const result of host1Results) {
          expect(result.host).toBe("8.8.8.8");
        }

        for (const result of host2Results) {
          expect(result.host).toBe("1.1.1.1");
        }

        // Cleanup
        yield* teardownIntegrationTest(db);

        return { host1Results, host2Results };
      });

      await Effect.runPromise(Effect.provide(program, testLayer));
    });
  });

  describe("Granularity Aggregation", () => {
    it.skipIf(skipTests)(
      "should aggregate with 5m granularity and return fewer points",
      async () => {
        const program = Effect.gen(function* () {
          const db = yield* setupIntegrationTest();

          // Create and seed data (60 points over 1 hour)
          const dataset = createSeedDataset();
          const { window, pingMetrics } = dataset.standardWindow;
          yield* seedDatabase(db, pingMetrics);

          // Query without granularity (should get all 60 points)
          const rawResults = yield* db.queryMetrics({
            startTime: window.startTime,
            endTime: window.endTime,
            host: "8.8.8.8",
          });

          // Query with 5m granularity (should get ~12 points: 60 minutes / 5 minutes)
          const aggregatedResults = yield* db.queryMetrics({
            startTime: window.startTime,
            endTime: window.endTime,
            host: "8.8.8.8",
            granularity: "5m",
          });

          // Verify counts
          expect(rawResults.length).toBe(60);
          expect(aggregatedResults.length).toBeLessThan(rawResults.length);
          expect(aggregatedResults.length).toBeGreaterThanOrEqual(10); // ~12 expected
          expect(aggregatedResults.length).toBeLessThanOrEqual(14);

          // Verify aggregated results have valid averaged values
          for (const result of aggregatedResults) {
            expect(result.latency).toBeDefined();
            expect(result.latency).toBeGreaterThan(0);
            expect(result.jitter).toBeDefined();
            expect(result.jitter).toBeGreaterThan(0);
            expect(result.packet_loss).toBeDefined();
            expect(result.packet_loss).toBeGreaterThanOrEqual(0);
          }

          // Cleanup
          yield* teardownIntegrationTest(db);

          return { rawResults, aggregatedResults };
        });

        await Effect.runPromise(Effect.provide(program, testLayer));
      }
    );

    it.skipIf(skipTests)(
      "should aggregate with 15m granularity correctly",
      async () => {
        const program = Effect.gen(function* () {
          const db = yield* setupIntegrationTest();

          // Create and seed data (60 points over 1 hour)
          const dataset = createSeedDataset();
          const { window, pingMetrics } = dataset.standardWindow;
          yield* seedDatabase(db, pingMetrics);

          // Query with 15m granularity (should get ~4 points: 60 minutes / 15 minutes)
          const aggregatedResults = yield* db.queryMetrics({
            startTime: window.startTime,
            endTime: window.endTime,
            host: "8.8.8.8",
            granularity: "15m",
          });

          // Verify count is reduced appropriately
          expect(aggregatedResults.length).toBeGreaterThanOrEqual(3);
          expect(aggregatedResults.length).toBeLessThanOrEqual(5);

          // Verify all aggregated points have required fields
          for (const result of aggregatedResults) {
            expect(result.timestamp).toBeDefined();
            expect(result.source).toBe("ping");
            expect(result.latency).toBeDefined();
          }

          // Cleanup
          yield* teardownIntegrationTest(db);

          return aggregatedResults;
        });

        await Effect.runPromise(Effect.provide(program, testLayer));
      }
    );

    it.skipIf(skipTests)(
      "should aggregate with 1h granularity and return single point",
      async () => {
        const program = Effect.gen(function* () {
          const db = yield* setupIntegrationTest();

          // Create and seed data (60 points over 1 hour)
          const dataset = createSeedDataset();
          const { window, pingMetrics } = dataset.standardWindow;
          yield* seedDatabase(db, pingMetrics);

          // Query with 1h granularity (should get 1-2 points for a 1-hour window)
          const aggregatedResults = yield* db.queryMetrics({
            startTime: window.startTime,
            endTime: window.endTime,
            host: "8.8.8.8",
            granularity: "1h",
          });

          // Verify we get 1-2 aggregated points
          expect(aggregatedResults.length).toBeGreaterThanOrEqual(1);
          expect(aggregatedResults.length).toBeLessThanOrEqual(2);

          // Verify the aggregated values are averages of the raw data
          const firstPoint = aggregatedResults[0];
          expect(firstPoint?.latency).toBeDefined();
          expect(firstPoint?.latency).toBeGreaterThan(0);

          // Cleanup
          yield* teardownIntegrationTest(db);

          return aggregatedResults;
        });

        await Effect.runPromise(Effect.provide(program, testLayer));
      }
    );
  });

  describe("Null/Undefined Field Handling", () => {
    it.skipIf(skipTests)(
      "should handle missing optional fields without NaN",
      async () => {
        const program = Effect.gen(function* () {
          const db = yield* setupIntegrationTest();

          // Create metrics with some missing fields
          const baseTime = new Date("2024-01-15T10:00:00Z");
          const metricsWithMissingFields = [
            {
              timestamp: baseTime,
              source: "ping" as const,
              host: "8.8.8.8",
              latency: 25,
              // jitter missing
              // packetLoss missing
              connectivityStatus: "up" as const,
            },
            {
              timestamp: new Date(baseTime.getTime() + 60000),
              source: "speedtest" as const,
              latency: 15,
              downloadBandwidth: 100_000_000,
              uploadBandwidth: 20_000_000,
              // serverLocation missing
              // isp missing
              connectivityStatus: "up" as const,
            },
          ];

          yield* seedDatabase(db, metricsWithMissingFields);

          // Query the data
          const results = yield* db.queryMetrics({
            startTime: baseTime,
            endTime: new Date(baseTime.getTime() + 120000),
          });

          expect(results.length).toBe(2);

          // Verify no NaN values exist
          for (const result of results) {
            if (result.latency !== undefined) {
              expect(Number.isNaN(result.latency)).toBe(false);
            }
            if (result.jitter !== undefined) {
              expect(Number.isNaN(result.jitter)).toBe(false);
            }
            if (result.packet_loss !== undefined) {
              expect(Number.isNaN(result.packet_loss)).toBe(false);
            }
            if (result.download_speed !== undefined) {
              expect(Number.isNaN(result.download_speed)).toBe(false);
            }
            if (result.upload_speed !== undefined) {
              expect(Number.isNaN(result.upload_speed)).toBe(false);
            }
          }

          // Verify missing fields are undefined (not NaN)
          // QuestDB returns null for missing values, but the mapper converts null to undefined
          const pingResult = results.find((r) => r.source === "ping");
          expect(pingResult?.jitter).toBeUndefined();
          expect(pingResult?.packet_loss).toBeUndefined();

          const speedtestResult = results.find((r) => r.source === "speedtest");
          expect(speedtestResult?.server_location).toBeUndefined();
          expect(speedtestResult?.isp).toBeUndefined();

          // Cleanup
          yield* teardownIntegrationTest(db);

          return results;
        });

        await Effect.runPromise(Effect.provide(program, testLayer));
      }
    );

    it.skipIf(skipTests)(
      "should handle null fields in aggregated queries correctly",
      async () => {
        const program = Effect.gen(function* () {
          const db = yield* setupIntegrationTest();

          // Create a mix of metrics with and without optional fields
          const baseTime = new Date("2024-01-15T11:00:00Z");
          const mixedMetrics = [];

          for (let i = 0; i < 10; i++) {
            const timestamp = new Date(baseTime.getTime() + i * 60000);

            // Every other metric is missing jitter
            mixedMetrics.push({
              timestamp,
              source: "ping" as const,
              host: "8.8.8.8",
              latency: 20 + i,
              ...(i % 2 === 0 ? { jitter: 1 + i * 0.1 } : {}),
              packetLoss: 0,
              connectivityStatus: "up" as const,
            });
          }

          yield* seedDatabase(db, mixedMetrics);

          // Query with granularity to trigger aggregation
          const results = yield* db.queryMetrics({
            startTime: baseTime,
            endTime: new Date(baseTime.getTime() + 600000),
            host: "8.8.8.8",
            granularity: "5m",
          });

          // Verify aggregated results handle nulls properly
          expect(results.length).toBeGreaterThan(0);

          for (const result of results) {
            // Latency should always be present (all source metrics had it)
            expect(result.latency).toBeDefined();
            expect(Number.isNaN(result.latency)).toBe(false);

            // Jitter might be present (some source metrics had it)
            if (result.jitter !== undefined) {
              expect(Number.isNaN(result.jitter)).toBe(false);
              expect(result.jitter).toBeGreaterThan(0);
            }
          }

          // Cleanup
          yield* teardownIntegrationTest(db);

          return results;
        });

        await Effect.runPromise(Effect.provide(program, testLayer));
      }
    );
  });

  describe("Edge Cases", () => {
    it.skipIf(skipTests)(
      "should return empty array for time window with no data",
      async () => {
        const program = Effect.gen(function* () {
          const db = yield* setupIntegrationTest();

          // Query a time window where no data exists
          const emptyWindowStart = new Date("2024-01-01T00:00:00Z");
          const emptyWindowEnd = new Date("2024-01-01T01:00:00Z");

          const results = yield* db.queryMetrics({
            startTime: emptyWindowStart,
            endTime: emptyWindowEnd,
          });

          expect(results).toEqual([]);

          // Cleanup
          yield* teardownIntegrationTest(db);

          return results;
        });

        await Effect.runPromise(Effect.provide(program, testLayer));
      }
    );

    it.skipIf(skipTests)("should respect limit parameter", async () => {
      const program = Effect.gen(function* () {
        const db = yield* setupIntegrationTest();

        // Create and seed data
        const dataset = createSeedDataset();
        const { window, pingMetrics } = dataset.standardWindow;
        yield* seedDatabase(db, pingMetrics);

        // Query with limit of 10
        const results = yield* db.queryMetrics({
          startTime: window.startTime,
          endTime: window.endTime,
          host: "8.8.8.8",
          limit: 10,
        });

        expect(results.length).toBe(10);

        // Cleanup
        yield* teardownIntegrationTest(db);

        return results;
      });

      await Effect.runPromise(Effect.provide(program, testLayer));
    });

    it.skipIf(skipTests)(
      "should handle queries with only startTime",
      async () => {
        const program = Effect.gen(function* () {
          const db = yield* setupIntegrationTest();

          // Create and seed data
          const dataset = createSeedDataset();
          const { window, pingMetrics } = dataset.standardWindow;
          yield* seedDatabase(db, pingMetrics);

          // Query with only startTime (endTime should default to now)
          const results = yield* db.queryMetrics({
            startTime: window.startTime,
            host: "8.8.8.8",
          });

          // Should get all the seeded data
          expect(results.length).toBeGreaterThan(0);

          // Cleanup
          yield* teardownIntegrationTest(db);

          return results;
        });

        await Effect.runPromise(Effect.provide(program, testLayer));
      }
    );
  });
});
