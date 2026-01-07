import type { NetworkMetric } from "@shared/metrics";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { seedDatabase } from "@/infrastructure/database/questdb/test-utils/seed";
import {
  createTestLayer,
  isQuestDBAvailable,
  setupIntegrationTest,
  teardownIntegrationTest,
} from "@/infrastructure/database/questdb/test-utils/setup";

describe("QuestDB IP Fields Schema Mapping", () => {
  const skipTests = !isQuestDBAvailable();
  const testLayer = createTestLayer();

  it.skipIf(skipTests)(
    "should persist and query externalIp and internalIp fields",
    async () => {
      const testMetric: NetworkMetric = {
        timestamp: new Date("2024-01-15T16:00:00Z"),
        source: "speedtest",
        host: "speedtest.example.com",
        latency: 15.5,
        jitter: 2.3,
        packetLoss: 0,
        downloadBandwidth: 100_000_000,
        uploadBandwidth: 50_000_000,
        connectivityStatus: "up",
        serverLocation: "San Francisco, CA",
        isp: "Test ISP",
        externalIp: "203.0.113.42",
        internalIp: "192.168.1.100",
      };

      const program = Effect.gen(function* () {
        const db = yield* setupIntegrationTest();

        // Seed the database with the test metric
        yield* seedDatabase(db, [testMetric]);

        // Query metrics to verify IP fields are persisted and returned
        const startTime = new Date(testMetric.timestamp.getTime() - 60_000);
        const endTime = new Date(testMetric.timestamp.getTime() + 60_000);

        const metrics = yield* db.queryMetrics({
          startTime,
          endTime,
        });

        // Verify we got results
        expect(metrics.length).toBeGreaterThan(0);

        // Find our test metric
        const speedtestMetrics = metrics.filter(
          (m) => m.source === "speedtest" && m.host === "speedtest.example.com"
        );
        expect(speedtestMetrics.length).toBeGreaterThan(0);

        const latestMetric = speedtestMetrics[0];

        // Verify IP fields are present and correct
        expect(latestMetric.external_ip).toBe("203.0.113.42");
        expect(latestMetric.internal_ip).toBe("192.168.1.100");

        // Verify other fields are also present
        expect(latestMetric.isp).toBe("Test ISP");
        expect(latestMetric.server_location).toBe("San Francisco, CA");

        // Cleanup
        yield* teardownIntegrationTest(db);

        return metrics;
      });

      await Effect.runPromise(Effect.provide(program, testLayer));
    }
  );

  it.skipIf(skipTests)(
    "should handle metrics with missing IP fields gracefully",
    async () => {
      const testMetric: NetworkMetric = {
        timestamp: new Date("2024-01-15T17:00:00Z"),
        source: "ping",
        host: "8.8.8.8",
        latency: 10.2,
        packetLoss: 0,
        connectivityStatus: "up",
        // No IP fields provided
      };

      const program = Effect.gen(function* () {
        const db = yield* setupIntegrationTest();

        // Seed the database with the test metric
        yield* seedDatabase(db, [testMetric]);

        // Query metrics
        const startTime = new Date(testMetric.timestamp.getTime() - 60_000);
        const endTime = new Date(testMetric.timestamp.getTime() + 60_000);

        const metrics = yield* db.queryMetrics({
          startTime,
          endTime,
        });

        // Verify we got results
        expect(metrics.length).toBeGreaterThan(0);

        // Find our test metric
        const pingMetrics = metrics.filter(
          (m) => m.source === "ping" && m.host === "8.8.8.8"
        );
        expect(pingMetrics.length).toBeGreaterThan(0);

        const latestMetric = pingMetrics[0];

        // Verify IP fields are undefined when not provided via ILP
        // QuestDB returns null for missing values, but the mapper converts null to undefined
        expect(latestMetric.external_ip).toBeUndefined();
        expect(latestMetric.internal_ip).toBeUndefined();

        // Verify other fields are still present
        expect(latestMetric.host).toBe("8.8.8.8");
        expect(latestMetric.latency).toBeTypeOf("number");

        // Cleanup
        yield* teardownIntegrationTest(db);

        return metrics;
      });

      await Effect.runPromise(Effect.provide(program, testLayer));
    }
  );

  it("should include IP fields in MetricRow type definition", () => {
    // Type-level test - this will fail at compile time if types are wrong
    const mockRow: import("@/infrastructure/database/questdb").MetricRow = {
      timestamp: new Date().toISOString(),
      source: "speedtest",
      host: "test.com",
      latency: 10,
      jitter: 2,
      packet_loss: 0,
      connectivity_status: "up",
      download_speed: 100,
      upload_speed: 50,
      server_location: "Test Location",
      isp: "Test ISP",
      external_ip: "203.0.113.1",
      internal_ip: "192.168.1.1",
    };

    // Verify the type includes IP fields
    expect(mockRow).toHaveProperty("external_ip");
    expect(mockRow).toHaveProperty("internal_ip");
  });
});
