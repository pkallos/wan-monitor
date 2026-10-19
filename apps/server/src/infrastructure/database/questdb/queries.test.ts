import {
  NETWORK_METRICS_COLUMNS,
  NETWORK_METRICS_TABLE,
} from "@shared/db-schema";
import { describe, expect, it } from "vitest";
import type {
  QueryConnectivityParams,
  QueryMetricsParams,
  QuerySpeedtestsParams,
  QueryStateParams,
  QueryWindowUptimeParams,
} from "@/infrastructure/database/questdb/model";
import {
  buildQueryConnectivityStatus,
  buildQueryEarliestTimestamp,
  buildQueryHostStats,
  buildQueryLatestPingTimestamp,
  buildQueryLiveConnectivity,
  buildQueryMetrics,
  buildQueryOutageRuns,
  buildQuerySpeedtests,
  buildQuerySummaryStats,
  buildQueryWindowUptime,
} from "@/infrastructure/database/questdb/queries";

const TABLE = NETWORK_METRICS_TABLE;
const CUSTOM_TABLE = "network_metrics_test_2";

const window = {
  startTime: new Date("2024-01-01T00:00:00Z"),
  endTime: new Date("2024-01-02T00:00:00Z"),
};
const WINDOW_PARAMS = ["2024-01-01T00:00:00.000Z", "2024-01-02T00:00:00.000Z"];

const metrics = (params: Partial<QueryMetricsParams> = {}) =>
  buildQueryMetrics({ ...window, ...params }, TABLE);
const speedtests = (params: Partial<QuerySpeedtestsParams> = {}) =>
  buildQuerySpeedtests({ ...window, ...params }, TABLE);

const NOW_MS = Date.parse("2024-01-03T00:00:00Z");
const INTERVAL_MS = 30_000;
const PRE_ROLL_MS = 3_600_000;
const HOSTS = ["8.8.8.8", "1.1.1.1"];

const state = (params: Partial<QueryStateParams> = {}): QueryStateParams => ({
  ...window,
  nowMs: NOW_MS,
  intervalMs: INTERVAL_MS,
  hosts: HOSTS,
  ...params,
});

const connectivity = (params: Partial<QueryConnectivityParams> = {}) =>
  buildQueryConnectivityStatus(
    { ...state(), granularity: "5m", ...params },
    TABLE
  );

const startMs = window.startTime.getTime();
const endMs = window.endTime.getTime();

/** The six leading binds of a state statement for `window`, in microseconds. */
const WINDOW_BINDS = [
  startMs * 1000,
  endMs * 1000,
  (startMs - PRE_ROLL_MS) * 1000,
  (endMs + PRE_ROLL_MS) * 1000,
  NOW_MS * 1000,
  INTERVAL_MS * 1000,
];

describe("buildQueryMetrics", () => {
  it("builds a raw query over the window with no filters", () => {
    const result = metrics();

    expect(result.query).toContain(`FROM ${TABLE}`);
    expect(result.query).toContain("WHERE timestamp >= $1");
    expect(result.query).toContain("AND timestamp <= $2");
    expect(result.query).toContain("ORDER BY timestamp DESC");
    expect(result.query).not.toContain("SAMPLE BY");
    expect(result.params).toEqual(WINDOW_PARAMS);
  });

  it("selects the table's columns in declaration order for raw rows", () => {
    const columns = NETWORK_METRICS_COLUMNS.filter(
      (c) => c.name !== "duration_ms"
    )
      .map((c) => c.name)
      .join(", ");

    expect(metrics().query).toContain(`SELECT ${columns}\n`);
    expect(speedtests().query).toContain(`SELECT ${columns}\n`);
  });

  it("leaves duration_ms out of raw rows, which no response carries", () => {
    expect(metrics().query).not.toContain("duration_ms");
    expect(speedtests().query).not.toContain("duration_ms");
  });

  it("filters by host", () => {
    const result = metrics({ host: "8.8.8.8" });

    expect(result.query).toContain("AND host = $3");
    expect(result.params).toEqual([...WINDOW_PARAMS, "8.8.8.8"]);
  });

  it("limits the rows", () => {
    const result = metrics({ limit: 100 });

    expect(result.query).toContain("LIMIT $3");
    expect(result.params).toEqual([...WINDOW_PARAMS, 100]);
  });

  it("numbers host before limit", () => {
    const result = metrics({ host: "1.1.1.1", limit: 50 });

    expect(result.query).toContain("AND host = $3");
    expect(result.query).toContain("LIMIT $4");
    expect(result.params).toEqual([...WINDOW_PARAMS, "1.1.1.1", 50]);
  });

  it("samples by the requested granularity", () => {
    const result = metrics({ granularity: "1m" });

    expect(result.query).toContain("SAMPLE BY 1m");
    expect(result.query).toContain("avg(latency) as latency");
    expect(result.query).toContain("avg(jitter) as jitter");
  });

  it("combines every parameter", () => {
    const result = metrics({
      host: "8.8.8.8",
      limit: 100,
      granularity: "5m",
    });

    expect(result.query).toContain("SAMPLE BY 5m");
    expect(result.query).toContain("AND host = $3");
    expect(result.query).toContain("LIMIT $4");
    expect(result.params).toEqual([...WINDOW_PARAMS, "8.8.8.8", 100]);
  });

  describe("how much each aggregated bucket computes", () => {
    const aggregated = (params: Partial<QueryMetricsParams>) =>
      metrics({ granularity: "1h", ...params });

    it("takes the median and the 95th percentile over every row in the bucket", () => {
      const { query } = aggregated({ source: "ping" });

      expect(query).toContain("approx_percentile(latency, 0.5");
      expect(query).toContain("approx_percentile(latency, 0.95");
      expect(query).not.toContain("SAMPLE BY 1s");
    });

    it("skips the 95th percentile when only the median is asked for", () => {
      const { query } = aggregated({ percentiles: "p50" });

      expect(query).toContain("approx_percentile(latency, 0.5");
      expect(query).not.toContain("0.95");
      expect(query).not.toContain("latency_p95");
    });

    it("reads the table directly, with or without a host", () => {
      for (const params of [{}, { host: "8.8.8.8" }] as const) {
        const { query } = aggregated({ ...params, percentiles: "p50" });

        expect(query).toContain(`FROM ${TABLE}`);
        expect(query).not.toContain("SAMPLE BY 1s");
      }
      expect(aggregated({ host: "8.8.8.8" }).query).toContain("AND host = $3");
    });
  });

  // Ping and speedtest rows share the table, and `source` is projected
  // un-aggregated beside SAMPLE BY, so QuestDB groups by it and returns one
  // row per source per bucket unless a single source is pinned.
  it("filters an aggregated query to a single source", () => {
    const result = metrics({ granularity: "1h", source: "ping" });

    expect(result.query).toContain("AND source = $3");
    expect(result.params).toEqual([...WINDOW_PARAMS, "ping"]);
  });

  it("filters a raw query to a single source too", () => {
    const result = metrics({ source: "speedtest" });

    expect(result.query).not.toContain("SAMPLE BY");
    expect(result.query).toContain("AND source = $3");
    expect(result.params[2]).toBe("speedtest");
  });

  it("leaves the query unfiltered when no source is given", () => {
    const result = metrics({ granularity: "1h" });

    expect(result.query).not.toContain("source = $");
    expect(result.params).toHaveLength(2);
  });

  it("numbers the source placeholder after host, before limit", () => {
    const result = metrics({ host: "8.8.8.8", source: "ping", limit: 10 });

    expect(result.query).toContain("AND host = $3");
    expect(result.query).toContain("AND source = $4");
    expect(result.query).toContain("LIMIT $5");
    expect(result.params.slice(2)).toEqual(["8.8.8.8", "ping", 10]);
  });

  // The frontend buckets returned rows by flooring each timestamp to a
  // multiple of the interval, which only lines up with calendar-aligned
  // buckets.
  it("aligns sampled buckets to the calendar", () => {
    expect(metrics({ granularity: "1h" }).query).toContain(
      "SAMPLE BY 1h ALIGN TO CALENDAR"
    );
  });
});

describe("buildQuerySpeedtests", () => {
  it("builds a raw speedtest query over the window", () => {
    const result = speedtests();

    expect(result.query).toContain(`FROM ${TABLE}`);
    expect(result.query).toContain("WHERE timestamp >= $1");
    expect(result.query).toContain("AND timestamp <= $2");
    expect(result.query).toContain("AND source = 'speedtest'");
    expect(result.query).toContain("ORDER BY timestamp DESC");
    expect(result.params).toEqual(WINDOW_PARAMS);
  });

  it("limits the rows", () => {
    const result = speedtests({ limit: 50 });

    expect(result.query).toContain("LIMIT $3");
    expect(result.params).toEqual([...WINDOW_PARAMS, 50]);
  });

  it("selects all relevant speedtest columns", () => {
    const { query } = speedtests();

    expect(query).toContain("download_bandwidth");
    expect(query).toContain("upload_bandwidth");
    expect(query).toContain("server_location");
    expect(query).toContain("isp");
    expect(query).toContain("external_ip");
    expect(query).toContain("internal_ip");
  });

  it("keeps the raw SQL unaggregated when granularity is omitted", () => {
    const { query } = speedtests();

    expect(query).not.toContain("SAMPLE BY");
    expect(query).not.toContain("avg(");
    expect(query).toContain("host,");
    expect(query).toContain("packet_loss,");
    expect(query).toContain("connectivity_status,");
  });

  it("builds an aggregated query with a granularity", () => {
    const { query } = speedtests({ granularity: "1h" });

    expect(query).toContain("SAMPLE BY 1h");
    expect(query).toContain("avg(latency) as latency");
    expect(query).toContain("avg(jitter) as jitter");
    expect(query).toContain("avg(download_bandwidth) as download_bandwidth");
    expect(query).toContain("avg(upload_bandwidth) as upload_bandwidth");
    expect(query).toContain("last(server_location) as server_location");
    expect(query).toContain("last(isp) as isp");
    expect(query).toContain("last(external_ip) as external_ip");
    expect(query).toContain("last(internal_ip) as internal_ip");
    expect(query).toContain("AND source = 'speedtest'");
    expect(query).toContain("ORDER BY timestamp DESC");
  });

  it("combines granularity and limit", () => {
    const result = speedtests({ limit: 10, granularity: "6h" });

    expect(result.query).toContain("SAMPLE BY 6h");
    expect(result.query).toContain("LIMIT $3");
    expect(result.params).toEqual([...WINDOW_PARAMS, 10]);
  });
});

describe("buildQueryConnectivityStatus", () => {
  it("builds the state pipeline over ping rows at the granularity", () => {
    const { query } = connectivity();

    expect(query).toContain(`FROM ${TABLE}`);
    expect(query).toContain("source = 'ping'");
    expect(query).toContain("SAMPLE BY 5m ALIGN TO CALENDAR");
    expect(connectivity({ granularity: "1m" }).query).toContain(
      "SAMPLE BY 1m ALIGN TO CALENDAR"
    );
  });

  it("returns time per state in microseconds", () => {
    const { query } = connectivity();

    expect(query).toContain("up_micros");
    expect(query).toContain("degraded_micros");
    expect(query).toContain("down_micros");
    expect(query).toContain("SELECT pt bucket");
  });

  it("binds the window, the first bucket, the bucket width and the hosts as integers", () => {
    const { params } = connectivity();

    expect(params).toEqual([
      ...WINDOW_BINDS,
      Date.parse("2024-01-01T00:00:00Z") * 1000,
      300_000 * 1000,
      ...HOSTS,
    ]);
  });

  it("aligns the first bucket to the grid below the window start", () => {
    const { params } = connectivity({
      startTime: new Date("2024-01-01T00:07:30Z"),
      granularity: "5m",
    });

    expect(params[6]).toBe(Date.parse("2024-01-01T00:05:00Z") * 1000);
  });

  it("inlines the marker count, one per bucket, because long_sequence rejects a bind", () => {
    expect(connectivity().query).toContain("long_sequence(288)");
    expect(connectivity({ granularity: "1h" }).query).toContain(
      "long_sequence(24)"
    );
  });

  it("counts markers only up to now when the window ends later", () => {
    const { query } = connectivity({
      nowMs: Date.parse("2024-01-01T01:00:00Z"),
      granularity: "5m",
    });

    expect(query).toContain("long_sequence(12)");
  });

  it("keeps at least one marker for a window that starts after now", () => {
    const { query } = connectivity({
      nowMs: Date.parse("2023-12-31T00:00:00Z"),
    });

    expect(query).toContain("long_sequence(1)");
  });

  it("clips the window end and the scan end to now", () => {
    const nowMs = Date.parse("2024-01-01T12:00:00Z");
    const { params } = connectivity({ nowMs });

    expect(params[1]).toBe(nowMs * 1000);
    expect(params[3]).toBe(nowMs * 1000);
    expect(params[4]).toBe(nowMs * 1000);
  });

  it("reads every host as unconfigured when none is configured", () => {
    const { query, params } = connectivity({ hosts: [] });

    expect(query).toContain("host IN (NULL)");
    expect(params).toHaveLength(8);
  });

  it("numbers the host placeholders after the bucket binds", () => {
    expect(connectivity().query).toContain("host IN ($9, $10)");
  });

  it("classifies packet loss at the 10% degraded floor", () => {
    expect(connectivity().query).toContain("packet_loss >= 10");
  });
});

describe("buildQueryEarliestTimestamp", () => {
  it("builds a query for the minimum timestamp", () => {
    const result = buildQueryEarliestTimestamp(TABLE);

    expect(result.query).toContain("min(timestamp)");
    expect(result.query).toContain(`FROM ${TABLE}`);
    expect(result.params).toHaveLength(0);
  });
});

describe("buildQueryLiveConnectivity", () => {
  const live = () =>
    buildQueryLiveConnectivity(
      { nowMs: NOW_MS, intervalMs: INTERVAL_MS, hosts: HOSTS },
      TABLE
    );

  it("reads the state of the stretch that reaches now, one row", () => {
    const { query } = live();

    expect(query).toContain("SELECT st state FROM states");
    expect(query).toContain("e >= cast($5 as timestamp)");
    expect(query).toContain("LIMIT 1");
  });

  it("binds a one-millisecond window ending now, as integers", () => {
    const { params } = live();

    expect(params).toEqual([
      (NOW_MS - 1) * 1000,
      NOW_MS * 1000,
      (NOW_MS - 1 - PRE_ROLL_MS) * 1000,
      NOW_MS * 1000,
      NOW_MS * 1000,
      INTERVAL_MS * 1000,
      ...HOSTS,
    ]);
  });
});

describe("buildQueryOutageRuns", () => {
  it("binds the window and the hosts as integers and names", () => {
    expect(buildQueryOutageRuns(state(), TABLE).params).toEqual([
      ...WINDOW_BINDS,
      ...HOSTS,
    ]);
  });

  it("keeps runs that overlap the window and pairs each ping with a run", () => {
    const { query } = buildQueryOutageRuns(state(), TABLE);

    expect(query).toContain("e > cast($1 as timestamp)");
    expect(query).toContain("s < cast($2 as timestamp)");
    expect(query).toContain("ASOF JOIN");
  });

  it("reads every host as unconfigured when none is configured", () => {
    const { query, params } = buildQueryOutageRuns(state({ hosts: [] }), TABLE);

    expect(query).toContain("host IN (NULL)");
    expect(params).toEqual(WINDOW_BINDS);
  });
});

describe("buildQueryWindowUptime", () => {
  const windowStartTimes = [
    new Date(endMs - 24 * 3_600_000),
    new Date(endMs - 7 * 24 * 3_600_000),
    new Date(endMs - 30 * 24 * 3_600_000),
  ];
  const uptime = (over: Partial<QueryWindowUptimeParams> = {}) =>
    buildQueryWindowUptime({ ...state(), windowStartTimes, ...over }, TABLE);

  it("scans from the widest window and binds each window start after the shared six", () => {
    const widest = windowStartTimes[2]?.getTime() ?? 0;
    const { params } = uptime();

    expect(params).toEqual([
      widest * 1000,
      endMs * 1000,
      (widest - PRE_ROLL_MS) * 1000,
      (endMs + PRE_ROLL_MS) * 1000,
      NOW_MS * 1000,
      INTERVAL_MS * 1000,
      ...windowStartTimes.map((start) => start.getTime() * 1000),
      ...HOSTS,
    ]);
  });

  it("returns an up and an observed column for every window", () => {
    const { query } = uptime();

    for (const i of [0, 1, 2]) {
      expect(query).toContain(`up_${i}`);
      expect(query).toContain(`observed_${i}`);
    }
    expect(query).toContain("host IN ($10, $11)");
  });

  it("finds the widest window whatever the order", () => {
    const reversed = uptime({
      windowStartTimes: [...windowStartTimes].reverse(),
    });

    expect(reversed.params[0]).toBe(
      (windowStartTimes[2]?.getTime() ?? 0) * 1000
    );
  });
});

describe("buildQueryLatestPingTimestamp", () => {
  it("builds a query for the newest ping timestamp", () => {
    const result = buildQueryLatestPingTimestamp(TABLE);

    expect(result.query).toContain("max(timestamp)");
    expect(result.query).toContain(`FROM ${TABLE}`);
    expect(result.query).toContain("WHERE source = 'ping'");
    expect(result.params).toHaveLength(0);
  });
});

describe("table name parameterization", () => {
  it.each([
    ["buildQueryMetrics", buildQueryMetrics(window, CUSTOM_TABLE)],
    [
      "buildQueryMetrics (aggregated)",
      buildQueryMetrics({ ...window, granularity: "5m" }, CUSTOM_TABLE),
    ],
    ["buildQuerySpeedtests", buildQuerySpeedtests(window, CUSTOM_TABLE)],
    [
      "buildQueryConnectivityStatus",
      buildQueryConnectivityStatus(
        { ...state(), granularity: "5m" },
        CUSTOM_TABLE
      ),
    ],
    ["buildQueryEarliestTimestamp", buildQueryEarliestTimestamp(CUSTOM_TABLE)],
    [
      "buildQueryLiveConnectivity",
      buildQueryLiveConnectivity(
        { nowMs: NOW_MS, intervalMs: INTERVAL_MS, hosts: HOSTS },
        CUSTOM_TABLE
      ),
    ],
    [
      "buildQueryLatestPingTimestamp",
      buildQueryLatestPingTimestamp(CUSTOM_TABLE),
    ],
    ["buildQuerySummaryStats", buildQuerySummaryStats(window, CUSTOM_TABLE)],
    ["buildQueryHostStats", buildQueryHostStats(window, CUSTOM_TABLE)],
    ["buildQueryOutageRuns", buildQueryOutageRuns(state(), CUSTOM_TABLE)],
    [
      "buildQueryWindowUptime",
      buildQueryWindowUptime(
        { ...state(), windowStartTimes: [window.startTime] },
        CUSTOM_TABLE
      ),
    ],
  ])("%s targets the table it is given", (_name, spec) => {
    expect(spec.query).toContain(`FROM ${CUSTOM_TABLE}`);
    expect(spec.query).not.toContain(`FROM ${TABLE}\n`);
  });
});

describe("buildQuerySummaryStats", () => {
  it("binds the window as ISO timestamp parameters", () => {
    expect(buildQuerySummaryStats(window, TABLE).params).toEqual(WINDOW_PARAMS);
  });

  it("takes percentiles, loss and jitter over every ping row", () => {
    const { query } = buildQuerySummaryStats(window, TABLE);

    expect(query).toContain("approx_percentile(latency, 0.5");
    expect(query).toContain("approx_percentile(latency, 0.95");
    expect(query).toContain("AND source = 'ping'");
    expect(query).not.toContain("SAMPLE BY");
  });
});
