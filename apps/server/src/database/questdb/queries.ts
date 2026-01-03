import { VALID_GRANULARITIES } from "@wan-monitor/shared";
import { Effect } from "effect";
import { DatabaseQueryError } from "@/database/questdb/errors";
import type {
  QueryMetricsParams,
  QuerySpeedtestsParams,
} from "@/database/questdb/model";

export interface SqlQuerySpec {
  readonly query: string;
  readonly params: readonly (string | number)[];
}

export const buildQueryMetrics = (
  params: QueryMetricsParams
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
    if (granularity && !VALID_GRANULARITIES.includes(granularity)) {
      return yield* Effect.fail(
        new DatabaseQueryError(`Invalid granularity: ${granularity}`)
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
          FROM network_metrics
          WHERE timestamp >= $1
            AND timestamp <= $2
            AND (latency IS NULL OR latency >= 0)
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
          FROM network_metrics
          WHERE timestamp >= $1
            AND timestamp <= $2
            ${hostFilter}
          ORDER BY timestamp DESC
          ${limitClause}
        `;

    return { query, params: queryParams } satisfies SqlQuerySpec;
  });

export const buildQuerySpeedtests = (
  params: QuerySpeedtestsParams
): SqlQuerySpec => {
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

  const query = `
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
        FROM network_metrics
        WHERE timestamp >= $1
          AND timestamp <= $2
          AND source = 'speedtest'
        ORDER BY timestamp DESC
        ${limitClause}
      `;

  return { query, params: queryParams } satisfies SqlQuerySpec;
};

export const buildQueryConnectivityStatus = (
  params: QueryMetricsParams
): Effect.Effect<SqlQuerySpec, DatabaseQueryError> =>
  Effect.gen(function* () {
    const startTime =
      params.startTime?.toISOString() ??
      new Date(Date.now() - 86400000).toISOString();
    const endTime = params.endTime?.toISOString() ?? new Date().toISOString();

    const granularity = params.granularity ?? "5m";
    if (!VALID_GRANULARITIES.includes(granularity)) {
      return yield* Effect.fail(
        new DatabaseQueryError(`Invalid granularity: ${granularity}`)
      );
    }

    const query = `
        SELECT
          timestamp,
          SUM(CASE
            WHEN connectivity_status = 'down' OR latency < 0 THEN 1
            ELSE 0
          END) as down_count,
          SUM(CASE
            WHEN (latency >= 0 OR latency IS NOT NULL)
              AND connectivity_status != 'down'
              AND packet_loss >= 5
              AND packet_loss < 50 THEN 1
            ELSE 0
          END) as degraded_count,
          SUM(CASE
            WHEN (latency > 0 OR latency IS NOT NULL)
              AND connectivity_status != 'down'
              AND (packet_loss < 5 OR packet_loss IS NULL) THEN 1
            ELSE 0
          END) as up_count,
          COUNT(*) as total_count
        FROM network_metrics
        WHERE timestamp >= $1
          AND timestamp <= $2
          AND source = 'ping'
        SAMPLE BY ${granularity}
        ORDER BY timestamp ASC
      `;

    return { query, params: [startTime, endTime] } satisfies SqlQuerySpec;
  });
