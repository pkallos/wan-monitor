import { describe, expect, it } from "vitest";
import {
  mapConnectivityStatusRow,
  mapMetricRow,
} from "@/infrastructure/database/questdb/mappers";

describe("mapMetricRow", () => {
  it("should map complete ping metric row", () => {
    const row: Record<string, unknown> = {
      timestamp: "2024-01-01T12:00:00.000Z",
      source: "ping",
      host: "8.8.8.8",
      latency: 15.5,
      jitter: 2.1,
      packet_loss: 0,
      connectivity_status: "up",
      download_bandwidth: null,
      upload_bandwidth: null,
      server_location: null,
      isp: null,
      external_ip: null,
      internal_ip: null,
    };

    const result = mapMetricRow(row);

    expect(result.timestamp).toBe("2024-01-01T12:00:00.000Z");
    expect(result.source).toBe("ping");
    expect(result.host).toBe("8.8.8.8");
    expect(result.latency).toBe(15.5);
    expect(result.jitter).toBe(2.1);
    expect(result.packet_loss).toBe(0);
    expect(result.connectivity_status).toBe("up");
    expect(result.download_speed).toBeUndefined();
    expect(result.upload_speed).toBeUndefined();
  });

  it("should map complete speedtest metric row", () => {
    const row: Record<string, unknown> = {
      timestamp: "2024-01-01T12:00:00.000Z",
      source: "speedtest",
      host: undefined,
      latency: 20.3,
      jitter: 3.5,
      packet_loss: null,
      connectivity_status: null,
      download_bandwidth: 100_000_000,
      upload_bandwidth: 50_000_000,
      server_location: "Test Location",
      isp: "Test ISP",
      external_ip: "1.2.3.4",
      internal_ip: "192.168.1.100",
    };

    const result = mapMetricRow(row);

    expect(result.timestamp).toBe("2024-01-01T12:00:00.000Z");
    expect(result.source).toBe("speedtest");
    expect(result.host).toBeUndefined();
    expect(result.latency).toBe(20.3);
    expect(result.jitter).toBe(3.5);
    expect(result.packet_loss).toBeUndefined();
    expect(result.connectivity_status).toBeNull();
    expect(result.download_speed).toBe(100);
    expect(result.upload_speed).toBe(50);
    expect(result.server_location).toBe("Test Location");
    expect(result.isp).toBe("Test ISP");
    expect(result.external_ip).toBe("1.2.3.4");
    expect(result.internal_ip).toBe("192.168.1.100");
  });

  it("should handle null latency values", () => {
    const row: Record<string, unknown> = {
      timestamp: "2024-01-01T12:00:00.000Z",
      source: "ping",
      host: "8.8.8.8",
      latency: null,
      jitter: null,
      packet_loss: null,
      connectivity_status: "down",
    };

    const result = mapMetricRow(row);

    expect(result.latency).toBeUndefined();
    expect(result.jitter).toBeUndefined();
    expect(result.packet_loss).toBeUndefined();
  });

  it("should handle undefined values", () => {
    const row: Record<string, unknown> = {
      timestamp: "2024-01-01T12:00:00.000Z",
      source: "ping",
      host: undefined,
      latency: undefined,
      jitter: undefined,
      packet_loss: undefined,
      connectivity_status: undefined,
    };

    const result = mapMetricRow(row);

    expect(result.host).toBeUndefined();
    expect(result.latency).toBeUndefined();
    expect(result.jitter).toBeUndefined();
    expect(result.packet_loss).toBeUndefined();
    expect(result.connectivity_status).toBeUndefined();
  });

  it("should convert bandwidth from bps to mbps", () => {
    const row: Record<string, unknown> = {
      timestamp: "2024-01-01T12:00:00.000Z",
      source: "speedtest",
      download_bandwidth: 125_000_000,
      upload_bandwidth: 25_000_000,
    };

    const result = mapMetricRow(row);

    expect(result.download_speed).toBe(125);
    expect(result.upload_speed).toBe(25);
  });

  it("should handle zero bandwidth as undefined (falsy check)", () => {
    const row: Record<string, unknown> = {
      timestamp: "2024-01-01T12:00:00.000Z",
      source: "speedtest",
      download_bandwidth: 0,
      upload_bandwidth: 0,
    };

    const result = mapMetricRow(row);

    expect(result.download_speed).toBeUndefined();
    expect(result.upload_speed).toBeUndefined();
  });

  it("should handle missing bandwidth fields", () => {
    const row: Record<string, unknown> = {
      timestamp: "2024-01-01T12:00:00.000Z",
      source: "ping",
    };

    const result = mapMetricRow(row);

    expect(result.download_speed).toBeUndefined();
    expect(result.upload_speed).toBeUndefined();
  });

  it("should handle partial data with mixed null and undefined", () => {
    const row: Record<string, unknown> = {
      timestamp: "2024-01-01T12:00:00.000Z",
      source: "ping",
      host: "1.1.1.1",
      latency: 10.5,
      jitter: null,
      packet_loss: undefined,
      connectivity_status: "up",
      download_bandwidth: null,
      upload_bandwidth: undefined,
    };

    const result = mapMetricRow(row);

    expect(result.host).toBe("1.1.1.1");
    expect(result.latency).toBe(10.5);
    expect(result.jitter).toBeUndefined();
    expect(result.packet_loss).toBeUndefined();
    expect(result.connectivity_status).toBe("up");
    expect(result.download_speed).toBeUndefined();
    expect(result.upload_speed).toBeUndefined();
  });
});

describe("mapConnectivityStatusRow", () => {
  it("should map complete connectivity status row", () => {
    const row: Record<string, unknown> = {
      timestamp: "2024-01-01T12:00:00.000Z",
      up_count: 45,
      down_count: 3,
      degraded_count: 2,
      total_count: 50,
    };

    const result = mapConnectivityStatusRow(row);

    expect(result.timestamp).toBe("2024-01-01T12:00:00.000Z");
    expect(result.up_count).toBe(45);
    expect(result.down_count).toBe(3);
    expect(result.degraded_count).toBe(2);
    expect(result.total_count).toBe(50);
  });

  it("should handle zero counts", () => {
    const row: Record<string, unknown> = {
      timestamp: "2024-01-01T12:00:00.000Z",
      up_count: 0,
      down_count: 0,
      degraded_count: 0,
      total_count: 0,
    };

    const result = mapConnectivityStatusRow(row);

    expect(result.up_count).toBe(0);
    expect(result.down_count).toBe(0);
    expect(result.degraded_count).toBe(0);
    expect(result.total_count).toBe(0);
  });

  it("should handle null/undefined counts by converting to 0", () => {
    const row: Record<string, unknown> = {
      timestamp: "2024-01-01T12:00:00.000Z",
      up_count: null,
      down_count: undefined,
      degraded_count: null,
      total_count: undefined,
    };

    const result = mapConnectivityStatusRow(row);

    expect(result.up_count).toBe(0);
    expect(result.down_count).toBe(0);
    expect(result.degraded_count).toBe(0);
    expect(result.total_count).toBe(0);
  });

  it("should convert string numbers to numbers", () => {
    const row: Record<string, unknown> = {
      timestamp: "2024-01-01T12:00:00.000Z",
      up_count: "42",
      down_count: "5",
      degraded_count: "3",
      total_count: "50",
    };

    const result = mapConnectivityStatusRow(row);

    expect(result.up_count).toBe(42);
    expect(result.down_count).toBe(5);
    expect(result.degraded_count).toBe(3);
    expect(result.total_count).toBe(50);
  });

  it("should handle mixed count types", () => {
    const row: Record<string, unknown> = {
      timestamp: "2024-01-01T12:00:00.000Z",
      up_count: 30,
      down_count: "10",
      degraded_count: null,
      total_count: 40,
    };

    const result = mapConnectivityStatusRow(row);

    expect(result.up_count).toBe(30);
    expect(result.down_count).toBe(10);
    expect(result.degraded_count).toBe(0);
    expect(result.total_count).toBe(40);
  });
});
