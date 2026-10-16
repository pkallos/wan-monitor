import { describe, expect, it } from "vitest";
import {
  attachOutageHosts,
  mapConnectivityStatusRow,
  mapCyclePeriodMs,
  mapHostStatsRow,
  mapLiveConnectivityRow,
  mapMetricRow,
  mapOutageHostRow,
  mapOutageRunRow,
  mapSummaryStatsRow,
} from "@/infrastructure/database/questdb/mappers";
import type { OutageRunRow } from "@/infrastructure/database/questdb/model";

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

  it("should keep a genuine zero bandwidth reading as 0, not undefined", () => {
    const row: Record<string, unknown> = {
      timestamp: "2024-01-01T12:00:00.000Z",
      source: "speedtest",
      download_bandwidth: 0,
      upload_bandwidth: 0,
    };

    const result = mapMetricRow(row);

    // A measured 0 Mbps is a real observation (a dead link during a speed
    // test); collapsing it to undefined would report it as "no data".
    expect(result.download_speed).toBe(0);
    expect(result.upload_speed).toBe(0);
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

describe("mapLiveConnectivityRow", () => {
  it.each(["up", "down", "degraded"] as const)(
    "should map a %s cycle",
    (status) => {
      const result = mapLiveConnectivityRow({
        timestamp: "2024-01-01T12:00:00.000Z",
        cycle_status: status,
      });

      expect(result).toEqual({
        timestamp: "2024-01-01T12:00:00.000Z",
        cycle_status: status,
      });
    }
  );

  it("should fall back to up for a status the CASE cannot emit", () => {
    const result = mapLiveConnectivityRow({
      timestamp: "2024-01-01T12:00:00.000Z",
      cycle_status: null,
    });

    expect(result.cycle_status).toBe("up");
  });
});

describe("mapSummaryStatsRow", () => {
  it("should map every aggregate", () => {
    expect(
      mapSummaryStatsRow({
        latency_p50: 20,
        latency_p95: 45.5,
        avg_packet_loss: 1.5,
        avg_jitter: 2,
      })
    ).toEqual({
      latency_p50: 20,
      latency_p95: 45.5,
      avg_packet_loss: 1.5,
      avg_jitter: 2,
    });
  });

  it("should keep nulls null rather than coercing them to 0", () => {
    const result = mapSummaryStatsRow({
      latency_p50: null,
      latency_p95: null,
      avg_packet_loss: null,
      avg_jitter: null,
    });

    expect(Object.values(result).every((value) => value === null)).toBe(true);
  });
});

describe("mapHostStatsRow", () => {
  it("should coerce string counts and map the status", () => {
    expect(
      mapHostStatsRow({
        host: "8.8.8.8",
        latency_p50: 10,
        latency_p95: 30,
        avg_packet_loss: 0,
        avg_jitter: null,
        answered_count: "58",
        total_count: "60",
        last_status: "degraded",
      })
    ).toEqual({
      host: "8.8.8.8",
      latency_p50: 10,
      latency_p95: 30,
      avg_packet_loss: 0,
      avg_jitter: null,
      answered_count: 58,
      total_count: 60,
      last_status: "degraded",
    });
  });
});

describe("mapOutageRunRow", () => {
  it("should map a run's span, worst loss and peak latency", () => {
    expect(
      mapOutageRunRow({
        run_id: "3",
        start_time: "2024-01-01T12:00:00.000Z",
        last_time: "2024-01-01T12:05:00.000Z",
        had_down: 1,
        max_packet_loss: 100,
        peak_latency: 40,
      })
    ).toEqual({
      run_id: 3,
      start_time: "2024-01-01T12:00:00.000Z",
      last_time: "2024-01-01T12:05:00.000Z",
      had_down: true,
      max_packet_loss: 100,
      peak_latency: 40,
    });
  });

  it("should read a run with no down cycle as not down", () => {
    const result = mapOutageRunRow({
      run_id: 1,
      start_time: "t1",
      last_time: "t2",
      had_down: 0,
      max_packet_loss: 20,
      peak_latency: 40,
    });

    expect(result.had_down).toBe(false);
  });

  it("should keep a missing loss and latency null", () => {
    const result = mapOutageRunRow({
      run_id: 1,
      start_time: "t1",
      last_time: "t2",
      had_down: 1,
      max_packet_loss: null,
      peak_latency: null,
    });

    expect(result.max_packet_loss).toBeNull();
    expect(result.peak_latency).toBeNull();
  });
});

describe("attachOutageHosts", () => {
  const run = (runId: number): OutageRunRow => ({
    run_id: runId,
    start_time: `start-${runId}`,
    last_time: `last-${runId}`,
    had_down: true,
    max_packet_loss: 100,
    peak_latency: null,
  });

  it("should list every affected host under its own run", () => {
    const result = attachOutageHosts(
      [run(1), run(2), run(3)],
      [
        { run_id: 1, host: "8.8.8.8" },
        { run_id: 1, host: "1.1.1.1" },
        { run_id: 3, host: "8.8.8.8" },
      ]
    );

    expect(result.map((row) => row.affected_hosts)).toEqual([
      ["8.8.8.8", "1.1.1.1"],
      [],
      ["8.8.8.8"],
    ]);
  });

  it("should ignore affected hosts whose run was not returned", () => {
    const result = attachOutageHosts(
      [run(1)],
      [{ run_id: 9, host: "8.8.8.8" }]
    );

    expect(result).toEqual([{ ...run(1), affected_hosts: [] }]);
  });
});

describe("mapOutageHostRow", () => {
  it("should map a run id and host", () => {
    expect(mapOutageHostRow({ run_id: "2", host: "8.8.8.8" })).toEqual({
      run_id: 2,
      host: "8.8.8.8",
    });
  });
});

describe("mapCyclePeriodMs", () => {
  it("should convert microseconds to whole milliseconds", () => {
    expect(mapCyclePeriodMs({ period_micros: 40_500_223 })).toBe(40_500);
    expect(mapCyclePeriodMs({ period_micros: 59_999_700 })).toBe(60_000);
  });

  it.each([null, undefined])(
    "should read %s as no measurable period",
    (period) => {
      expect(mapCyclePeriodMs({ period_micros: period })).toBeNull();
    }
  );

  it("should read a missing row as no measurable period", () => {
    expect(mapCyclePeriodMs(undefined)).toBeNull();
  });
});
