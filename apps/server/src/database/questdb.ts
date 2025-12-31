import { HttpClient } from '@effect/platform';
import { NodeHttpClient } from '@effect/platform-node';
import { Sender } from '@questdb/nodejs-client';
import type { Granularity } from '@wan-monitor/shared';
import type {
  DatabaseHealth,
  NetworkMetric,
} from '@wan-monitor/shared/metrics';
import { Context, Effect, Layer, Schedule } from 'effect';
import { ConfigService } from '@/services/config';

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

// Query result type
export interface MetricRow {
  readonly timestamp: string;
  readonly source: 'ping' | 'speedtest';
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

// QuestDB service interface
export interface QuestDBService {
  readonly writeMetric: (
    metric: NetworkMetric
  ) => Effect.Effect<void, DatabaseWriteError>;
  readonly queryMetrics: (
    params: QueryMetricsParams
  ) => Effect.Effect<readonly MetricRow[], DatabaseQueryError>;
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

  const queryMetrics = (params: QueryMetricsParams) =>
    Effect.gen(function* () {
      const startTime =
        params.startTime?.toISOString() ??
        new Date(Date.now() - 3600000).toISOString();
      const endTime = params.endTime?.toISOString() ?? new Date().toISOString();
      const hostFilter = params.host ? `AND host = '${params.host}'` : '';

      // If granularity is specified, use SAMPLE BY for aggregation
      // NOTE: Filter out negative latency values (written on ping failures)
      // to avoid skewing averages.
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
        WHERE timestamp >= '${startTime}'
          AND timestamp <= '${endTime}'
          AND (latency IS NULL OR latency >= 0)
          ${hostFilter}
        SAMPLE BY ${params.granularity}
        ORDER BY timestamp DESC
        ${params.limit ? `LIMIT ${params.limit}` : ''}
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
        WHERE timestamp >= '${startTime}'
          AND timestamp <= '${endTime}'
          ${hostFilter}
        ORDER BY timestamp DESC
        ${params.limit ? `LIMIT ${params.limit}` : ''}
      `;

      const response = yield* httpClient
        .get(`http://${config.database.host}:${config.database.port}/exec`, {
          urlParams: { query },
        })
        .pipe(
          Effect.flatMap((res) => res.json),
          Effect.catchAll((error) =>
            Effect.fail(
              new DatabaseQueryError(`Failed to query metrics: ${error}`)
            )
          )
        );

      const data = response as {
        query: string;
        columns: Array<{ name: string; type: string }>;
        dataset?: Array<Array<string | number | null>>;
        count: number;
      };

      if (!data.dataset || data.dataset.length === 0) {
        return [];
      }

      const rows: MetricRow[] = data.dataset.map((row) => ({
        timestamp: row[0] as string,
        source: row[1] as 'ping' | 'speedtest',
        host: row[2] as string | undefined,
        latency: row[3] as number | undefined,
        jitter: row[4] as number | undefined,
        packet_loss: row[5] as number | undefined,
        connectivity_status: row[6] as string | undefined,
        download_speed: row[7] ? (row[7] as number) / 1_000_000 : undefined,
        upload_speed: row[8] ? (row[8] as number) / 1_000_000 : undefined,
        server_location: row[9] as string | undefined,
        isp: row[10] as string | undefined,
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

  return {
    writeMetric,
    queryMetrics,
    health,
    close,
  };
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
