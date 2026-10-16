import {
  DEFAULT_GRANULARITY,
  isValidGranularity,
  PACKET_LOSS_THRESHOLDS,
} from "@wan-monitor/shared";
import { Effect } from "effect";
import { DatabaseQueryError } from "@/infrastructure/database/questdb/errors";
import type {
  QueryMetricsParams,
  QueryOutageParams,
  QuerySpeedtestsParams,
  QueryWindowParams,
} from "@/infrastructure/database/questdb/model";

export interface SqlQuerySpec {
  readonly query: string;
  readonly params: readonly (string | number)[];
}

/**
 * Significant digits `approx_percentile` keeps; at 3 a value is quantized to
 * within 0.1% (QuestDB docs, approx_percentile).
 */
const PERCENTILE_PRECISION = 3;

export const buildQueryMetrics = (
  params: QueryMetricsParams,
  table = "network_metrics"
): Effect.Effect<SqlQuerySpec, DatabaseQueryError> =>
  Effect.gen(function* () {
    const startTime =
      params.startTime?.toISOString() ??
      new Date(Date.now() - 3600000).toISOString();
    const endTime = params.endTime?.toISOString() ?? new Date().toISOString();

    const queryParams: (string | number)[] = [startTime, endTime];
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
    if (granularity && !isValidGranularity(granularity)) {
      return yield* Effect.fail(
        new DatabaseQueryError({
          message: `Invalid granularity: ${granularity}`,
        })
      );
    }

    const windowFilter = `
            WHERE timestamp >= $1
              AND timestamp <= $2
              ${hostFilter}
              ${sourceFilter}`;
    // For one host every reading counts, as in the host summary. Across hosts,
    // the inner SAMPLE BY 1s collapses each ping cycle to one row so the
    // bucket's figures cover the same per-cycle population as the summary.
    const aggregatedFrom =
      params.host === undefined
        ? `(
            SELECT
              timestamp,
              source,
              first(host) as host,
              avg(latency) as latency,
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
            SAMPLE BY 1s
          )`
        : `${table}
            ${windowFilter}`;
    // Each percentile is a pass of its own over every cycle in the window, so
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
          FROM ${aggregatedFrom}
          SAMPLE BY ${granularity} ALIGN TO CALENDAR
          ORDER BY timestamp DESC
          ${limitClause}
        `
      : `
          SELECT
            timestamp,
            source,
            host,
            latency,
            jitter,
            packet_loss,
            connectivity_status,
            download_bandwidth,
            upload_bandwidth,
            server_location,
            isp,
            external_ip,
            internal_ip
          FROM ${table}
          WHERE timestamp >= $1
            AND timestamp <= $2
            ${hostFilter}
            ${sourceFilter}
          ORDER BY timestamp DESC
          ${limitClause}
        `;

    return { query, params: queryParams } satisfies SqlQuerySpec;
  });

export const buildQuerySpeedtests = (
  params: QuerySpeedtestsParams,
  table = "network_metrics"
): Effect.Effect<SqlQuerySpec, DatabaseQueryError> =>
  Effect.gen(function* () {
    const startTime =
      params.startTime?.toISOString() ??
      new Date(Date.now() - 3600000).toISOString();
    const endTime = params.endTime?.toISOString() ?? new Date().toISOString();

    const queryParams: (string | number)[] = [startTime, endTime];

    let limitClause = "";
    if (params.limit) {
      limitClause = "LIMIT $3";
      queryParams.push(params.limit);
    }

    const granularity = params.granularity;
    if (granularity && !isValidGranularity(granularity)) {
      return yield* Effect.fail(
        new DatabaseQueryError({
          message: `Invalid granularity: ${granularity}`,
        })
      );
    }

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
          SELECT
            timestamp,
            source,
            host,
            latency,
            jitter,
            packet_loss,
            connectivity_status,
            download_bandwidth,
            upload_bandwidth,
            server_location,
            isp,
            external_ip,
            internal_ip
          FROM ${table}
          WHERE timestamp >= $1
            AND timestamp <= $2
            AND source = 'speedtest'
          ORDER BY timestamp DESC
          ${limitClause}
        `;

    return { query, params: queryParams } satisfies SqlQuerySpec;
  });

export const buildQueryEarliestTimestamp = (
  table = "network_metrics"
): Effect.Effect<SqlQuerySpec, DatabaseQueryError> =>
  Effect.succeed({
    query: `SELECT min(timestamp) as timestamp FROM ${table}`,
    params: [],
  });

/**
 * Reduces one ping cycle (the rows sharing a write timestamp, grouped by
 * `SAMPLE BY 1s`) to a single quorum-based state. Shared by the historical
 * rollup and the live indicator so the two can never disagree about what
 * "degraded" means:
 *   - down:     every host in the cycle failed. One host down out of several is
 *               a target/path problem, not a WAN outage.
 *   - degraded: not down, but at least one host failed or exceeded the loss
 *               floor. No upper packet-loss bound: any reachable-but-lossy
 *               cycle is degraded, including 50-99% loss.
 *   - up:       every host reachable and under the loss floor.
 * Latency is intentionally not used: a sample can be a valid reachable
 * measurement with no latency reading.
 */
export const CYCLE_STATUS_CASE = `CASE
              WHEN SUM(CASE WHEN connectivity_status = 'down' THEN 1 ELSE 0 END) = count() THEN 'down'
              WHEN SUM(CASE WHEN connectivity_status = 'down' THEN 1 ELSE 0 END) > 0
                OR MAX(packet_loss) >= ${PACKET_LOSS_THRESHOLDS.degradedFloor} THEN 'degraded'
              ELSE 'up'
            END`;

/**
 * Most recent ping cycle at or after `sinceIso`, for the live connectivity
 * indicator. Deliberately unbounded at the top so a row written moments ago
 * isn't excluded by clock skew between the monitor and the API process.
 */
export const buildQueryLiveConnectivity = (
  { sinceIso }: { readonly sinceIso: string },
  table = "network_metrics"
): Effect.Effect<SqlQuerySpec, DatabaseQueryError> =>
  Effect.succeed({
    query: `
        SELECT
          timestamp,
          ${CYCLE_STATUS_CASE} as cycle_status
        FROM ${table}
        WHERE timestamp >= $1
          AND source = 'ping'
        SAMPLE BY 1s
        ORDER BY timestamp DESC
        LIMIT 1
      `,
    params: [sinceIso],
  });

/**
 * Newest ping timestamp of any age. Lets the live indicator say when the
 * monitor last reported, so an empty window reads as "no data, last seen 4h
 * ago" rather than a bare "no data".
 */
export const buildQueryLatestPingTimestamp = (
  table = "network_metrics"
): Effect.Effect<SqlQuerySpec, DatabaseQueryError> =>
  Effect.succeed({
    query: `SELECT max(timestamp) as timestamp FROM ${table} WHERE source = 'ping'`,
    params: [],
  });

export const buildQueryConnectivityStatus = (
  params: QueryMetricsParams,
  table = "network_metrics"
): Effect.Effect<SqlQuerySpec, DatabaseQueryError> =>
  Effect.gen(function* () {
    const startTime =
      params.startTime?.toISOString() ??
      new Date(Date.now() - 86400000).toISOString();
    const endTime = params.endTime?.toISOString() ?? new Date().toISOString();

    const granularity = params.granularity ?? DEFAULT_GRANULARITY;
    if (!isValidGranularity(granularity)) {
      return yield* Effect.fail(
        new DatabaseQueryError({
          message: `Invalid granularity: ${granularity}`,
        })
      );
    }

    // Connectivity classification is quorum-based across a ping cycle (all
    // hosts pinged together — see `pingResultToMetric`'s shared `timestamp`),
    // not per host-row: the inner query reduces each cycle to one of three
    // states via `CYCLE_STATUS_CASE`, then the outer query buckets cycles by
    // granularity. `up_count + degraded_count + down_count` always equals
    // `total_count` for every output bucket.
    //
    // `ALIGN TO CALENDAR` pins bucket boundaries to epoch-floored intervals,
    // matching `expectedBucketCount`'s alignment so the coverage ratio compares
    // two counts of the same grid. Buckets with no ping cycles are absent from
    // the result rather than zero-filled, which is what makes a missing bucket
    // readable as "the collector wasn't running".
    const query = `
        SELECT
          bucket_ts as timestamp,
          SUM(CASE WHEN cycle_status = 'down' THEN 1 ELSE 0 END) as down_count,
          SUM(CASE WHEN cycle_status = 'degraded' THEN 1 ELSE 0 END) as degraded_count,
          SUM(CASE WHEN cycle_status = 'up' THEN 1 ELSE 0 END) as up_count,
          count() as total_count
        FROM (
          (SELECT
            timestamp as bucket_ts,
            ${CYCLE_STATUS_CASE} as cycle_status
          FROM ${table}
          WHERE timestamp >= $1
            AND timestamp <= $2
            AND source = 'ping'
          SAMPLE BY 1s
          )
        )
        SAMPLE BY ${granularity} ALIGN TO CALENDAR
        ORDER BY timestamp ASC
      `;

    return { query, params: [startTime, endTime] } satisfies SqlQuerySpec;
  });

/** Precision for the cycle period, where a sub-millisecond error matters. */
const MAX_PERCENTILE_PRECISION = 5;

const windowParams = ({
  startTime,
  endTime,
}: QueryWindowParams): readonly string[] => [
  startTime.toISOString(),
  endTime.toISOString(),
];

/**
 * Latency percentiles, mean loss and mean jitter over every ping cycle in the
 * window. Each cycle is first collapsed to one row (the mean across its hosts)
 * so a cycle with more hosts doesn't weigh more. Always yields exactly one row,
 * with nulls when the window holds no cycles.
 */
export const buildQuerySummaryStats = (
  params: QueryWindowParams,
  table = "network_metrics"
): Effect.Effect<SqlQuerySpec, DatabaseQueryError> =>
  Effect.succeed({
    query: `
        SELECT
          approx_percentile(latency, 0.5, ${PERCENTILE_PRECISION}) as latency_p50,
          approx_percentile(latency, 0.95, ${PERCENTILE_PRECISION}) as latency_p95,
          avg(packet_loss) as avg_packet_loss,
          avg(jitter) as avg_jitter
        FROM (
          (SELECT
            timestamp,
            avg(latency) as latency,
            avg(packet_loss) as packet_loss,
            avg(jitter) as jitter
          FROM ${table}
          WHERE timestamp >= $1
            AND timestamp <= $2
            AND source = 'ping'
          SAMPLE BY 1s
          )
        )
      `,
    params: windowParams(params),
  });

/**
 * Per-host latency percentiles, loss, jitter and answered share, plus the
 * host's newest sample classified the way a cycle is: down, lossy (degraded),
 * or up. A host's answered share counts every non-down sample, so lossy but
 * answered samples count as answered.
 */
export const buildQueryHostStats = (
  params: QueryWindowParams,
  table = "network_metrics"
): Effect.Effect<SqlQuerySpec, DatabaseQueryError> =>
  Effect.succeed({
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

const outageParams = ({
  startTime,
  endTime,
  mergeGapMs,
}: QueryOutageParams): readonly (string | number)[] => [
  startTime.toISOString(),
  endTime.toISOString(),
  Math.round(mergeGapMs * 1000),
];

/**
 * Every non-up ping cycle in the window, numbered with the outage it belongs
 * to ($3 is the merge gap in microseconds). A non-up cycle starts a new outage
 * when it is the first cycle of the window, follows an up cycle, or sits more
 * than the merge gap after the previous cycle; `run_id` is the running count
 * of those starts. Up cycles are dropped after they have been looked at, so
 * this stays one pass over the window's cycles inside the database.
 */
const numberedOutageCycles = (table: string): string => `
          SELECT
            timestamp,
            is_down,
            max_packet_loss,
            peak_latency,
            sum(starts_run) OVER (ORDER BY timestamp ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) as run_id
          FROM (
            SELECT
              timestamp,
              is_down,
              max_packet_loss,
              peak_latency,
              CASE
                WHEN previous_non_up IS NULL OR previous_non_up = 0
                  OR cast(timestamp as long) - cast(previous_timestamp as long) > $3 THEN 1
                ELSE 0
              END as starts_run
            FROM (
              SELECT
                timestamp,
                non_up,
                is_down,
                max_packet_loss,
                peak_latency,
                lag(non_up) OVER (ORDER BY timestamp) as previous_non_up,
                lag(timestamp) OVER (ORDER BY timestamp) as previous_timestamp
              FROM (
                SELECT
                  timestamp,
                  CASE WHEN cycle_status = 'up' THEN 0 ELSE 1 END as non_up,
                  CASE WHEN cycle_status = 'down' THEN 1 ELSE 0 END as is_down,
                  max_packet_loss,
                  peak_latency
                FROM (
                  SELECT
                    timestamp,
                    ${CYCLE_STATUS_CASE} as cycle_status,
                    MAX(packet_loss) as max_packet_loss,
                    MAX(latency) as peak_latency
                  FROM ${table}
                  WHERE timestamp >= $1
                    AND timestamp <= $2
                    AND source = 'ping'
                  SAMPLE BY 1s
                )
              )
            )
            WHERE non_up = 1
          )`;

/**
 * The outage runs in the window, oldest first: one row per maximal run of
 * non-up ping cycles, with its first and last cycle, whether any cycle was
 * down, and its worst loss and highest latency. The rows scale with the number
 * of outages rather than the number of cycles inside them. The hosts behind
 * each run come from `buildQueryOutageHosts`.
 */
export const buildQueryOutageRuns = (
  params: QueryOutageParams,
  table = "network_metrics"
): Effect.Effect<SqlQuerySpec, DatabaseQueryError> =>
  Effect.succeed({
    query: `
        SELECT
          run_id,
          min(timestamp) as start_time,
          max(timestamp) as last_time,
          max(is_down) as had_down,
          max(max_packet_loss) as max_packet_loss,
          max(peak_latency) as peak_latency
        FROM (${numberedOutageCycles(table)}
        )
        GROUP BY run_id
        ORDER BY run_id
      `,
    params: outageParams(params),
  });

/**
 * One row per (outage run, host) for every host that was down or at or over
 * the loss floor in a cycle of that run, numbered as in
 * `buildQueryOutageRuns`. Kept apart from the runs query because QuestDB caps a
 * whole query's `string_agg` output at 1 MB, which a long outage on a host that
 * never answers would exceed.
 */
export const buildQueryOutageHosts = (
  params: QueryOutageParams,
  table = "network_metrics"
): Effect.Effect<SqlQuerySpec, DatabaseQueryError> =>
  Effect.succeed({
    query: `
        SELECT DISTINCT runs.run_id, affected.host
        FROM (
          SELECT timestamp, host, count() as sample_count
          FROM ${table}
          WHERE timestamp >= $1
            AND timestamp <= $2
            AND source = 'ping'
            AND (
              connectivity_status = 'down'
              OR packet_loss >= ${PACKET_LOSS_THRESHOLDS.degradedFloor}
            )
          SAMPLE BY 1s
        ) affected
        JOIN (${numberedOutageCycles(table)}
        ) runs ON affected.timestamp = runs.timestamp
      `,
    params: outageParams(params),
  });

/**
 * Median gap, in microseconds, between consecutive ping cycles in the window.
 * Cycles land one configured interval plus the ping train's own duration
 * apart, so the real period is measured rather than assumed. A cycle is the
 * set of rows sharing one timestamp, so distinct timestamps are the cycles.
 * One row; null when the window holds fewer than two cycles.
 */
export const buildQueryCyclePeriod = (
  params: QueryWindowParams,
  table = "network_metrics"
): Effect.Effect<SqlQuerySpec, DatabaseQueryError> =>
  Effect.succeed({
    query: `
        SELECT approx_percentile(gap, 0.5, ${MAX_PERCENTILE_PRECISION}) as period_micros
        FROM (
          SELECT cast(timestamp as long) - cast(previous_timestamp as long) as gap
          FROM (
            SELECT timestamp, lag(timestamp) OVER (ORDER BY timestamp) as previous_timestamp
            FROM (
              SELECT DISTINCT timestamp
              FROM ${table}
              WHERE timestamp >= $1
                AND timestamp <= $2
                AND source = 'ping'
            )
          )
        )
        WHERE gap IS NOT NULL
      `,
    params: windowParams(params),
  });
