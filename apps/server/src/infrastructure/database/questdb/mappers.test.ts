import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  toMetric,
  toOutageRuns,
  toWindowUptimes,
} from "@/infrastructure/database/questdb/mappers";
import {
  ConnectivityStatusRowSchema,
  HostStatsRowSchema,
  LiveConnectivityRowSchema,
  MetricRowSchema,
  type OutageRunHostRow,
  OutageRunHostRowSchema,
  SummaryStatsRowSchema,
  stateOf,
  WAN_STATE,
  WindowUptimeRowSchema,
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
    bucket: "2024-01-01T12:00:00.000Z",
    up_micros: 45_000_000,
    degraded_micros: 2_000_000,
    down_micros: 3_000_000,
  };

  it("should map a complete ribbon bucket", () => {
    expect(decode(row)).toEqual(row);
  });

  it("should handle zero durations", () => {
    const zero = { ...row, up_micros: 0, degraded_micros: 0, down_micros: 0 };

    expect(decode(zero)).toEqual(zero);
  });

  it("should convert the LONG sums pg returns as strings", () => {
    expect(
      decode({
        ...row,
        up_micros: "42000000",
        degraded_micros: "5",
        down_micros: 3,
      })
    ).toEqual({
      ...row,
      up_micros: 42_000_000,
      degraded_micros: 5,
      down_micros: 3,
    });
  });

  it.each([null, undefined, "many"])(
    "should reject the duration %j rather than read it as 0",
    (up_micros) => {
      expect(rejects(ConnectivityStatusRowSchema, { ...row, up_micros })).toBe(
        true
      );
    }
  );
});

describe("LiveConnectivityRowSchema", () => {
  it.each([
    [1, 1],
    ["2", 2],
    [3, 3],
  ])("should map the state code %j", (state, expected) => {
    expect(
      Schema.decodeUnknownSync(LiveConnectivityRowSchema)({ state })
    ).toEqual({ state: expected });
  });

  it.each([null, undefined, "sideways"])(
    "should reject the state %j rather than read it as up",
    (state) => {
      expect(rejects(LiveConnectivityRowSchema, { state })).toBe(true);
    }
  );
});

describe("stateOf", () => {
  it.each([
    [WAN_STATE.up, "up"],
    [WAN_STATE.degraded, "degraded"],
    [WAN_STATE.down, "down"],
  ] as const)("should name state code %i %s", (code, status) => {
    expect(stateOf(code)).toBe(status);
  });

  it.each([WAN_STATE.noData, 4, -1])(
    "should read code %i as no status",
    (code) => {
      expect(stateOf(code)).toBeNull();
    }
  );
});

describe("WindowUptimeRowSchema", () => {
  it("should map up and observed durations per window, keeping nulls null", () => {
    expect(
      Schema.decodeUnknownSync(WindowUptimeRowSchema)({
        up_0: "86400000000",
        observed_0: 86_400_000_000,
        up_1: null,
        observed_1: null,
      })
    ).toEqual({
      up_0: 86_400_000_000,
      observed_0: 86_400_000_000,
      up_1: null,
      observed_1: null,
    });
  });
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

describe("OutageRunHostRowSchema", () => {
  const decode = Schema.decodeUnknownSync(OutageRunHostRowSchema);
  const row = {
    run_id: "3",
    start_time: "2024-01-01T12:00:00.000000Z",
    end_time: "2024-01-01T12:05:00.000000Z",
    had_down: 1,
    host: "8.8.8.8",
    affected: 1,
    max_packet_loss: 100,
    peak_latency: 40,
  };

  it("should map a run's span, a host's part in it, worst loss and peak latency", () => {
    expect(decode(row)).toEqual({
      ...row,
      run_id: 3,
      had_down: true,
      affected: true,
    });
  });

  it.each([
    [0, false],
    ["0", false],
    [1, true],
    ["2", true],
  ])("should read the flags %j as %j", (flag, expected) => {
    const result = decode({ ...row, had_down: flag, affected: flag });

    expect(result.had_down).toBe(expected);
    expect(result.affected).toBe(expected);
  });

  it("should keep a missing loss and latency null", () => {
    const result = decode({
      ...row,
      max_packet_loss: null,
      peak_latency: null,
    });

    expect(result.max_packet_loss).toBeNull();
    expect(result.peak_latency).toBeNull();
  });
});

describe("toOutageRuns", () => {
  const hostRow = (
    runId: number,
    host: string,
    over: Partial<OutageRunHostRow> = {}
  ): OutageRunHostRow => ({
    run_id: runId,
    start_time: `start-${runId}`,
    end_time: `end-${runId}`,
    had_down: true,
    host,
    affected: true,
    max_packet_loss: 100,
    peak_latency: null,
    ...over,
  });

  it("should group rows by run in order, listing the affected hosts of each", () => {
    const result = toOutageRuns([
      hostRow(1, "1.1.1.1"),
      hostRow(1, "8.8.8.8"),
      hostRow(3, "8.8.8.8", { had_down: false, end_time: "end-3b" }),
    ]);

    expect(result.map((run) => [run.run_id, run.affected_hosts])).toEqual([
      [1, ["1.1.1.1", "8.8.8.8"]],
      [3, ["8.8.8.8"]],
    ]);
    expect(result[0]).toMatchObject({
      start_time: "start-1",
      end_time: "end-1",
    });
    expect(result[1]?.had_down).toBe(false);
  });

  it("should leave out a host that stood without failing or losing packets", () => {
    const [run] = toOutageRuns([
      hostRow(1, "8.8.8.8"),
      hostRow(1, "1.1.1.1", { affected: false }),
    ]);

    expect(run?.affected_hosts).toEqual(["8.8.8.8"]);
  });

  it("should take the worst loss and the highest latency over every row of the run, affected or not", () => {
    const [run] = toOutageRuns([
      hostRow(1, "8.8.8.8", { max_packet_loss: 40, peak_latency: 30 }),
      hostRow(1, "1.1.1.1", {
        affected: false,
        max_packet_loss: 10,
        peak_latency: 90,
      }),
      hostRow(1, "cloudflare.com", {
        max_packet_loss: null,
        peak_latency: null,
      }),
    ]);

    expect(run?.max_packet_loss).toBe(40);
    expect(run?.peak_latency).toBe(90);
  });

  it("should keep loss and latency null when every row has none", () => {
    const [run] = toOutageRuns([
      hostRow(1, "8.8.8.8", { max_packet_loss: null, peak_latency: null }),
    ]);

    expect(run?.max_packet_loss).toBeNull();
    expect(run?.peak_latency).toBeNull();
  });

  it("should return nothing for no rows", () => {
    expect(toOutageRuns([])).toEqual([]);
  });
});

describe("toWindowUptimes", () => {
  it("should read each window's columns in order", () => {
    expect(
      toWindowUptimes(
        {
          up_0: 5,
          observed_0: 10,
          up_1: 7,
          observed_1: 8,
          up_2: 0,
          observed_2: 9,
        },
        3
      )
    ).toEqual([
      { up_micros: 5, observed_micros: 10 },
      { up_micros: 7, observed_micros: 8 },
      { up_micros: 0, observed_micros: 9 },
    ]);
  });

  it("should read a null sum, or an absent row, as no time", () => {
    expect(toWindowUptimes({ up_0: null, observed_0: null }, 1)).toEqual([
      { up_micros: 0, observed_micros: 0 },
    ]);
    expect(toWindowUptimes({}, 2)).toEqual([
      { up_micros: 0, observed_micros: 0 },
      { up_micros: 0, observed_micros: 0 },
    ]);
  });
});
