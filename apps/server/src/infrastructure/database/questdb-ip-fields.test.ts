import type { NetworkMetric } from "@shared/metrics";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { ConfigServiceLive } from "@/infrastructure/config/config";
import { QuestDB, QuestDBLive } from "@/infrastructure/database/questdb";

describe("QuestDB IP Fields Schema Mapping", () => {
  const isQuestDBAvailable = process.env.QUESTDB_AVAILABLE === "true";

  it.skipIf(!isQuestDBAvailable)(
    "should persist and query externalIp and internalIp fields",
    async () => {
      const MainLive = Layer.merge(
        ConfigServiceLive,
        Layer.provide(QuestDBLive, ConfigServiceLive)
      );

      const testMetric: NetworkMetric = {
        timestamp: new Date(),
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
        const db = yield* QuestDB;

        // Wait for connection to be established
        yield* Effect.sleep("2000 millis");

        // Write metric with IP fields
        yield* db.writeMetric(testMetric);

        // Wait for ILP auto-flush and WAL apply
        yield* Effect.sleep("2000 millis");

        // Query metrics to verify IP fields are persisted and returned
        const startTime = new Date(testMetric.timestamp.getTime() - 60_000);
        const endTime = new Date(testMetric.timestamp.getTime() + 60_000);

        const metrics = yield* db.queryMetrics({
          startTime,
          endTime,
        });

        return metrics;
      });

      const result = await Effect.runPromise(Effect.provide(program, MainLive));

      // Verify we got results
      expect(result.length).toBeGreaterThan(0);

      // Find our test metric - filter by source, host, and timestamp proximity
      const testTimestamp = testMetric.timestamp.getTime();
      const speedtestMetrics = result.filter(
        (m) =>
          m.source === "speedtest" &&
          m.host === "speedtest.example.com" &&
          Math.abs(new Date(m.timestamp).getTime() - testTimestamp) < 10_000
      );
      expect(speedtestMetrics.length).toBeGreaterThan(0);

      const latestMetric = speedtestMetrics[speedtestMetrics.length - 1];

      // Verify IP fields are present and correct
      expect(latestMetric.external_ip).toBe("203.0.113.42");
      expect(latestMetric.internal_ip).toBe("192.168.1.100");

      // Verify other fields are also present
      expect(latestMetric.isp).toBe("Test ISP");
      expect(latestMetric.server_location).toBe("San Francisco, CA");
    }
  );

  it.skipIf(!isQuestDBAvailable)(
    "should handle metrics with missing IP fields gracefully",
    async () => {
      const MainLive = Layer.merge(
        ConfigServiceLive,
        Layer.provide(QuestDBLive, ConfigServiceLive)
      );

      const testMetric: NetworkMetric = {
        timestamp: new Date(),
        source: "ping",
        host: "8.8.8.8",
        latency: 10.2,
        packetLoss: 0,
        connectivityStatus: "up",
        // No IP fields provided
      };

      const program = Effect.gen(function* () {
        const db = yield* QuestDB;

        // Wait for connection to be established
        yield* Effect.sleep("2000 millis");

        // Write metric without IP fields
        yield* db.writeMetric(testMetric);

        // Wait for ILP auto-flush and WAL apply
        yield* Effect.sleep("2000 millis");

        // Query metrics
        const startTime = new Date(testMetric.timestamp.getTime() - 60_000);
        const endTime = new Date(testMetric.timestamp.getTime() + 60_000);

        const metrics = yield* db.queryMetrics({
          startTime,
          endTime,
        });

        return metrics;
      });

      const result = await Effect.runPromise(Effect.provide(program, MainLive));

      // Verify we got results
      expect(result.length).toBeGreaterThan(0);

      // Find our test metric - filter by source, host, and timestamp proximity
      const testTimestamp = testMetric.timestamp.getTime();
      const pingMetrics = result.filter(
        (m) =>
          m.source === "ping" &&
          m.host === "8.8.8.8" &&
          Math.abs(new Date(m.timestamp).getTime() - testTimestamp) < 10_000
      );
      expect(pingMetrics.length).toBeGreaterThan(0);

      const latestMetric = pingMetrics[pingMetrics.length - 1];

      // Verify IP fields are null/undefined when not provided (QuestDB returns null)
      expect(latestMetric.external_ip).toBeFalsy();
      expect(latestMetric.internal_ip).toBeFalsy();

      // Verify other fields are still present
      expect(latestMetric.host).toBe("8.8.8.8");
      expect(latestMetric.latency).toBeTypeOf("number");
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
