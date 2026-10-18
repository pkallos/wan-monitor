import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  attachOutageHosts,
  toCyclePeriodMs,
  toMetric,
} from "@/infrastructure/database/questdb/mappers";
import {
  ConnectivityStatusRowSchema,
  HostStatsRowSchema,
  LiveConnectivityRowSchema,
  MetricRowSchema,
  OutageHostRowSchema,
  type OutageRunRow,
  OutageRunRowSchema,
  SummaryStatsRowSchema,
} from "@/infrastructure/database/questdb/model";

const metricFrom = (row: Record<string, unknown>) =>
  toMetric(Schema.decodeUnknownSync(MetricRowSchema)(row));

const rejects = (schema: Schema.ConstraintDecoder<unknown>, row: unknown) =>
  Result.isFailure(Schema.decodeUnknownResult(schema)(row));

const PING_ROW = { timestamp: "2024-01-01T12:00:00.000Z", source: "ping" };
const SPEEDTEST_ROW = {
  timestamp: "2024-01-01T12:00:00.000Z",
  source: "speedtest",
};

describe("MetricRowSchema with toMetric", () => {
  it("should map complete ping metric row", () => {
    const result = metricFrom({
      ...PING_ROW,
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
    });

    expect(result).toEqual({
      timestamp: "2024-01-01T12:00:00.000Z",
      source: "ping",
      host: "8.8.8.8",
      latency: 15.5,
      jitter: 2.1,
      packet_loss: 0,
      connectivity_status: "up",
    });
  });

  it("should map a bucket's p50 and p95 latency when the query returned them", () => {
    const result = metricFrom({
      ...PING_ROW,
      latency: 15.5,
      latency_p50: 14,
      latency_p95: 31.5,
    });

    expect(result.latency_p50).toBe(14);
    expect(result.latency_p95).toBe(31.5);
  });

  it("should read a percentile the driver returned as text as a number", () => {
    const result = metricFrom({
      ...PING_ROW,
      latency_p50: "14.5",
      latency_p95: "31",
    });

    expect(result.latency_p50).toBe(14.5);
    expect(result.latency_p95).toBe(31);
  });

  it("should leave the percentiles out of a row that has none, or a null one", () => {
    const raw = metricFrom({ ...PING_ROW, latency: 15.5 });
    const empty = metricFrom({
      ...PING_ROW,
      latency_p50: null,
      latency_p95: null,
    });

    expect(raw.latency_p50).toBeUndefined();
    expect(empty.latency_p95).toBeUndefined();
  });

  it("should map complete speedtest metric row", () => {
    const result = metricFrom({
      ...SPEEDTEST_ROW,
      host: null,
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
    });

    expect(result).toEqual({
      timestamp: "2024-01-01T12:00:00.000Z",
      source: "speedtest",
      latency: 20.3,
      jitter: 3.5,
      download_speed: 100,
      upload_speed: 50,
      server_location: "Test Location",
      isp: "Test ISP",
      external_ip: "1.2.3.4",
      internal_ip: "192.168.1.100",
    });
    expect(result.connectivity_status).toBeUndefined();
  });

  it("should convert the LONG bandwidth columns pg returns as strings", () => {
    const result = metricFrom({
      ...SPEEDTEST_ROW,
      download_bandwidth: "250000000",
      upload_bandwidth: "50000000",
    });

    expect(result.download_speed).toBe(250);
    expect(result.upload_speed).toBe(50);
  });

  it("should read null latency, jitter and bandwidth as absent, not 0", () => {
    const result = metricFrom({
      ...SPEEDTEST_ROW,
      latency: null,
      jitter: null,
      download_bandwidth: null,
      upload_bandwidth: null,
    });

    expect(result.latency).toBeUndefined();
    expect(result.jitter).toBeUndefined();
    expect(result.download_speed).toBeUndefined();
    expect(result.upload_speed).toBeUndefined();
  });

  it("should handle undefined and missing columns", () => {
    const result = metricFrom({
      ...PING_ROW,
      host: undefined,
      latency: undefined,
      connectivity_status: undefined,
    });

    expect(result).toEqual(PING_ROW);
  });

  it("should keep a genuine zero bandwidth reading as 0, not undefined", () => {
    const result = metricFrom({
      ...SPEEDTEST_ROW,
      download_bandwidth: 0,
      upload_bandwidth: "0",
    });

    // A measured 0 Mbps is a real observation (a dead link during a speed
    // test); collapsing it to undefined would report it as "no data".
    expect(result.download_speed).toBe(0);
    expect(result.upload_speed).toBe(0);
  });

  it("should convert bandwidth from bps to mbps", () => {
    const result = metricFrom({
      ...SPEEDTEST_ROW,
      download_bandwidth: 125_000_000,
      upload_bandwidth: 25_000_000,
    });

    expect(result.download_speed).toBe(125);
    expect(result.upload_speed).toBe(25);
  });

  it("should handle partial data with mixed null and undefined", () => {
    const result = metricFrom({
      ...PING_ROW,
      host: "1.1.1.1",
      latency: 10.5,
      jitter: null,
      packet_loss: undefined,
      connectivity_status: "up",
      download_bandwidth: null,
      upload_bandwidth: undefined,
    });

    expect(result).toEqual({
      ...PING_ROW,
      host: "1.1.1.1",
      latency: 10.5,
      connectivity_status: "up",
    });
  });

  it.each([null, undefined, 1_704_110_400_000])(
    "should reject the timestamp %j",
    (timestamp) => {
      expect(rejects(MetricRowSchema, { ...PING_ROW, timestamp })).toBe(true);
    }
  );

  it.each(["icmp", "", null])("should reject the source %j", (source) => {
    expect(rejects(MetricRowSchema, { ...PING_ROW, source })).toBe(true);
  });

  it.each(["sideways", ""])(
    "should reject the connectivity_status %j rather than pass it on",
    (connectivity_status) => {
      expect(
        rejects(MetricRowSchema, { ...PING_ROW, connectivity_status })
      ).toBe(true);
    }
  );

  it.each(["fast", Number.NaN, {}])(
    "should reject the bandwidth %j rather than turn it into NaN",
    (download_bandwidth) => {
      expect(
        rejects(MetricRowSchema, { ...SPEEDTEST_ROW, download_bandwidth })
      ).toBe(true);
    }
  );
});

describe("ConnectivityStatusRowSchema", () => {
  const decode = Schema.decodeUnknownSync(ConnectivityStatusRowSchema);
  const row = {
    timestamp: "2024-01-01T12:00:00.000Z",
    up_count: 45,
    down_count: 3,
    degraded_count: 2,
    total_count: 50,
  };

  it("should map complete connectivity status row", () => {
    expect(decode(row)).toEqual(row);
  });

  it("should handle zero counts", () => {
    const zero = {
      ...row,
      up_count: 0,
      down_count: 0,
      degraded_count: 0,
      total_count: 0,
    };

    expect(decode(zero)).toEqual(zero);
  });

  it("should convert the LONG counts pg returns as strings", () => {
    expect(
      decode({
        ...row,
        up_count: "42",
        down_count: "5",
        degraded_count: "3",
        total_count: "50",
      })
    ).toEqual({
      ...row,
      up_count: 42,
      down_count: 5,
      degraded_count: 3,
      total_count: 50,
    });
  });

  it("should handle mixed count types", () => {
    expect(
      decode({ ...row, up_count: 30, down_count: "10", total_count: 40 })
    ).toMatchObject({
      up_count: 30,
      down_count: 10,
      total_count: 40,
    });
  });

  it.each([null, undefined, "many"])(
    "should reject the count %j rather than read it as 0",
    (up_count) => {
      expect(rejects(ConnectivityStatusRowSchema, { ...row, up_count })).toBe(
        true
      );
    }
  );
});

describe("LiveConnectivityRowSchema", () => {
  it.each(["up", "down", "degraded"] as const)(
    "should map a %s cycle",
    (status) => {
      const row = {
        timestamp: "2024-01-01T12:00:00.000Z",
        cycle_status: status,
      };

      expect(Schema.decodeUnknownSync(LiveConnectivityRowSchema)(row)).toEqual(
        row
      );
    }
  );

  it.each([null, "sideways"])(
    "should reject the status %j rather than read it as up",
    (cycle_status) => {
      expect(
        rejects(LiveConnectivityRowSchema, {
          timestamp: "2024-01-01T12:00:00.000Z",
          cycle_status,
        })
      ).toBe(true);
    }
  );
});

describe("SummaryStatsRowSchema", () => {
  const decode = Schema.decodeUnknownSync(SummaryStatsRowSchema);

  it("should map every aggregate", () => {
    const stats = {
      latency_p50: 20,
      latency_p95: 45.5,
      avg_packet_loss: 1.5,
      avg_jitter: 2,
    };

    expect(decode(stats)).toEqual(stats);
  });

  it("should keep nulls null rather than coercing them to 0", () => {
    const result = decode({
      latency_p50: null,
      latency_p95: null,
      avg_packet_loss: null,
      avg_jitter: null,
    });

    expect(Object.values(result).every((value) => value === null)).toBe(true);
  });
});

describe("HostStatsRowSchema", () => {
  const row = {
    host: "8.8.8.8",
    latency_p50: 10,
    latency_p95: 30,
    avg_packet_loss: 0,
    avg_jitter: null,
    answered_count: "58",
    total_count: "60",
    last_status: "degraded",
  };

  it("should coerce string counts and keep the status", () => {
    expect(Schema.decodeUnknownSync(HostStatsRowSchema)(row)).toEqual({
      ...row,
      answered_count: 58,
      total_count: 60,
    });
  });

  it("should reject a last_status outside up, down and degraded", () => {
    expect(
      rejects(HostStatsRowSchema, { ...row, last_status: "sideways" })
    ).toBe(true);
  });
});

describe("OutageRunRowSchema", () => {
  const decode = Schema.decodeUnknownSync(OutageRunRowSchema);
  const row = {
    run_id: "3",
    start_time: "2024-01-01T12:00:00.000Z",
    last_time: "2024-01-01T12:05:00.000Z",
    recovered_time: "2024-01-01T12:05:30.000Z",
    had_down: 1,
    max_packet_loss: 100,
    peak_latency: 40,
  };

  it("should map a run's span, worst loss and peak latency", () => {
    expect(decode(row)).toEqual({ ...row, run_id: 3, had_down: true });
  });

  it.each([
    [0, false],
    ["0", false],
    [1, true],
    ["2", true],
  ])("should read had_down %j as %j", (had_down, expected) => {
    expect(decode({ ...row, had_down }).had_down).toBe(expected);
  });

  it("should keep a missing loss, latency and recovery null", () => {
    const result = decode({
      ...row,
      recovered_time: null,
      max_packet_loss: null,
      peak_latency: null,
    });

    expect(result.max_packet_loss).toBeNull();
    expect(result.peak_latency).toBeNull();
    expect(result.recovered_time).toBeNull();
  });
});

describe("attachOutageHosts", () => {
  const run = (runId: number): OutageRunRow => ({
    run_id: runId,
    start_time: `start-${runId}`,
    last_time: `last-${runId}`,
    recovered_time: null,
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

describe("OutageHostRowSchema", () => {
  it("should map a run id and host", () => {
    expect(
      Schema.decodeUnknownSync(OutageHostRowSchema)({
        run_id: "2",
        host: "8.8.8.8",
      })
    ).toEqual({ run_id: 2, host: "8.8.8.8" });
  });
});

describe("toCyclePeriodMs", () => {
  it("should convert microseconds to whole milliseconds", () => {
    expect(toCyclePeriodMs(40_500_223)).toBe(40_500);
    expect(toCyclePeriodMs(59_999_700)).toBe(60_000);
  });

  it("should read null as no measurable period", () => {
    expect(toCyclePeriodMs(null)).toBeNull();
  });
});
