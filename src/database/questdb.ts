import { HttpClient } from '@effect/platform';
import { NodeHttpClient } from '@effect/platform-node';
import { Sender } from '@questdb/nodejs-client';
import { Context, Effect, Layer, Schedule } from 'effect';
import { ConfigService } from '@/services/config';
import type { DatabaseHealth, NetworkMetric } from '@/types/metrics';

// Database errors
export class DatabaseConnectionError {
  readonly _tag = 'DatabaseConnectionError';
  constructor(readonly message: string) {}
}

export class DatabaseWriteError {
  readonly _tag = 'DatabaseWriteError';
  constructor(readonly message: string) {}
}

export class DatabaseQueryError {
  readonly _tag = 'DatabaseQueryError';
  constructor(readonly message: string) {}
}

// Query result types
export interface PingMetricRow {
  readonly timestamp: string; // ISO8601
  readonly host: string;
  readonly latency: number;
  readonly packet_loss: number;
  readonly connectivity_status: string;
  readonly jitter?: number;
}

export interface QueryPingMetricsParams {
  readonly startTime?: Date;
  readonly endTime?: Date;
  readonly host?: string;
  readonly limit?: number;
}

// QuestDB service interface
export interface QuestDBService {
  readonly writeMetric: (
    metric: NetworkMetric
  ) => Effect.Effect<void, DatabaseWriteError>;
  readonly queryPingMetrics: (
    params: QueryPingMetricsParams
  ) => Effect.Effect<readonly PingMetricRow[], DatabaseQueryError>;
  readonly health: () => Effect.Effect<DatabaseHealth, DatabaseConnectionError>;
  readonly close: () => Effect.Effect<void>;
}

// QuestDB service tag
export class QuestDB extends Context.Tag('QuestDB')<
  QuestDB,
  QuestDBService
>() {}

// Implementation
const make = Effect.gen(function* () {
  const config = yield* ConfigService;
  const httpClient = yield* HttpClient.HttpClient;

  // Build connection string based on protocol
  const buildConnectionString = () => {
    const {
      host,
      port,
      protocol,
      autoFlushRows,
      autoFlushInterval,
      requestTimeout,
      retryTimeout,
    } = config.database;

    if (protocol === 'http') {
      return `http::addr=${host}:${port};auto_flush_rows=${autoFlushRows};auto_flush_interval=${autoFlushInterval};request_timeout=${requestTimeout};retry_timeout=${retryTimeout};`;
    }
    return `tcp::addr=${host}:9009;auto_flush_rows=${autoFlushRows};auto_flush_interval=${autoFlushInterval};`;
  };

  // Initialize sender with connection
  const sender = yield* Effect.tryPromise({
    try: async () => {
      const connectionString = buildConnectionString();
      const s = await Sender.fromConfig(connectionString);

      // Only call connect() for TCP protocol
      if (config.database.protocol === 'tcp') {
        await s.connect();
      }

      return s;
    },
    catch: (error) =>
      new DatabaseConnectionError(`Failed to connect to QuestDB: ${error}`),
  });

  const writeMetric = (metric: NetworkMetric) =>
    Effect.tryPromise({
      try: async () => {
        // Write to network_metrics table
        // NOTE: In QuestDB ILP, symbols MUST come before columns
        let row = sender
          .table('network_metrics')
          .symbol('source', metric.source);

        // Add optional symbols first (must be before columns)
        if (metric.host) row = row.symbol('host', metric.host);
        if (metric.connectivityStatus)
          row = row.symbol('connectivity_status', metric.connectivityStatus);
        if (metric.serverLocation)
          row = row.symbol('server_location', metric.serverLocation);
        if (metric.isp) row = row.symbol('isp', metric.isp);

        // Add numeric columns after symbols
        if (metric.latency !== undefined)
          row = row.floatColumn('latency', metric.latency);
        if (metric.jitter !== undefined)
          row = row.floatColumn('jitter', metric.jitter);
        if (metric.packetLoss !== undefined)
          row = row.floatColumn('packet_loss', metric.packetLoss);
        if (metric.downloadBandwidth !== undefined)
          row = row.intColumn('download_bandwidth', metric.downloadBandwidth);
        if (metric.uploadBandwidth !== undefined)
          row = row.intColumn('upload_bandwidth', metric.uploadBandwidth);

        row.at(BigInt(metric.timestamp.getTime()) * 1_000_000n, 'ns');

        // Don't flush after every write - let auto-flush handle it
        // This allows batching for better performance
      },
      catch: (error) =>
        new DatabaseWriteError(`Failed to write metric: ${error}`),
    }).pipe(
      Effect.retry({
        times: 3,
        schedule: Schedule.exponential('100 millis'),
      })
    );

  const queryPingMetrics = (params: QueryPingMetricsParams) =>
    Effect.gen(function* () {
      // Default to last hour if no time range specified
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const startTime = params.startTime ?? oneHourAgo;
      const endTime = params.endTime ?? now;
      const limit = params.limit ?? 1000;

      // Build SQL query
      let sql = `
        SELECT
          timestamp,
          host,
          latency,
          packet_loss,
          connectivity_status
        FROM network_metrics
        WHERE source = 'ping'
          AND timestamp BETWEEN '${startTime.toISOString()}' AND '${endTime.toISOString()}'
      `;

      if (params.host) {
        sql += ` AND host = '${params.host}'`;
      }

      sql += ` ORDER BY timestamp DESC LIMIT ${limit}`;

      // Query QuestDB HTTP API
      const response = yield* httpClient
        .get(`http://${config.database.host}:${config.database.port}/exec`, {
          urlParams: { query: sql },
        })
        .pipe(
          Effect.flatMap((res) => res.json),
          Effect.catchAll((error) =>
            Effect.fail(
              new DatabaseQueryError(`Failed to query metrics: ${error}`)
            )
          )
        );

      // Parse response
      const data = response as {
        query: string;
        columns: Array<{ name: string; type: string }>;
        dataset?: Array<Array<string | number>>;
        count: number;
      };

      // Handle empty or missing dataset
      if (!data.dataset || data.dataset.length === 0) {
        return [];
      }

      // Map rows to PingMetricRow
      const rows: PingMetricRow[] = data.dataset.map((row) => ({
        timestamp: row[0] as string,
        host: row[1] as string,
        latency: row[2] as number,
        packet_loss: row[3] as number,
        connectivity_status: row[4] as string,
        jitter: undefined, // Not stored in table yet
      }));

      return rows;
    });

  const health = () =>
    Effect.gen(function* () {
      // Test database connection by writing and flushing a test row
      yield* Effect.tryPromise({
        try: async () => {
          sender
            .table('health_check')
            .symbol('status', 'ping')
            .at(BigInt(Date.now()) * 1_000_000n, 'ns');
          await sender.flush();
        },
        catch: (error) =>
          new DatabaseConnectionError(`Health check failed: ${error}`),
      });

      return {
        connected: true,
        version: 'QuestDB 8.x',
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

      // Close the connection
      yield* Effect.promise(async () => {
        await sender.close();
      });
    }).pipe(
      Effect.catchAll((error) => {
        // Log error but don't fail - we still want to close
        console.error('Error during QuestDB close:', error);
        return Effect.void;
      })
    );

  return { writeMetric, queryPingMetrics, health, close };
});

// Create layer with cleanup - provide HttpClient dependency
export const QuestDBLive = Layer.scoped(
  QuestDB,
  Effect.gen(function* () {
    const service = yield* make;
    yield* Effect.addFinalizer(() => service.close());
    return service;
  })
).pipe(Layer.provide(NodeHttpClient.layerUndici));
