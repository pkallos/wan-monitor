import {
  NETWORK_METRICS_COLUMNS,
  NETWORK_METRICS_TABLE,
} from "@shared/db-schema";
import { PACKET_LOSS_THRESHOLDS } from "@wan-monitor/shared";
import { describe, expect, it } from "vitest";
import type {
  QueryMetricsParams,
  QuerySpeedtestsParams,
} from "@/infrastructure/database/questdb/model";
import {
  buildQueryConnectivityStatus,
  buildQueryCyclePeriod,
  buildQueryEarliestTimestamp,
  buildQueryHostStats,
  buildQueryLatestPingTimestamp,
  buildQueryLiveConnectivity,
  buildQueryMetrics,
  buildQueryOutageHosts,
  buildQueryOutageRuns,
  buildQuerySpeedtests,
  buildQuerySummaryStats,
  CYCLE_STATUS_CASE,
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
const connectivity = (params: Partial<QueryMetricsParams> = {}) =>
  buildQueryConnectivityStatus({ ...window, ...params }, TABLE);

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
    const columns = NETWORK_METRICS_COLUMNS.map((c) => c.name).join(", ");

    expect(metrics().query).toContain(`SELECT ${columns}\n`);
    expect(speedtests().query).toContain(`SELECT ${columns}\n`);
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

    it("takes the median and the 95th percentile over per-cycle means across hosts", () => {
      const { query } = aggregated({ source: "ping" });

      expect(query).toContain("approx_percentile(latency, 0.5");
      expect(query).toContain("approx_percentile(latency, 0.95");
      expect(query).toContain("SAMPLE BY 1s");
    });

    it("skips the 95th percentile when only the median is asked for", () => {
      const { query } = aggregated({ percentiles: "p50" });

      expect(query).toContain("approx_percentile(latency, 0.5");
      expect(query).not.toContain("0.95");
      expect(query).not.toContain("latency_p95");
    });

    it("skips the per-cycle collapse for a single host, which has one row per cycle", () => {
      const { query } = aggregated({ host: "8.8.8.8", percentiles: "p50" });

      expect(query).not.toContain("SAMPLE BY 1s");
      expect(query).toContain("AND host = $3");
    });

    it("keeps the per-cycle collapse for all hosts even when only the median is asked for", () => {
      expect(aggregated({ percentiles: "p50" }).query).toContain(
        "SAMPLE BY 1s"
      );
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
  it("builds a ping-only query over the window at the default granularity", () => {
    const result = connectivity();

    expect(result.query).toContain(`FROM ${TABLE}`);
    expect(result.query).toContain("WHERE timestamp >= $1");
    expect(result.query).toContain("AND timestamp <= $2");
    expect(result.query).toContain("AND source = 'ping'");
    expect(result.query).toContain("SAMPLE BY 5m");
    expect(result.params).toEqual(WINDOW_PARAMS);
  });

  it("uses a custom granularity", () => {
    expect(connectivity({ granularity: "1m" }).query).toContain("SAMPLE BY 1m");
  });

  it("includes the connectivity status aggregations", () => {
    const { query } = connectivity();

    expect(query).toContain("down_count");
    expect(query).toContain("degraded_count");
    expect(query).toContain("up_count");
    expect(query).toContain("total_count");
    expect(query).toContain("connectivity_status = 'down'");
  });

  // Lossy but reachable samples (>= 50% loss) count as degraded, and latency
  // never decides a sample's state.
  it("classifies via connectivity_status without a packet-loss ceiling or latency gap", () => {
    const { query } = connectivity();

    expect(query).not.toContain("packet_loss < 50");
    expect(query).not.toContain("latency < 0");
    expect(query).not.toContain("latency >= 0");
    expect(query).not.toContain("latency > 0");
  });

  // Regression guard for the quorum fix: a single failing host among several
  // must not be able to mark a cycle (and therefore a bucket) down on its own.
  it("classifies per cycle: down requires every host in the cycle to fail", () => {
    expect(connectivity().query).toContain(
      "SUM(CASE WHEN connectivity_status = 'down' THEN 1 ELSE 0 END) = count()"
    );
  });

  it("classifies packet loss at a 10% degraded floor", () => {
    expect(connectivity().query).toContain("MAX(packet_loss) >= 10");
  });

  it("groups cycles by exact timestamp before bucketing by granularity", () => {
    const { query } = connectivity();

    expect(query).toContain("SAMPLE BY 1s");
    expect(query).toContain("SAMPLE BY 5m");
  });

  it("orders by timestamp ascending", () => {
    expect(connectivity().query).toContain("ORDER BY timestamp ASC");
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
  const SINCE = "2024-01-01T00:00:00.000Z";

  it("bounds the window from below only", () => {
    const result = buildQueryLiveConnectivity({ sinceIso: SINCE }, TABLE);

    expect(result.query).toContain("WHERE timestamp >= $1");
    // No upper bound: a row written moments ago must not be excluded by
    // clock skew between the monitor and the API process.
    expect(result.query).not.toContain("timestamp <=");
    expect(result.params).toEqual([SINCE]);
  });

  it("reads ping cycles only, newest first, one row", () => {
    const { query } = buildQueryLiveConnectivity({ sinceIso: SINCE }, TABLE);

    expect(query).toContain("AND source = 'ping'");
    expect(query).toContain("SAMPLE BY 1s");
    expect(query).toContain("ORDER BY timestamp DESC");
    expect(query).toContain("LIMIT 1");
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

describe("CYCLE_STATUS_CASE", () => {
  it("reads the degraded floor from the shared constant", () => {
    expect(CYCLE_STATUS_CASE).toContain(
      `MAX(packet_loss) >= ${PACKET_LOSS_THRESHOLDS.degradedFloor}`
    );
  });

  // The live indicator and the historical timeline must classify a cycle
  // identically, so both embed this one string rather than their own copy.
  it("is embedded verbatim by both cycle-classifying queries", () => {
    const historical = connectivity();
    const live = buildQueryLiveConnectivity(
      { sinceIso: "2024-01-01T00:00:00.000Z" },
      TABLE
    );

    expect(historical.query).toContain(CYCLE_STATUS_CASE);
    expect(live.query).toContain(CYCLE_STATUS_CASE);
  });
});

describe("table name parameterization", () => {
  const outageWindow = { ...window, mergeGapMs: 75_000 };

  it.each([
    ["buildQueryMetrics", buildQueryMetrics(window, CUSTOM_TABLE)],
    [
      "buildQueryMetrics (aggregated)",
      buildQueryMetrics({ ...window, granularity: "5m" }, CUSTOM_TABLE),
    ],
    ["buildQuerySpeedtests", buildQuerySpeedtests(window, CUSTOM_TABLE)],
    [
      "buildQueryConnectivityStatus",
      buildQueryConnectivityStatus(window, CUSTOM_TABLE),
    ],
    ["buildQueryEarliestTimestamp", buildQueryEarliestTimestamp(CUSTOM_TABLE)],
    [
      "buildQueryLiveConnectivity",
      buildQueryLiveConnectivity({ sinceIso: "2024-01-01" }, CUSTOM_TABLE),
    ],
    [
      "buildQueryLatestPingTimestamp",
      buildQueryLatestPingTimestamp(CUSTOM_TABLE),
    ],
    ["buildQuerySummaryStats", buildQuerySummaryStats(window, CUSTOM_TABLE)],
    ["buildQueryHostStats", buildQueryHostStats(window, CUSTOM_TABLE)],
    ["buildQueryOutageRuns", buildQueryOutageRuns(outageWindow, CUSTOM_TABLE)],
    [
      "buildQueryOutageHosts",
      buildQueryOutageHosts(outageWindow, CUSTOM_TABLE),
    ],
    ["buildQueryCyclePeriod", buildQueryCyclePeriod(window, CUSTOM_TABLE)],
  ])("%s targets the table it is given", (_name, spec) => {
    expect(spec.query).toContain(`FROM ${CUSTOM_TABLE}`);
    expect(spec.query).not.toContain(`FROM ${TABLE}\n`);
  });
});

describe.each([
  ["buildQuerySummaryStats", buildQuerySummaryStats],
  ["buildQueryCyclePeriod", buildQueryCyclePeriod],
] as const)("%s", (_name, build) => {
  it("binds the window as ISO timestamp parameters", () => {
    expect(build(window, TABLE).params).toEqual(WINDOW_PARAMS);
  });
});

const outageWindow = { ...window, mergeGapMs: 75_000 };

describe.each([
  ["buildQueryOutageRuns", buildQueryOutageRuns],
  ["buildQueryOutageHosts", buildQueryOutageHosts],
] as const)("%s", (_name, build) => {
  it("binds the window and the merge gap in microseconds", () => {
    expect(build(outageWindow, TABLE).params).toEqual([
      ...WINDOW_PARAMS,
      75_000_000,
    ]);
  });

  it("rounds a fractional merge gap to whole microseconds", () => {
    const result = build({ ...window, mergeGapMs: 1000.0004 }, TABLE);

    expect(result.params[2]).toBe(1_000_000);
  });
});
