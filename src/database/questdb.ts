import { Sender } from '@questdb/nodejs-client';
import { Context, Effect, Layer } from 'effect';
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

// QuestDB service interface
export interface QuestDBService {
  readonly writeMetric: (
    metric: NetworkMetric
  ) => Effect.Effect<void, DatabaseWriteError>;
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

  // Initialize sender with connection (use TCP/ILP protocol on port 9009)
  const sender = yield* Effect.tryPromise({
    try: async () => {
      const s = await Sender.fromConfig(
        `tcp::addr=${config.database.host}:9009;`
      );
      await s.connect();
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
        await sender.flush();
      },
      catch: (error) =>
        new DatabaseWriteError(`Failed to write metric: ${error}`),
    });

  const health = () =>
    Effect.tryPromise({
      try: async () => {
        // Actually test database connection by writing and flushing a test row
        sender
          .table('health_check')
          .symbol('status', 'ping')
          .at(BigInt(Date.now()) * 1_000_000n, 'ns');
        await sender.flush();

        return {
          connected: true,
          version: 'QuestDB 8.x',
          uptime: process.uptime(),
        };
      },
      catch: (error) =>
        new DatabaseConnectionError(`Health check failed: ${error}`),
    });

  const close = () =>
    Effect.promise(async () => {
      await sender.close();
    });

  return { writeMetric, health, close };
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
