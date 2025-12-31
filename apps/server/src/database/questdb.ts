import { Sender } from "@questdb/nodejs-client";
import type { Granularity } from "@wan-monitor/shared";
import type {
  DatabaseHealth,
  NetworkMetric,
} from "@wan-monitor/shared/metrics";
import { Context, Effect, Layer, Schedule } from "effect";
import { Client as PgClient, types } from "pg";
import { ConfigService } from "@/services/config";

// Disable pg's automatic timestamp parsing - return as ISO strings instead
// This prevents timezone conversion issues where pg interprets timestamps
// as local time instead of UTC
// QuestDB returns timestamps like "2025-12-31 10:20:57.001000" - convert to ISO format
types.setTypeParser(types.builtins.TIMESTAMP, (val: string) =>
  val ? `${val.replace(" ", "T")}Z` : val
);
types.setTypeParser(types.builtins.TIMESTAMPTZ, (val: string) =>
  val ? `${val.replace(" ", "T")}Z` : val
);

// Database errors
export class DatabaseConnectionError {
  readonly _tag = "DatabaseConnectionError";
  constructor(readonly message: string) {}
}

export class DatabaseWriteError {
  readonly _tag = "DatabaseWriteError";
  constructor(readonly message: string) {}
}

export class DatabaseQueryError {
  readonly _tag = "DatabaseQueryError";
  constructor(readonly message: string) {}
}

// Query result type
export interface MetricRow {
  readonly timestamp: string;
  readonly source: "ping" | "speedtest";
  readonly host?: string;
  readonly latency?: number;
  readonly jitter?: number;
  readonly packet_loss?: number;
  readonly connectivity_status?: string;
  readonly download_speed?: number;
  readonly upload_speed?: number;
  readonly server_location?: string;
  readonly isp?: string;
}

export interface QueryMetricsParams {
  readonly startTime?: Date;
  readonly endTime?: Date;
  readonly host?: string;
  readonly limit?: number;
  readonly granularity?: Granularity;
}

export interface ConnectivityStatusRow {
  readonly timestamp: string;
  readonly up_count: number;
  readonly down_count: number;
  readonly degraded_count: number;
  readonly total_count: number;
}

// QuestDB service interface
export interface QuestDBService {
  readonly writeMetric: (
    metric: NetworkMetric
  ) => Effect.Effect<void, DatabaseWriteError>;
  readonly queryMetrics: (
    params: QueryMetricsParams
  ) => Effect.Effect<readonly MetricRow[], DatabaseQueryError>;
  readonly queryConnectivityStatus: (
    params: QueryMetricsParams
  ) => Effect.Effect<readonly ConnectivityStatusRow[], DatabaseQueryError>;
  readonly health: () => Effect.Effect<DatabaseHealth, DatabaseConnectionError>;
  readonly close: () => Effect.Effect<void>;
}

// QuestDB service tag
export class QuestDB extends Context.Tag("QuestDB")<
  QuestDB,
  QuestDBService
>() {}

// Default PostgreSQL port for QuestDB
const QUESTDB_PG_PORT = 8812;

// Implementation
const make = Effect.gen(function* () {
  const config = yield* ConfigService;

  // Build ILP connection string for writes
  const buildSenderConnectionString = () => {
    const {
      host,
      port,
      protocol,
      autoFlushRows,
      autoFlushInterval,
      requestTimeout,
      retryTimeout,
    } = config.database;

    if (protocol === "http") {
      return `http::addr=${host}:${port};auto_flush_rows=${autoFlushRows};auto_flush_interval=${autoFlushInterval};request_timeout=${requestTimeout};retry_timeout=${retryTimeout};`;
    }
    return `tcp::addr=${host}:9009;auto_flush_rows=${autoFlushRows};auto_flush_interval=${autoFlushInterval};`;
  };

  // Initialize Sender for writes (ILP protocol)
  const sender = yield* Effect.tryPromise({
    try: async () => {
      const connectionString = buildSenderConnectionString();
      const s = await Sender.fromConfig(connectionString);

      // Only call connect() for TCP protocol
      if (config.database.protocol === "tcp") {
        await s.connect();
      }

      return s;
    },
    catch: (error) =>
      new DatabaseConnectionError(
        `Failed to connect to QuestDB Sender: ${error}`
      ),
  });

  // Initialize PgClient for queries (PostgreSQL wire protocol)
  const pgClient = yield* Effect.tryPromise({
    try: async () => {
      const client = new PgClient({
        host: config.database.host,
        port: QUESTDB_PG_PORT,
        database: "qdb",
        user: "admin",
        password: "quest",
      });
      await client.connect();
      return client;
    },
    catch: (error) =>
      new DatabaseConnectionError(
        `Failed to connect to QuestDB PgWire: ${error}`
      ),
  });

  const writeMetric = (metric: NetworkMetric) =>
    Effect.tryPromise({
      try: async () => {
        // Write to network_metrics table
        // NOTE: In QuestDB ILP, symbols MUST come before columns
        let row = sender
          .table("network_metrics")
          .symbol("source", metric.source);

        // Add optional symbols first (must be before columns)
        if (metric.host) row = row.symbol("host", metric.host);
        if (metric.connectivityStatus)
          row = row.symbol("connectivity_status", metric.connectivityStatus);
        if (metric.serverLocation)
          row = row.symbol("server_location", metric.serverLocation);
        if (metric.isp) row = row.symbol("isp", metric.isp);

        // Add numeric columns after symbols
        if (metric.latency !== undefined)
          row = row.floatColumn("latency", metric.latency);
        if (metric.jitter !== undefined)
          row = row.floatColumn("jitter", metric.jitter);
        if (metric.packetLoss !== undefined)
          row = row.floatColumn("packet_loss", metric.packetLoss);
        if (metric.downloadBandwidth !== undefined)
          row = row.intColumn("download_bandwidth", metric.downloadBandwidth);
        if (metric.uploadBandwidth !== undefined)
          row = row.intColumn("upload_bandwidth", metric.uploadBandwidth);

        row.at(BigInt(metric.timestamp.getTime()) * 1_000_000n, "ns");

        // Don't flush after every write - let auto-flush handle it
        // This allows batching for better performance
      },
      catch: (error) =>
        new DatabaseWriteError(`Failed to write metric: ${error}`),
    }).pipe(
      Effect.retry({
        times: 3,
        schedule: Schedule.exponential("100 millis"),
      })
    );

  /**
   * Query metrics using PostgreSQL wire protocol with parameterized queries.
   * This prevents SQL injection by using $1, $2, etc. placeholders.
   */
  const queryMetrics = (params: QueryMetricsParams) =>
    Effect.tryPromise({
      try: async () => {
        const startTime =
          params.startTime?.toISOString() ??
          new Date(Date.now() - 3600000).toISOString();
        const endTime =
          params.endTime?.toISOString() ?? new Date().toISOString();

        // Build query with parameterized placeholders
        // Note: QuestDB's SAMPLE BY doesn't support parameterized granularity,
        // but granularity values are from a fixed enum so they're safe.
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

        // If granularity is specified, use SAMPLE BY for aggregation
        // NOTE: Filter out negative latency values for historical data compatibility
        // (ping failures used to write latency=-1, now they write NULL)
        const query = params.granularity
          ? `
          SELECT
            timestamp,
            source,
            first(host) as host,
            avg(latency) as latency,
            avg(jitter) as jitter,
            max(packet_loss) as packet_loss,
            last(connectivity_status) as connectivity_status,
            avg(download_bandwidth) as download_bandwidth,
            avg(upload_bandwidth) as upload_bandwidth,
            last(server_location) as server_location,
            last(isp) as isp
          FROM network_metrics
          WHERE timestamp >= $1
            AND timestamp <= $2
            AND (latency IS NULL OR latency >= 0)
            ${hostFilter}
          SAMPLE BY ${params.granularity}
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
            isp
          FROM network_metrics
          WHERE timestamp >= $1
            AND timestamp <= $2
            ${hostFilter}
          ORDER BY timestamp DESC
          ${limitClause}
        `;

        const result = await pgClient.query(query, queryParams);

        if (!result.rows || result.rows.length === 0) {
          return [];
        }

        const rows: MetricRow[] = result.rows.map(
          (row: Record<string, unknown>) => ({
            timestamp: row.timestamp as string,
            source: row.source as "ping" | "speedtest",
            host: row.host as string | undefined,
            latency: row.latency as number | undefined,
            jitter: row.jitter as number | undefined,
            packet_loss: row.packet_loss as number | undefined,
            connectivity_status: row.connectivity_status as string | undefined,
            download_speed: row.download_bandwidth
              ? (row.download_bandwidth as number) / 1_000_000
              : undefined,
            upload_speed: row.upload_bandwidth
              ? (row.upload_bandwidth as number) / 1_000_000
              : undefined,
            server_location: row.server_location as string | undefined,
            isp: row.isp as string | undefined,
          })
        );

        return rows;
      },
      catch: (error) =>
        new DatabaseQueryError(`Failed to query metrics: ${error}`),
    });

  /**
   * Query connectivity status aggregated by time intervals.
   * Calculates up/down/degraded counts based on:
   * - Up: latency > 0 AND packet_loss < 5%
   * - Down: connectivity_status = 'down' OR latency < 0
   * - Degraded: packet_loss >= 5% AND packet_loss < 50%
   */
  const queryConnectivityStatus = (params: QueryMetricsParams) =>
    Effect.tryPromise({
      try: async () => {
        const startTime =
          params.startTime?.toISOString() ??
          new Date(Date.now() - 86400000).toISOString(); // Default 24h
        const endTime =
          params.endTime?.toISOString() ?? new Date().toISOString();

        // Validate and default granularity - only allow whitelisted values
        const granularity = params.granularity ?? "5m";
        const validGranularities = ["1m", "5m", "15m", "1h", "6h", "1d"];
        if (!validGranularities.includes(granularity)) {
          throw new Error(`Invalid granularity: ${granularity}`);
        }

        const queryParams: string[] = [startTime, endTime];

        // Query ping metrics and categorize by status
        // Note: granularity is validated against whitelist above, safe to interpolate
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

        const result = await pgClient.query(query, queryParams);

        if (!result.rows || result.rows.length === 0) {
          return [];
        }

        const rows: ConnectivityStatusRow[] = result.rows.map(
          (row: Record<string, unknown>) => ({
            timestamp: row.timestamp as string,
            up_count: Number(row.up_count ?? 0),
            down_count: Number(row.down_count ?? 0),
            degraded_count: Number(row.degraded_count ?? 0),
            total_count: Number(row.total_count ?? 0),
          })
        );

        return rows;
      },
      catch: (error) =>
        new DatabaseQueryError(`Failed to query connectivity status: ${error}`),
    });

  const health = () =>
    Effect.gen(function* () {
      // Test database connection by writing and flushing a test row
      yield* Effect.tryPromise({
        try: async () => {
          sender
            .table("health_check")
            .symbol("status", "ping")
            .at(BigInt(Date.now()) * 1_000_000n, "ns");
          await sender.flush();
        },
        catch: (error) =>
          new DatabaseConnectionError(`Health check failed: ${error}`),
      });

      return {
        connected: true,
        version: "QuestDB 8.x",
        uptime: process.uptime(),
      };
    });

  const close = () =>
    Effect.gen(function* () {
      // Flush any remaining buffered data before closing
      yield* Effect.tryPromise({
        try: async () => {
          await sender.flush();
        },
        catch: (error) =>
          new DatabaseWriteError(`Failed to flush buffer on close: ${error}`),
      });

      // Close the Sender connection
      yield* Effect.promise(async () => {
        await sender.close();
      });

      // Close the PgClient connection
      yield* Effect.promise(async () => {
        await pgClient.end();
      });
    }).pipe(
      Effect.catchAll((error) => {
        // Log error but don't fail - we still want to close
        console.error("Error during QuestDB close:", error);
        return Effect.void;
      })
    );

  return {
    writeMetric,
    queryMetrics,
    queryConnectivityStatus,
    health,
    close,
  };
});

// Create layer with cleanup
export const QuestDBLive = Layer.scoped(
  QuestDB,
  Effect.gen(function* () {
    const service = yield* make;
    yield* Effect.addFinalizer(() => service.close());
    return service;
  })
);
