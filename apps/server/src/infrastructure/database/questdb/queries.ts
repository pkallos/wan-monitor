import {
  isValidGranularity,
  PACKET_LOSS_THRESHOLDS,
} from "@wan-monitor/shared";
import { Effect } from "effect";
import { DatabaseQueryError } from "@/infrastructure/database/questdb/errors";
import type {
  QueryMetricsParams,
  QuerySpeedtestsParams,
} from "@/infrastructure/database/questdb/model";

export interface SqlQuerySpec {
  readonly query: string;
  readonly params: readonly (string | number)[];
}

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

    const query = granularity
      ? `
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
          WHERE timestamp >= $1
            AND timestamp <= $2
            ${hostFilter}
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
            ${hostFilter}
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

export const buildQueryConnectivityStatus = (
  params: QueryMetricsParams,
  table = "network_metrics"
): Effect.Effect<SqlQuerySpec, DatabaseQueryError> =>
  Effect.gen(function* () {
    const startTime =
      params.startTime?.toISOString() ??
      new Date(Date.now() - 86400000).toISOString();
    const endTime = params.endTime?.toISOString() ?? new Date().toISOString();

    const granularity = params.granularity ?? "5m";
    if (!isValidGranularity(granularity)) {
      return yield* Effect.fail(
        new DatabaseQueryError({
          message: `Invalid granularity: ${granularity}`,
        })
      );
    }

    // Connectivity classification is quorum-based across a ping cycle (all
    // hosts pinged together — see `pingResultToMetric`'s shared `timestamp`),
    // not per host-row. A single host blip no longer paints the whole bucket
    // down: the inner query first reduces each cycle (exact-timestamp group,
    // since every host in a cycle shares one write-time timestamp) to one of
    // three states, then the outer query buckets cycles the same way host-rows
    // were bucketed before. `up_count + degraded_count + down_count` always
    // equals `total_count` for every output bucket:
    //   - down:     every host in the cycle failed (connectivity_status='down').
    //               One host down out of several is a target/path problem, not
    //               a WAN outage.
    //   - degraded: not down, but at least one host failed or exceeded the loss
    //               floor. No upper packet-loss bound: any reachable-but-lossy
    //               cycle is degraded, including 50-99% loss.
    //   - up:       every host reachable and under the loss floor.
    // Latency is intentionally NOT used for classification: a sample can be a
    // valid reachable measurement with no latency reading.
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
            CASE
              WHEN SUM(CASE WHEN connectivity_status = 'down' THEN 1 ELSE 0 END) = count() THEN 'down'
              WHEN SUM(CASE WHEN connectivity_status = 'down' THEN 1 ELSE 0 END) > 0
                OR MAX(packet_loss) >= ${PACKET_LOSS_THRESHOLDS.degradedFloor} THEN 'degraded'
              ELSE 'up'
            END as cycle_status
          FROM ${table}
          WHERE timestamp >= $1
            AND timestamp <= $2
            AND source = 'ping'
          SAMPLE BY 1s
          )
        )
        SAMPLE BY ${granularity}
        ORDER BY timestamp ASC
      `;

    return { query, params: [startTime, endTime] } satisfies SqlQuerySpec;
  });
