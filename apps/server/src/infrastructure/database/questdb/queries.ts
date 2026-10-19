import { NETWORK_METRICS_COLUMNS } from "@shared/db-schema";
import {
  alignTimestampToMs,
  granularityToMs,
  PACKET_LOSS_THRESHOLDS,
} from "@wan-monitor/shared";
import {
  type QueryConnectivityParams,
  type QueryMetricsParams,
  type QuerySpeedtestsParams,
  type QueryStateParams,
  type QueryWindowParams,
  type QueryWindowUptimeParams,
  WAN_STATE,
  windowColumn,
} from "@/infrastructure/database/questdb/model";
import {
  RESOLUTION_FLOOR_HALF_PERIODS,
  stateParams,
  wanStatesSql,
} from "@/infrastructure/database/questdb/wan-state";

export interface SqlQuerySpec {
  readonly query: string;
  readonly params: readonly (string | number)[];
}

/**
 * Significant digits `approx_percentile` keeps; at 3 a value is quantized to
 * within 0.1% (QuestDB docs, approx_percentile).
 */
const PERCENTILE_PRECISION = 3;

const windowParams = ({
  startTime,
  endTime,
}: QueryWindowParams): readonly string[] => [
  startTime.toISOString(),
  endTime.toISOString(),
];

// `duration_ms` feeds no response, so raw rows leave it out.
const RAW_COLUMNS = NETWORK_METRICS_COLUMNS.filter(
  (column) => column.name !== "duration_ms"
)
  .map((column) => column.name)
  .join(", ");

export const buildQueryMetrics = (
  params: QueryMetricsParams,
  table: string
): SqlQuerySpec => {
  const queryParams: (string | number)[] = [...windowParams(params)];
  let paramIndex = 3;

  let hostFilter = "";
  if (params.host) {
    hostFilter = `AND host = $${paramIndex}`;
    queryParams.push(params.host);
    paramIndex++;
  }

  // `source` is projected un-aggregated next to SAMPLE BY, so QuestDB treats
  // it as a grouping key and emits one row per source per bucket. Pinning a
  // single source keeps each bucket to one row.
  let sourceFilter = "";
  if (params.source) {
    sourceFilter = `AND source = $${paramIndex}`;
    queryParams.push(params.source);
    paramIndex++;
  }

  let limitClause = "";
  if (params.limit) {
    limitClause = `LIMIT $${paramIndex}`;
    queryParams.push(params.limit);
  }

  const granularity = params.granularity;

  const windowFilter = `
            WHERE timestamp >= $1
              AND timestamp <= $2
              ${hostFilter}
              ${sourceFilter}`;
  // Each percentile is a pass of its own over every row in the window, so
  // the 95th is only computed for callers that draw it.
  const p95Column =
    params.percentiles === "p50"
      ? ""
      : `approx_percentile(latency, 0.95, ${PERCENTILE_PRECISION}) as latency_p95,`;

  const query = granularity
    ? `
          SELECT
            timestamp,
            source,
            first(host) as host,
            avg(latency) as latency,
            approx_percentile(latency, 0.5, ${PERCENTILE_PRECISION}) as latency_p50,
            ${p95Column}
            avg(jitter) as jitter,
            avg(packet_loss) as packet_loss,
            last(connectivity_status) as connectivity_status,
            avg(download_bandwidth) as download_bandwidth,
            avg(upload_bandwidth) as upload_bandwidth,
            last(server_location) as server_location,
            last(isp) as isp,
            last(external_ip) as external_ip,
            last(internal_ip) as internal_ip
          FROM ${table}
          ${windowFilter}
          SAMPLE BY ${granularity} ALIGN TO CALENDAR
          ORDER BY timestamp DESC
          ${limitClause}
        `
    : `
          SELECT ${RAW_COLUMNS}
          FROM ${table}
          WHERE timestamp >= $1
            AND timestamp <= $2
            ${hostFilter}
            ${sourceFilter}
          ORDER BY timestamp DESC
          ${limitClause}
        `;

  return { query, params: queryParams };
};

export const buildQuerySpeedtests = (
  params: QuerySpeedtestsParams,
  table: string
): SqlQuerySpec => {
  const queryParams: (string | number)[] = [...windowParams(params)];

  let limitClause = "";
  if (params.limit) {
    limitClause = "LIMIT $3";
    queryParams.push(params.limit);
  }

  const granularity = params.granularity;

  const query = granularity
    ? `
          SELECT
            timestamp,
            source,
            avg(latency) as latency,
            avg(jitter) as jitter,
            avg(download_bandwidth) as download_bandwidth,
            avg(upload_bandwidth) as upload_bandwidth,
            last(server_location) as server_location,
            last(isp) as isp,
            last(external_ip) as external_ip,
            last(internal_ip) as internal_ip
          FROM ${table}
          WHERE timestamp >= $1
            AND timestamp <= $2
            AND source = 'speedtest'
          SAMPLE BY ${granularity}
          ORDER BY timestamp DESC
          ${limitClause}
        `
    : `
          SELECT ${RAW_COLUMNS}
          FROM ${table}
          WHERE timestamp >= $1
            AND timestamp <= $2
            AND source = 'speedtest'
          ORDER BY timestamp DESC
          ${limitClause}
        `;

  return { query, params: queryParams };
};

export const buildQueryEarliestTimestamp = (table: string): SqlQuerySpec => ({
  query: `SELECT min(timestamp) as timestamp FROM ${table}`,
  params: [],
});

/**
 * The state at `nowMs`, taken from the stretch that reaches it. This runs the
 * same pipeline the reports use, over `[nowMs - 1 ms, nowMs]`. No row means no
 * host has a standing ping.
 */
export const buildQueryLiveConnectivity = (
  {
    nowMs,
    intervalMs,
    hosts,
  }: Pick<QueryStateParams, "nowMs" | "intervalMs" | "hosts">,
  table: string
): SqlQuerySpec => ({
  query: `WITH ${wanStatesSql(table, 7, hosts.length)}
        SELECT st state FROM states WHERE e >= cast($5 as timestamp) AND st > ${WAN_STATE.noData} LIMIT 1`,
  params: [
    ...stateParams({
      startTime: new Date(nowMs - 1),
      endTime: new Date(nowMs),
      nowMs,
      intervalMs,
    }),
    ...hosts,
  ],
});

/**
 * Newest ping timestamp of any age. Lets the live indicator say when the
 * monitor last reported, so an empty window reads as "no data, last seen 4h
 * ago" rather than a bare "no data".
 */
export const buildQueryLatestPingTimestamp = (table: string): SqlQuerySpec => ({
  query: `SELECT max(timestamp) as timestamp FROM ${table} WHERE source = 'ping'`,
  params: [],
});

/**
 * Time per state in each ribbon bucket. The state stretches are cut at every
 * bucket edge (`$7` is the first bucket's start and `$8` the bucket width, both
 * microseconds), so each bucket gets exactly the time that fell in it. The
 * marker count is inlined because `long_sequence` rejects a bind variable.
 * `ALIGN TO CALENDAR` pins bucket boundaries to epoch-floored intervals,
 * matching the bucket grid that coverage is counted over; a bucket with no
 * observed time is absent.
 */
export const buildQueryConnectivityStatus = (
  params: QueryConnectivityParams,
  table: string
): SqlQuerySpec => {
  const widthMs = granularityToMs(params.granularity);
  const firstBucketMs = alignTimestampToMs(
    params.startTime.getTime(),
    params.granularity
  );
  const lastMs = Math.min(params.endTime.getTime(), params.nowMs);
  const markers = Math.max(1, Math.ceil((lastMs - firstBucketMs) / widthMs));

  return {
    query: `WITH ${wanStatesSql(table, 9, params.hosts.length)},
pts AS (SELECT pt, st, e FROM (
     SELECT CASE WHEN s < cast($1 as timestamp) THEN cast($1 as timestamp) ELSE s END pt, st, e FROM states
       WHERE e > cast($1 as timestamp) AND s < cast($2 as timestamp)
     UNION ALL
     SELECT cast($7 as timestamp) + (x - 1) * $8 pt, cast(NULL as int) st, cast(NULL as timestamp) e FROM long_sequence(${markers}))
   WHERE pt >= cast($1 as timestamp) AND pt < cast($2 as timestamp) ORDER BY pt),
grp AS (SELECT pt, st, e, sum(CASE WHEN st IS NULL THEN 0 ELSE 1 END) OVER (ORDER BY pt ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) g FROM pts),
carried AS (SELECT pt, first_value(st) OVER (PARTITION BY g ORDER BY pt) st, first_value(e) OVER (PARTITION BY g ORDER BY pt) e,
     lead(pt) OVER (ORDER BY pt) nx FROM grp),
pieces AS (SELECT pt, st, datediff('u', pt, CASE WHEN nx IS NULL OR nx > e THEN (CASE WHEN e > cast($2 as timestamp) THEN cast($2 as timestamp) ELSE e END) ELSE nx END) dur
   FROM carried WHERE st > ${WAN_STATE.noData} AND e > pt)
SELECT pt bucket,
  sum(CASE WHEN st = ${WAN_STATE.up} THEN dur ELSE 0 END) up_micros,
  sum(CASE WHEN st = ${WAN_STATE.degraded} THEN dur ELSE 0 END) degraded_micros,
  sum(CASE WHEN st = ${WAN_STATE.down} THEN dur ELSE 0 END) down_micros
FROM ((SELECT pt, st, dur FROM pieces WHERE dur > 0 ORDER BY pt) timestamp(pt))
SAMPLE BY ${params.granularity} ALIGN TO CALENDAR`,
    params: [
      ...stateParams(params),
      firstBucketMs * 1000,
      widthMs * 1000,
      ...params.hosts,
    ],
  };
};

/**
 * Uptime inputs for several trailing windows that share an end, from one state
 * pipeline over the widest. One row: `up_<i>` and `observed_<i>` microseconds
 * for window `i`, with the window starts bound from `$7`.
 */
export const buildQueryWindowUptime = (
  params: QueryWindowUptimeParams,
  table: string
): SqlQuerySpec => {
  const windows = params.windowStartTimes;
  const widest = new Date(Math.min(...windows.map((start) => start.getTime())));
  const columns = windows.map((_, i) => {
    const w = `$${7 + i}`;
    const clipped = `datediff('u', CASE WHEN s < cast(${w} as timestamp) THEN cast(${w} as timestamp) ELSE s END, CASE WHEN e > cast($2 as timestamp) THEN cast($2 as timestamp) ELSE e END)`;
    return `sum(CASE WHEN st = ${WAN_STATE.up} AND e > cast(${w} as timestamp) THEN ${clipped} ELSE 0 END) ${windowColumn("up", i)}, sum(CASE WHEN st > ${WAN_STATE.noData} AND e > cast(${w} as timestamp) THEN ${clipped} ELSE 0 END) ${windowColumn("observed", i)}`;
  });

  return {
    query: `WITH ${wanStatesSql(table, 7 + windows.length, params.hosts.length)}
        SELECT ${columns.join(",\n  ")}
        FROM states WHERE st > ${WAN_STATE.noData} AND s < cast($2 as timestamp)`,
    params: [
      ...stateParams({ ...params, startTime: widest }),
      ...windows.map((start) => start.getTime() * 1000),
      ...params.hosts,
    ],
  };
};

/**
 * Latency percentiles, mean loss and mean jitter over every ping row in the
 * window. Always yields exactly one row, with nulls when the window holds no
 * pings.
 */
export const buildQuerySummaryStats = (
  params: QueryWindowParams,
  table: string
): SqlQuerySpec => ({
  query: `
        SELECT
          approx_percentile(latency, 0.5, ${PERCENTILE_PRECISION}) as latency_p50,
          approx_percentile(latency, 0.95, ${PERCENTILE_PRECISION}) as latency_p95,
          avg(packet_loss) as avg_packet_loss,
          avg(jitter) as avg_jitter
        FROM ${table}
        WHERE timestamp >= $1
          AND timestamp <= $2
          AND source = 'ping'
      `,
  params: windowParams(params),
});

/**
 * Per-host latency percentiles, loss, jitter and answered share, plus the
 * status of the host's newest ping (down, degraded or up), using the same
 * thresholds as a state. A host's answered share counts every non-down ping,
 * so lossy but answered pings count as answered.
 */
export const buildQueryHostStats = (
  params: QueryWindowParams,
  table: string
): SqlQuerySpec => ({
  query: `
        SELECT
          host,
          approx_percentile(latency, 0.5, ${PERCENTILE_PRECISION}) as latency_p50,
          approx_percentile(latency, 0.95, ${PERCENTILE_PRECISION}) as latency_p95,
          avg(packet_loss) as avg_packet_loss,
          avg(jitter) as avg_jitter,
          SUM(CASE WHEN connectivity_status = 'down' THEN 0 ELSE 1 END) as answered_count,
          count() as total_count,
          CASE
            WHEN last(connectivity_status) = 'down' THEN 'down'
            WHEN last(packet_loss) >= ${PACKET_LOSS_THRESHOLDS.degradedFloor} THEN 'degraded'
            ELSE 'up'
          END as last_status
        FROM ${table}
        WHERE timestamp >= $1
          AND timestamp <= $2
          AND source = 'ping'
        ORDER BY host
      `,
  params: windowParams(params),
});

/**
 * One row per (outage run, host) for the runs of degraded or down time that
 * overlap the window, oldest run first. A run is a maximal stretch of
 * consecutive degraded or down states; its start and end are the state edges,
 * unclipped. A host's ping qualifies when it stands for at least half a
 * spacing within the run, or for all of a run shorter than half a spacing. `affected` is set
 * when a qualifying ping was down or lossy, and the loss and latency are the
 * worst over the host's qualifying pings. A host whose pings do not qualify
 * still gets a row, with `affected` unset and no loss or latency, so a run no
 * ping qualifies for is still returned. Each ping row is paired with the last
 * run that starts before the ping's hold ends, through an `ASOF JOIN` keyed
 * one microsecond before the hold's end.
 */
export const buildQueryOutageRuns = (
  params: QueryStateParams,
  table: string
): SqlQuerySpec => ({
  query: `WITH ${wanStatesSql(table, 7, params.hosts.length)},
flagged AS (SELECT s, e, st, p, nonup, CASE WHEN nonup = 1 AND (prev_nonup IS NULL OR prev_nonup = 0) THEN 1 ELSE 0 END starts
   FROM (SELECT s, e, st, p, nonup, lag(nonup) OVER (ORDER BY s) prev_nonup
         FROM (SELECT s, e, st, p, CASE WHEN st >= ${WAN_STATE.degraded} THEN 1 ELSE 0 END nonup FROM states))),
run_numbered AS (SELECT s, e, st, p, nonup, sum(starts) OVER (ORDER BY s ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) run_id FROM flagged),
runs AS (SELECT run_id, min(s) start_time, max(e) end_time, max(CASE WHEN st = ${WAN_STATE.down} THEN 1 ELSE 0 END) had_down, max(p) p
   FROM run_numbered WHERE nonup = 1 AND e > cast($1 as timestamp) AND s < cast($2 as timestamp) GROUP BY run_id ORDER BY start_time),
hit AS (SELECT r.run_id run_id, r.start_time start_time, r.end_time end_time, r.had_down had_down, r.p rp, x.ts ts, x.he he, x.host host, x.b b, x.packet_loss packet_loss, x.latency latency
   FROM ((SELECT dateadd('u', -1, he) hold_key, ts, he, host, b, packet_loss, latency FROM holds ORDER BY hold_key) timestamp(hold_key)) x
   ASOF JOIN ((SELECT run_id, start_time, end_time, had_down, p FROM runs ORDER BY start_time) timestamp(start_time)) r),
held AS (SELECT run_id, start_time, end_time, had_down, rp, host, b, packet_loss, latency,
     datediff('u', CASE WHEN ts > start_time THEN ts ELSE start_time END, CASE WHEN he < end_time THEN he ELSE end_time END) overlap,
     datediff('u', start_time, end_time) span
   FROM hit WHERE run_id IS NOT NULL AND ts < end_time),
scored AS (SELECT run_id, start_time, end_time, had_down, host, b, packet_loss, latency,
     CASE WHEN overlap >= rp * ${RESOLUTION_FLOOR_HALF_PERIODS} / 2 OR overlap = span THEN 1 ELSE 0 END qualifies
   FROM held)
SELECT run_id, first(start_time) start_time, first(end_time) end_time, first(had_down) had_down, host,
  max(CASE WHEN qualifies = 1 THEN b ELSE 0 END) affected,
  max(CASE WHEN qualifies = 1 THEN packet_loss END) max_packet_loss,
  max(CASE WHEN qualifies = 1 THEN latency END) peak_latency
FROM scored
GROUP BY run_id, host ORDER BY run_id, host`,
  params: [...stateParams(params), ...params.hosts],
});
