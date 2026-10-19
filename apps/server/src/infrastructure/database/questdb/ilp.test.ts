import type { Sender } from "@questdb/nodejs-client";
import { NETWORK_METRICS_TABLE } from "@shared/db-schema";
import type { NetworkMetric } from "@shared/metrics";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { writeMetricToSender } from "@/infrastructure/database/questdb/ilp";

describe("ILP integration tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createMockSender = (): Sender => {
    const sender: Partial<Sender> = {};
    Object.assign(sender, {
      table: vi.fn(() => sender),
      symbol: vi.fn(() => sender),
      floatColumn: vi.fn(() => sender),
      intColumn: vi.fn(() => sender),
      stringColumn: vi.fn(() => sender),
      at: vi.fn(() => Promise.resolve()),
    });
    return sender as Sender;
  };

  describe("writeMetricToSender", () => {
    it("should write complete ping metric with all fields", async () => {
      const sender = createMockSender();
      const metric: NetworkMetric = {
        timestamp: new Date("2024-01-01T12:00:00.000Z"),
        source: "ping",
        host: "8.8.8.8",
        latency: 15.5,
        jitter: 2.1,
        packetLoss: 0.5,
        connectivityStatus: "up",
      };

      await writeMetricToSender(sender, metric, NETWORK_METRICS_TABLE);

      expect(sender.table).toHaveBeenCalledWith("network_metrics");
      expect(sender.symbol).toHaveBeenCalledWith("source", "ping");
      expect(sender.symbol).toHaveBeenCalledWith("host", "8.8.8.8");
      expect(sender.floatColumn).toHaveBeenCalledWith("latency", 15.5);
      expect(sender.floatColumn).toHaveBeenCalledWith("jitter", 2.1);
      expect(sender.floatColumn).toHaveBeenCalledWith("packet_loss", 0.5);
      expect(sender.stringColumn).toHaveBeenCalledWith(
        "connectivity_status",
        "up"
      );
      expect(sender.at).toHaveBeenCalledWith(
        BigInt(1704110400000) * 1_000_000n,
        "ns"
      );
    });

    it("should write complete speedtest metric with all fields", async () => {
      const sender = createMockSender();
      const metric: NetworkMetric = {
        timestamp: new Date("2024-01-01T12:00:00.000Z"),
        source: "speedtest",
        latency: 20.3,
        jitter: 3.5,
        downloadBandwidth: 100_000_000,
        uploadBandwidth: 50_000_000,
        serverLocation: "Test Location",
        isp: "Test ISP",
        externalIp: "1.2.3.4",
        internalIp: "192.168.1.100",
      };

      await writeMetricToSender(sender, metric, NETWORK_METRICS_TABLE);

      expect(sender.table).toHaveBeenCalledWith("network_metrics");
      expect(sender.symbol).toHaveBeenCalledWith("source", "speedtest");
      expect(sender.floatColumn).toHaveBeenCalledWith("latency", 20.3);
      expect(sender.floatColumn).toHaveBeenCalledWith("jitter", 3.5);
      expect(sender.intColumn).toHaveBeenCalledWith(
        "download_bandwidth",
        100_000_000
      );
      expect(sender.intColumn).toHaveBeenCalledWith(
        "upload_bandwidth",
        50_000_000
      );
      expect(sender.stringColumn).toHaveBeenCalledWith(
        "server_location",
        "Test Location"
      );
      expect(sender.stringColumn).toHaveBeenCalledWith("isp", "Test ISP");
      expect(sender.stringColumn).toHaveBeenCalledWith(
        "external_ip",
        "1.2.3.4"
      );
      expect(sender.stringColumn).toHaveBeenCalledWith(
        "internal_ip",
        "192.168.1.100"
      );
      expect(sender.at).toHaveBeenCalled();
    });

    it("should handle minimal ping metric with only required fields", async () => {
      const sender = createMockSender();
      const metric: NetworkMetric = {
        timestamp: new Date("2024-01-01T12:00:00.000Z"),
        source: "ping",
      };

      await writeMetricToSender(sender, metric, NETWORK_METRICS_TABLE);

      expect(sender.table).toHaveBeenCalledWith("network_metrics");
      expect(sender.symbol).toHaveBeenCalledWith("source", "ping");
      expect(sender.at).toHaveBeenCalled();

      expect(sender.floatColumn).not.toHaveBeenCalled();
      expect(sender.intColumn).not.toHaveBeenCalled();
    });

    it("should skip undefined host field", async () => {
      const sender = createMockSender();
      const metric: NetworkMetric = {
        timestamp: new Date("2024-01-01T12:00:00.000Z"),
        source: "speedtest",
        latency: 15.5,
      };

      await writeMetricToSender(sender, metric, NETWORK_METRICS_TABLE);

      expect(sender.symbol).toHaveBeenCalledWith("source", "speedtest");
      expect(sender.symbol).not.toHaveBeenCalledWith("host", expect.anything());
      expect(sender.floatColumn).toHaveBeenCalledWith("latency", 15.5);
    });

    it("should skip undefined latency field", async () => {
      const sender = createMockSender();
      const metric: NetworkMetric = {
        timestamp: new Date("2024-01-01T12:00:00.000Z"),
        source: "ping",
        host: "8.8.8.8",
      };

      await writeMetricToSender(sender, metric, NETWORK_METRICS_TABLE);

      expect(sender.symbol).toHaveBeenCalledWith("source", "ping");
      expect(sender.floatColumn).not.toHaveBeenCalledWith(
        "latency",
        expect.anything()
      );
    });

    it("should skip undefined jitter field", async () => {
      const sender = createMockSender();
      const metric: NetworkMetric = {
        timestamp: new Date("2024-01-01T12:00:00.000Z"),
        source: "ping",
        latency: 15.5,
      };

      await writeMetricToSender(sender, metric, NETWORK_METRICS_TABLE);

      expect(sender.floatColumn).toHaveBeenCalledWith("latency", 15.5);
      expect(sender.floatColumn).not.toHaveBeenCalledWith(
        "jitter",
        expect.anything()
      );
    });

    it("should skip undefined packetLoss field", async () => {
      const sender = createMockSender();
      const metric: NetworkMetric = {
        timestamp: new Date("2024-01-01T12:00:00.000Z"),
        source: "ping",
        latency: 15.5,
      };

      await writeMetricToSender(sender, metric, NETWORK_METRICS_TABLE);

      expect(sender.floatColumn).not.toHaveBeenCalledWith(
        "packet_loss",
        expect.anything()
      );
    });

    it("should skip undefined connectivityStatus field", async () => {
      const sender = createMockSender();
      const metric: NetworkMetric = {
        timestamp: new Date("2024-01-01T12:00:00.000Z"),
        source: "ping",
        latency: 15.5,
      };

      await writeMetricToSender(sender, metric, NETWORK_METRICS_TABLE);

      expect(sender.stringColumn).not.toHaveBeenCalledWith(
        "connectivity_status",
        expect.anything()
      );
    });

    it("should write the ping duration as a float column", async () => {
      const sender = createMockSender();

      await writeMetricToSender(
        sender,
        {
          timestamp: new Date("2024-01-01T12:00:00.000Z"),
          source: "ping",
          host: "8.8.8.8",
          durationMs: 2412.5,
        },
        NETWORK_METRICS_TABLE
      );

      expect(sender.floatColumn).toHaveBeenCalledWith("duration_ms", 2412.5);
    });

    it("should write a zero duration rather than skip it", async () => {
      const sender = createMockSender();

      await writeMetricToSender(
        sender,
        {
          timestamp: new Date("2024-01-01T12:00:00.000Z"),
          source: "ping",
          host: "8.8.8.8",
          durationMs: 0,
        },
        NETWORK_METRICS_TABLE
      );

      expect(sender.floatColumn).toHaveBeenCalledWith("duration_ms", 0);
    });

    it("should write no duration column when the metric has none", async () => {
      const sender = createMockSender();

      await writeMetricToSender(
        sender,
        {
          timestamp: new Date("2024-01-01T12:00:00.000Z"),
          source: "speedtest",
          downloadBandwidth: 1,
        },
        NETWORK_METRICS_TABLE
      );

      expect(sender.floatColumn).not.toHaveBeenCalledWith(
        "duration_ms",
        expect.anything()
      );
    });

    it("should skip undefined downloadBandwidth field", async () => {
      const sender = createMockSender();
      const metric: NetworkMetric = {
        timestamp: new Date("2024-01-01T12:00:00.000Z"),
        source: "speedtest",
        uploadBandwidth: 50_000_000,
      };

      await writeMetricToSender(sender, metric, NETWORK_METRICS_TABLE);

      expect(sender.intColumn).toHaveBeenCalledWith(
        "upload_bandwidth",
        50_000_000
      );
      expect(sender.intColumn).not.toHaveBeenCalledWith(
        "download_bandwidth",
        expect.anything()
      );
    });

    it("should skip undefined uploadBandwidth field", async () => {
      const sender = createMockSender();
      const metric: NetworkMetric = {
        timestamp: new Date("2024-01-01T12:00:00.000Z"),
        source: "speedtest",
        downloadBandwidth: 100_000_000,
      };

      await writeMetricToSender(sender, metric, NETWORK_METRICS_TABLE);

      expect(sender.intColumn).toHaveBeenCalledWith(
        "download_bandwidth",
        100_000_000
      );
      expect(sender.intColumn).not.toHaveBeenCalledWith(
        "upload_bandwidth",
        expect.anything()
      );
    });

    it("should skip undefined serverLocation field", async () => {
      const sender = createMockSender();
      const metric: NetworkMetric = {
        timestamp: new Date("2024-01-01T12:00:00.000Z"),
        source: "speedtest",
        isp: "Test ISP",
      };

      await writeMetricToSender(sender, metric, NETWORK_METRICS_TABLE);

      expect(sender.stringColumn).toHaveBeenCalledWith("isp", "Test ISP");
      expect(sender.stringColumn).not.toHaveBeenCalledWith(
        "server_location",
        expect.anything()
      );
    });

    it("should skip undefined isp field", async () => {
      const sender = createMockSender();
      const metric: NetworkMetric = {
        timestamp: new Date("2024-01-01T12:00:00.000Z"),
        source: "speedtest",
        serverLocation: "Test Location",
      };

      await writeMetricToSender(sender, metric, NETWORK_METRICS_TABLE);

      expect(sender.stringColumn).toHaveBeenCalledWith(
        "server_location",
        "Test Location"
      );
      expect(sender.stringColumn).not.toHaveBeenCalledWith(
        "isp",
        expect.anything()
      );
    });

    it("should skip undefined externalIp field", async () => {
      const sender = createMockSender();
      const metric: NetworkMetric = {
        timestamp: new Date("2024-01-01T12:00:00.000Z"),
        source: "speedtest",
        internalIp: "192.168.1.100",
      };

      await writeMetricToSender(sender, metric, NETWORK_METRICS_TABLE);

      expect(sender.stringColumn).toHaveBeenCalledWith(
        "internal_ip",
        "192.168.1.100"
      );
      expect(sender.stringColumn).not.toHaveBeenCalledWith(
        "external_ip",
        expect.anything()
      );
    });

    it("should skip undefined internalIp field", async () => {
      const sender = createMockSender();
      const metric: NetworkMetric = {
        timestamp: new Date("2024-01-01T12:00:00.000Z"),
        source: "speedtest",
        externalIp: "1.2.3.4",
      };

      await writeMetricToSender(sender, metric, NETWORK_METRICS_TABLE);

      expect(sender.stringColumn).toHaveBeenCalledWith(
        "external_ip",
        "1.2.3.4"
      );
      expect(sender.stringColumn).not.toHaveBeenCalledWith(
        "internal_ip",
        expect.anything()
      );
    });

    it("should handle zero values correctly", async () => {
      const sender = createMockSender();
      const metric: NetworkMetric = {
        timestamp: new Date("2024-01-01T12:00:00.000Z"),
        source: "ping",
        latency: 0,
        jitter: 0,
        packetLoss: 0,
      };

      await writeMetricToSender(sender, metric, NETWORK_METRICS_TABLE);

      expect(sender.floatColumn).toHaveBeenCalledWith("latency", 0);
      expect(sender.floatColumn).toHaveBeenCalledWith("jitter", 0);
      expect(sender.floatColumn).toHaveBeenCalledWith("packet_loss", 0);
    });

    it("should convert timestamp to nanoseconds correctly", async () => {
      const sender = createMockSender();
      const timestamp = new Date("2024-01-01T12:00:00.000Z");
      const metric: NetworkMetric = {
        timestamp,
        source: "ping",
      };

      await writeMetricToSender(sender, metric, NETWORK_METRICS_TABLE);

      const expectedNanos = BigInt(timestamp.getTime()) * 1_000_000n;
      expect(sender.at).toHaveBeenCalledWith(expectedNanos, "ns");
    });

    it("should handle metric with mixed optional and required fields", async () => {
      const sender = createMockSender();
      const metric: NetworkMetric = {
        timestamp: new Date("2024-01-01T12:00:00.000Z"),
        source: "ping",
        host: "1.1.1.1",
        latency: 10.5,
        connectivityStatus: "degraded",
      };

      await writeMetricToSender(sender, metric, NETWORK_METRICS_TABLE);

      expect(sender.symbol).toHaveBeenCalledWith("source", "ping");
      expect(sender.symbol).toHaveBeenCalledWith("host", "1.1.1.1");
      expect(sender.floatColumn).toHaveBeenCalledWith("latency", 10.5);
      expect(sender.stringColumn).toHaveBeenCalledWith(
        "connectivity_status",
        "degraded"
      );
      expect(sender.floatColumn).not.toHaveBeenCalledWith(
        "jitter",
        expect.anything()
      );
      expect(sender.floatColumn).not.toHaveBeenCalledWith(
        "packet_loss",
        expect.anything()
      );
    });

    it("should write to a custom table when one is provided", async () => {
      const sender = createMockSender();
      const metric: NetworkMetric = {
        timestamp: new Date("2024-01-01T12:00:00.000Z"),
        source: "ping",
      };

      await writeMetricToSender(sender, metric, "network_metrics_test_2");

      expect(sender.table).toHaveBeenCalledWith("network_metrics_test_2");
      expect(sender.table).not.toHaveBeenCalledWith("network_metrics");
    });

    it("should reject when the sender fails to flush the row", async () => {
      const sender = createMockSender();
      const flushError = new Error("connect ECONNREFUSED 127.0.0.1:9000");
      vi.mocked(sender.at).mockRejectedValueOnce(flushError);
      const metric: NetworkMetric = {
        timestamp: new Date("2024-01-01T12:00:00.000Z"),
        source: "ping",
      };

      await expect(
        writeMetricToSender(sender, metric, NETWORK_METRICS_TABLE)
      ).rejects.toBe(flushError);
    });

    it("should chain sender calls in correct order", async () => {
      const sender = createMockSender();
      const metric: NetworkMetric = {
        timestamp: new Date("2024-01-01T12:00:00.000Z"),
        source: "ping",
        host: "8.8.8.8",
        latency: 15.5,
      };

      await writeMetricToSender(sender, metric, NETWORK_METRICS_TABLE);

      const callOrder = vi.mocked(sender.table).mock.invocationCallOrder[0];
      expect(callOrder).toBeLessThan(
        vi.mocked(sender.symbol).mock.invocationCallOrder[0]
      );
      expect(vi.mocked(sender.symbol).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(sender.at).mock.invocationCallOrder[0]
      );
    });
  });
});
