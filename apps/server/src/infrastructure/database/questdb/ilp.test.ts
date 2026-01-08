import type { Sender } from "@questdb/nodejs-client";
import type { NetworkMetric } from "@shared/metrics";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { writeMetricToSender } from "@/infrastructure/database/questdb/ilp";

describe("ILP integration tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createMockSender = () => {
    const mock = {
      table: vi.fn().mockReturnThis(),
      symbol: vi.fn().mockReturnThis(),
      floatColumn: vi.fn().mockReturnThis(),
      intColumn: vi.fn().mockReturnThis(),
      stringColumn: vi.fn().mockReturnThis(),
      at: vi.fn().mockReturnThis(),
    };
    return mock as unknown as Sender;
  };

  describe("writeMetricToSender", () => {
    it("should write complete ping metric with all fields", () => {
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

      writeMetricToSender(sender, metric);

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

    it("should write complete speedtest metric with all fields", () => {
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

      writeMetricToSender(sender, metric);

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

    it("should handle minimal ping metric with only required fields", () => {
      const sender = createMockSender();
      const metric: NetworkMetric = {
        timestamp: new Date("2024-01-01T12:00:00.000Z"),
        source: "ping",
      };

      writeMetricToSender(sender, metric);

      expect(sender.table).toHaveBeenCalledWith("network_metrics");
      expect(sender.symbol).toHaveBeenCalledWith("source", "ping");
      expect(sender.at).toHaveBeenCalled();

      expect(sender.floatColumn).not.toHaveBeenCalled();
      expect(sender.intColumn).not.toHaveBeenCalled();
    });

    it("should skip undefined host field", () => {
      const sender = createMockSender();
      const metric: NetworkMetric = {
        timestamp: new Date("2024-01-01T12:00:00.000Z"),
        source: "speedtest",
        latency: 15.5,
      };

      writeMetricToSender(sender, metric);

      expect(sender.symbol).toHaveBeenCalledWith("source", "speedtest");
      expect(sender.symbol).not.toHaveBeenCalledWith("host", expect.anything());
      expect(sender.floatColumn).toHaveBeenCalledWith("latency", 15.5);
    });

    it("should skip undefined latency field", () => {
      const sender = createMockSender();
      const metric: NetworkMetric = {
        timestamp: new Date("2024-01-01T12:00:00.000Z"),
        source: "ping",
        host: "8.8.8.8",
      };

      writeMetricToSender(sender, metric);

      expect(sender.symbol).toHaveBeenCalledWith("source", "ping");
      expect(sender.floatColumn).not.toHaveBeenCalledWith(
        "latency",
        expect.anything()
      );
    });

    it("should skip undefined jitter field", () => {
      const sender = createMockSender();
      const metric: NetworkMetric = {
        timestamp: new Date("2024-01-01T12:00:00.000Z"),
        source: "ping",
        latency: 15.5,
      };

      writeMetricToSender(sender, metric);

      expect(sender.floatColumn).toHaveBeenCalledWith("latency", 15.5);
      expect(sender.floatColumn).not.toHaveBeenCalledWith(
        "jitter",
        expect.anything()
      );
    });

    it("should skip undefined packetLoss field", () => {
      const sender = createMockSender();
      const metric: NetworkMetric = {
        timestamp: new Date("2024-01-01T12:00:00.000Z"),
        source: "ping",
        latency: 15.5,
      };

      writeMetricToSender(sender, metric);

      expect(sender.floatColumn).not.toHaveBeenCalledWith(
        "packet_loss",
        expect.anything()
      );
    });

    it("should skip undefined connectivityStatus field", () => {
      const sender = createMockSender();
      const metric: NetworkMetric = {
        timestamp: new Date("2024-01-01T12:00:00.000Z"),
        source: "ping",
        latency: 15.5,
      };

      writeMetricToSender(sender, metric);

      expect(sender.stringColumn).not.toHaveBeenCalledWith(
        "connectivity_status",
        expect.anything()
      );
    });

    it("should skip undefined downloadBandwidth field", () => {
      const sender = createMockSender();
      const metric: NetworkMetric = {
        timestamp: new Date("2024-01-01T12:00:00.000Z"),
        source: "speedtest",
        uploadBandwidth: 50_000_000,
      };

      writeMetricToSender(sender, metric);

      expect(sender.intColumn).toHaveBeenCalledWith(
        "upload_bandwidth",
        50_000_000
      );
      expect(sender.intColumn).not.toHaveBeenCalledWith(
        "download_bandwidth",
        expect.anything()
      );
    });

    it("should skip undefined uploadBandwidth field", () => {
      const sender = createMockSender();
      const metric: NetworkMetric = {
        timestamp: new Date("2024-01-01T12:00:00.000Z"),
        source: "speedtest",
        downloadBandwidth: 100_000_000,
      };

      writeMetricToSender(sender, metric);

      expect(sender.intColumn).toHaveBeenCalledWith(
        "download_bandwidth",
        100_000_000
      );
      expect(sender.intColumn).not.toHaveBeenCalledWith(
        "upload_bandwidth",
        expect.anything()
      );
    });

    it("should skip undefined serverLocation field", () => {
      const sender = createMockSender();
      const metric: NetworkMetric = {
        timestamp: new Date("2024-01-01T12:00:00.000Z"),
        source: "speedtest",
        isp: "Test ISP",
      };

      writeMetricToSender(sender, metric);

      expect(sender.stringColumn).toHaveBeenCalledWith("isp", "Test ISP");
      expect(sender.stringColumn).not.toHaveBeenCalledWith(
        "server_location",
        expect.anything()
      );
    });

    it("should skip undefined isp field", () => {
      const sender = createMockSender();
      const metric: NetworkMetric = {
        timestamp: new Date("2024-01-01T12:00:00.000Z"),
        source: "speedtest",
        serverLocation: "Test Location",
      };

      writeMetricToSender(sender, metric);

      expect(sender.stringColumn).toHaveBeenCalledWith(
        "server_location",
        "Test Location"
      );
      expect(sender.stringColumn).not.toHaveBeenCalledWith(
        "isp",
        expect.anything()
      );
    });

    it("should skip undefined externalIp field", () => {
      const sender = createMockSender();
      const metric: NetworkMetric = {
        timestamp: new Date("2024-01-01T12:00:00.000Z"),
        source: "speedtest",
        internalIp: "192.168.1.100",
      };

      writeMetricToSender(sender, metric);

      expect(sender.stringColumn).toHaveBeenCalledWith(
        "internal_ip",
        "192.168.1.100"
      );
      expect(sender.stringColumn).not.toHaveBeenCalledWith(
        "external_ip",
        expect.anything()
      );
    });

    it("should skip undefined internalIp field", () => {
      const sender = createMockSender();
      const metric: NetworkMetric = {
        timestamp: new Date("2024-01-01T12:00:00.000Z"),
        source: "speedtest",
        externalIp: "1.2.3.4",
      };

      writeMetricToSender(sender, metric);

      expect(sender.stringColumn).toHaveBeenCalledWith(
        "external_ip",
        "1.2.3.4"
      );
      expect(sender.stringColumn).not.toHaveBeenCalledWith(
        "internal_ip",
        expect.anything()
      );
    });

    it("should handle zero values correctly", () => {
      const sender = createMockSender();
      const metric: NetworkMetric = {
        timestamp: new Date("2024-01-01T12:00:00.000Z"),
        source: "ping",
        latency: 0,
        jitter: 0,
        packetLoss: 0,
      };

      writeMetricToSender(sender, metric);

      expect(sender.floatColumn).toHaveBeenCalledWith("latency", 0);
      expect(sender.floatColumn).toHaveBeenCalledWith("jitter", 0);
      expect(sender.floatColumn).toHaveBeenCalledWith("packet_loss", 0);
    });

    it("should convert timestamp to nanoseconds correctly", () => {
      const sender = createMockSender();
      const timestamp = new Date("2024-01-01T12:00:00.000Z");
      const metric: NetworkMetric = {
        timestamp,
        source: "ping",
      };

      writeMetricToSender(sender, metric);

      const expectedNanos = BigInt(timestamp.getTime()) * 1_000_000n;
      expect(sender.at).toHaveBeenCalledWith(expectedNanos, "ns");
    });

    it("should handle metric with mixed optional and required fields", () => {
      const sender = createMockSender();
      const metric: NetworkMetric = {
        timestamp: new Date("2024-01-01T12:00:00.000Z"),
        source: "ping",
        host: "1.1.1.1",
        latency: 10.5,
        connectivityStatus: "degraded",
      };

      writeMetricToSender(sender, metric);

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

    it("should chain sender calls in correct order", () => {
      const sender = createMockSender();
      const metric: NetworkMetric = {
        timestamp: new Date("2024-01-01T12:00:00.000Z"),
        source: "ping",
        host: "8.8.8.8",
        latency: 15.5,
      };

      writeMetricToSender(sender, metric);

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
