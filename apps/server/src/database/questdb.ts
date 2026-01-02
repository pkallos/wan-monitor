import { Sender } from "@questdb/nodejs-client";
import { type Granularity, VALID_GRANULARITIES } from "@wan-monitor/shared";
import type {
  DatabaseHealth,
  NetworkMetric,
} from "@wan-monitor/shared/metrics";
import { Context, Duration, Effect, Layer, Option, Ref } from "effect";
import { Client as PgClient, types } from "pg";
import { ConfigService, ConfigServiceLive } from "@/services/config";

// Disable pg's automatic timestamp parsing - return as ISO strings instead
types.setTypeParser(types.builtins.TIMESTAMP, (val: string) =>
  val ? `${val.replace(" ", "T")}Z` : val
);
types.setTypeParser(types.builtins.TIMESTAMPTZ, (val: string) =>
  val ? `${val.replace(" ", "T")}Z` : val
);

// ============================================================================
// Error Types
// ============================================================================

export class DatabaseConnectionError {
  readonly _tag = "DatabaseConnectionError";
  constructor(readonly message: string) {}
}

export class DbUnavailable {
  readonly _tag = "DbUnavailable";
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

// ============================================================================
// Types
// ============================================================================

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
  readonly external_ip?: string;
  readonly internal_ip?: string;
}

export interface ConnectivityStatusRow {
  readonly timestamp: string;
  readonly up_count: number;
  readonly down_count: number;
  readonly degraded_count: number;
  readonly total_count: number;
}

export interface QueryMetricsParams {
  readonly startTime?: Date;
  readonly endTime?: Date;
  readonly host?: string;
  readonly limit?: number;
  readonly granularity?: Granularity;
}

export interface QuerySpeedtestsParams {
  readonly startTime?: Date;
  readonly endTime?: Date;
  readonly limit?: number;
}

// ============================================================================
// Service Interface
// ============================================================================

export interface QuestDBService {
  readonly writeMetric: (
    metric: NetworkMetric
  ) => Effect.Effect<void, DatabaseWriteError | DbUnavailable>;
  readonly queryMetrics: (
    params: QueryMetricsParams
  ) => Effect.Effect<readonly MetricRow[], DatabaseQueryError | DbUnavailable>;
  readonly querySpeedtests: (
    params: QuerySpeedtestsParams
  ) => Effect.Effect<readonly MetricRow[], DatabaseQueryError | DbUnavailable>;
  readonly queryConnectivityStatus: (
    params: QueryMetricsParams
  ) => Effect.Effect<
    readonly ConnectivityStatusRow[],
    DatabaseQueryError | DbUnavailable
  >;
  readonly health: () => Effect.Effect<
    DatabaseHealth,
    DatabaseConnectionError | DbUnavailable
  >;
  readonly close: () => Effect.Effect<void>;
}

export class QuestDB extends Context.Tag("QuestDB")<
  QuestDB,
  QuestDBService
>() {}

// ============================================================================
// Internal Types
// ============================================================================

const QUESTDB_PG_PORT = 8812;

interface Connection {
  readonly sender: Sender;
  readonly pgClient: PgClient;
}

interface ConnectionState {
  readonly connection: Option.Option<Connection>;
  readonly isConnecting: boolean;
  readonly lastError: Option.Option<{ message: string; timestamp: Date }>;
  readonly connectedSince: Option.Option<Date>;
}

const initialState: ConnectionState = {
  connection: Option.none(),
  isConnecting: false,
  lastError: Option.none(),
  connectedSince: Option.none(),
};

// ============================================================================
// Helper Functions
// ============================================================================

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isLikelyConnectionError = (message: string): boolean => {
  const m = message.toLowerCase();
  return (
    m.includes("econnrefused") ||
    m.includes("econnreset") ||
    m.includes("enotfound") ||
    m.includes("timeout") ||
    m.includes("connect") ||
    m.includes("connection") ||
    m.includes("socket") ||
    m.includes("terminated")
  );
};

const writeMetricToSender = (sender: Sender, metric: NetworkMetric): void => {
  let row = sender.table("network_metrics").symbol("source", metric.source);

  if (metric.host) row = row.symbol("host", metric.host);
  if (metric.latency !== undefined)
    row = row.floatColumn("latency", metric.latency);
  if (metric.jitter !== undefined)
    row = row.floatColumn("jitter", metric.jitter);
  if (metric.packetLoss !== undefined)
    row = row.floatColumn("packet_loss", metric.packetLoss);
  if (metric.connectivityStatus)
    row = row.stringColumn("connectivity_status", metric.connectivityStatus);
  if (metric.downloadBandwidth !== undefined)
    row = row.intColumn("download_bandwidth", metric.downloadBandwidth);
  if (metric.uploadBandwidth !== undefined)
    row = row.intColumn("upload_bandwidth", metric.uploadBandwidth);
  if (metric.serverLocation)
    row = row.stringColumn("server_location", metric.serverLocation);
  if (metric.isp) row = row.stringColumn("isp", metric.isp);
  if (metric.externalIp)
    row = row.stringColumn("external_ip", metric.externalIp);
  if (metric.internalIp)
    row = row.stringColumn("internal_ip", metric.internalIp);

  row.at(BigInt(metric.timestamp.getTime()) * 1_000_000n, "ns");
};

// ============================================================================
// Connection Manager Implementation
// ============================================================================

const make = Effect.gen(function* () {
  const config = yield* ConfigService;

  const connectTimeoutMs = 5000;
  const reconnectIntervalMs = 2000;
  const healthCheckIntervalMs = 5000;

  // State
  const stateRef = yield* Ref.make<ConnectionState>(initialState);

  // Build connection string for QuestDB sender
  const buildSenderConnectionString = (): string => {
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

  // Close a connection safely
  const closeConnection = (conn: Connection): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* Effect.promise(async () => {
        try {
          await conn.sender.flush();
        } catch {
          // Ignore flush errors on close
        }
        try {
          await conn.sender.close();
        } catch {
          // Ignore close errors
        }
        try {
          await conn.pgClient.end();
        } catch {
          // Ignore end errors
        }
      });
    });

  // Create a new connection with proper timeouts
  const createConnection = Effect.gen(function* () {
    yield* Effect.logDebug("Attempting to create QuestDB connection...");

    // Create sender
    const connectionString = buildSenderConnectionString();
    const sender = yield* Effect.tryPromise({
      try: async () => {
        const s = await Sender.fromConfig(connectionString);
        if (config.database.protocol === "tcp") {
          await s.connect();
        }
        return s;
      },
      catch: (error) =>
        new DatabaseConnectionError(
          `Sender connection failed: ${errorMessage(error)}`
        ),
    });

    // Create pg client with connection timeout
    const pgClient = new PgClient({
      host: config.database.host,
      port: QUESTDB_PG_PORT,
      database: "qdb",
      user: "admin",
      password: "quest",
      connectionTimeoutMillis: connectTimeoutMs,
      query_timeout: connectTimeoutMs,
      statement_timeout: connectTimeoutMs,
    });

    // Connect pg client
    yield* Effect.tryPromise({
      try: () => pgClient.connect(),
      catch: (error) =>
        new DatabaseConnectionError(
          `PgWire connection failed: ${errorMessage(error)}`
        ),
    }).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          // Clean up sender if pg fails
          yield* Effect.promise(async () => {
            try {
              await sender.close();
            } catch {
              // Ignore
            }
          });
          return yield* Effect.fail(error);
        })
      )
    );

    // Verify connection works with a simple query
    yield* Effect.tryPromise({
      try: () => pgClient.query("SELECT 1"),
      catch: (error) =>
        new DatabaseConnectionError(
          `Connection verification failed: ${errorMessage(error)}`
        ),
    }).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* Effect.promise(async () => {
            try {
              await sender.close();
            } catch {
              // Ignore
            }
            try {
              await pgClient.end();
            } catch {
              // Ignore
            }
          });
          return yield* Effect.fail(error);
        })
      )
    );

    yield* Effect.logInfo("QuestDB connection established");

    return { sender, pgClient } satisfies Connection;
  });

  // Mark connection as failed and trigger reconnect
  const markDisconnected = (error: string): Effect.Effect<void> =>
    Effect.gen(function* () {
      const state = yield* Ref.get(stateRef);

      // Close existing connection if any
      if (Option.isSome(state.connection)) {
        yield* closeConnection(state.connection.value).pipe(Effect.ignore);
      }

      yield* Ref.set(stateRef, {
        connection: Option.none(),
        isConnecting: false,
        lastError: Option.some({ message: error, timestamp: new Date() }),
        connectedSince: Option.none(),
      });

      yield* Effect.logWarning(`QuestDB disconnected: ${error}`);
    });

  // Handle pg client error events by bridging to Effect
  const attachPgErrorHandler = (pgClient: PgClient): void => {
    pgClient.on("error", (error: Error) => {
      // Bridge the error event to our Effect state machine
      Effect.runFork(markDisconnected(error.message));
    });
  };

  // The main connection/health loop - runs forever in background
  const connectionLoop = Effect.gen(function* () {
    yield* Effect.logInfo("QuestDB connection loop started");

    while (true) {
      const state = yield* Ref.get(stateRef);

      if (Option.isNone(state.connection)) {
        // Not connected - try to connect
        yield* Ref.update(stateRef, (s) => ({ ...s, isConnecting: true }));

        const result = yield* createConnection.pipe(
          Effect.timeout(Duration.millis(connectTimeoutMs * 2)),
          Effect.option
        );

        if (Option.isSome(result)) {
          const conn = result.value;

          // Attach error handler to detect disconnects
          attachPgErrorHandler(conn.pgClient);

          yield* Ref.set(stateRef, {
            connection: Option.some(conn),
            isConnecting: false,
            lastError: Option.none(),
            connectedSince: Option.some(new Date()),
          });

          yield* Effect.logInfo("QuestDB connected successfully");
        } else {
          // Connection failed or timed out
          yield* Ref.update(stateRef, (s) => ({
            ...s,
            isConnecting: false,
            lastError: Option.some({
              message: "Connection attempt timed out",
              timestamp: new Date(),
            }),
          }));

          yield* Effect.logWarning("QuestDB connection attempt failed");

          // Wait before retrying
          yield* Effect.sleep(Duration.millis(reconnectIntervalMs));
        }
      } else {
        // Connected - do a health check
        const conn = state.connection.value;

        const healthOk = yield* Effect.tryPromise({
          try: () => conn.pgClient.query("SELECT 1"),
          catch: (error) => errorMessage(error),
        }).pipe(
          Effect.timeout(Duration.millis(connectTimeoutMs)),
          Effect.match({
            onFailure: () => false,
            onSuccess: () => true,
          })
        );

        if (!healthOk) {
          yield* markDisconnected("Health check failed");
        } else {
          // All good - wait before next health check
          yield* Effect.sleep(Duration.millis(healthCheckIntervalMs));
        }
      }
    }
  });

  // Fork the connection loop as a supervised background fiber
  yield* Effect.forkScoped(
    connectionLoop.pipe(
      Effect.catchAllCause((cause) =>
        Effect.logError("Connection loop crashed", cause).pipe(
          Effect.zipRight(Effect.sleep(Duration.seconds(5))),
          Effect.zipRight(connectionLoop)
        )
      )
    )
  );

  // Add finalizer to clean up connection on shutdown
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      const state = yield* Ref.get(stateRef);
      if (Option.isSome(state.connection)) {
        yield* closeConnection(state.connection.value);
      }
      yield* Effect.logInfo("QuestDB connection closed");
    })
  );

  // Wait a bit for initial connection attempt
  yield* Effect.sleep(Duration.millis(100));

  // ============================================================================
  // Service Methods
  // ============================================================================

  const getConnection = Effect.gen(function* () {
    const state = yield* Ref.get(stateRef);
    if (Option.isNone(state.connection)) {
      const errorMsg = Option.isSome(state.lastError)
        ? state.lastError.value.message
        : "Database not connected";
      return yield* Effect.fail(new DbUnavailable(errorMsg));
    }
    return state.connection.value;
  });

  const writeMetric = (
    metric: NetworkMetric
  ): Effect.Effect<void, DatabaseWriteError | DbUnavailable> =>
    Effect.gen(function* () {
      const conn = yield* getConnection;

      yield* Effect.tryPromise({
        try: async () => {
          writeMetricToSender(conn.sender, metric);
        },
        catch: (error) => {
          const msg = errorMessage(error);
          if (isLikelyConnectionError(msg)) {
            return new DbUnavailable(msg);
          }
          return new DatabaseWriteError(`Failed to write metric: ${msg}`);
        },
      });
    }).pipe(
      Effect.catchTag("DbUnavailable", (e) =>
        markDisconnected(e.message).pipe(Effect.zipRight(Effect.fail(e)))
      )
    );

  const queryMetrics = (
    params: QueryMetricsParams
  ): Effect.Effect<readonly MetricRow[], DatabaseQueryError | DbUnavailable> =>
    Effect.gen(function* () {
      const conn = yield* getConnection;

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

      const result = yield* Effect.tryPromise({
        try: () => conn.pgClient.query(query, queryParams),
        catch: (error) => {
          const msg = errorMessage(error);
          if (isLikelyConnectionError(msg)) {
            return new DbUnavailable(msg);
          }
          return new DatabaseQueryError(`Failed to query metrics: ${msg}`);
        },
      });

      if (!result.rows || result.rows.length === 0) {
        return [];
      }

      return result.rows.map(
        (row: Record<string, unknown>) =>
          ({
            timestamp: row.timestamp as string,
            source: row.source as "ping" | "speedtest",
            host: row.host as string | undefined,
            latency:
              row.latency !== null && row.latency !== undefined
                ? (row.latency as number)
                : undefined,
            jitter:
              row.jitter !== null && row.jitter !== undefined
                ? (row.jitter as number)
                : undefined,
            packet_loss:
              row.packet_loss !== null && row.packet_loss !== undefined
                ? (row.packet_loss as number)
                : undefined,
            connectivity_status: row.connectivity_status as string | undefined,
            download_speed: row.download_bandwidth
              ? (row.download_bandwidth as number) / 1_000_000
              : undefined,
            upload_speed: row.upload_bandwidth
              ? (row.upload_bandwidth as number) / 1_000_000
              : undefined,
            server_location: row.server_location as string | undefined,
            isp: row.isp as string | undefined,
            external_ip: row.external_ip as string | undefined,
            internal_ip: row.internal_ip as string | undefined,
          }) satisfies MetricRow
      );
    }).pipe(
      Effect.catchTag("DbUnavailable", (e) =>
        markDisconnected(e.message).pipe(Effect.zipRight(Effect.fail(e)))
      )
    );

  const querySpeedtests = (
    params: QuerySpeedtestsParams
  ): Effect.Effect<readonly MetricRow[], DatabaseQueryError | DbUnavailable> =>
    Effect.gen(function* () {
      const conn = yield* getConnection;

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

      const result = yield* Effect.tryPromise({
        try: () => conn.pgClient.query(query, queryParams),
        catch: (error) => {
          const msg = errorMessage(error);
          if (isLikelyConnectionError(msg)) {
            return new DbUnavailable(msg);
          }
          return new DatabaseQueryError(`Failed to query speedtests: ${msg}`);
        },
      });

      if (!result.rows || result.rows.length === 0) {
        return [];
      }

      return result.rows.map(
        (row: Record<string, unknown>) =>
          ({
            timestamp: row.timestamp as string,
            source: row.source as "ping" | "speedtest",
            host: row.host as string | undefined,
            latency:
              row.latency !== null && row.latency !== undefined
                ? (row.latency as number)
                : undefined,
            jitter:
              row.jitter !== null && row.jitter !== undefined
                ? (row.jitter as number)
                : undefined,
            packet_loss:
              row.packet_loss !== null && row.packet_loss !== undefined
                ? (row.packet_loss as number)
                : undefined,
            connectivity_status: row.connectivity_status as string | undefined,
            download_speed: row.download_bandwidth
              ? (row.download_bandwidth as number) / 1_000_000
              : undefined,
            upload_speed: row.upload_bandwidth
              ? (row.upload_bandwidth as number) / 1_000_000
              : undefined,
            server_location: row.server_location as string | undefined,
            isp: row.isp as string | undefined,
            external_ip: row.external_ip as string | undefined,
            internal_ip: row.internal_ip as string | undefined,
          }) satisfies MetricRow
      );
    }).pipe(
      Effect.catchTag("DbUnavailable", (e) =>
        markDisconnected(e.message).pipe(Effect.zipRight(Effect.fail(e)))
      )
    );

  const queryConnectivityStatus = (
    params: QueryMetricsParams
  ): Effect.Effect<
    readonly ConnectivityStatusRow[],
    DatabaseQueryError | DbUnavailable
  > =>
    Effect.gen(function* () {
      const conn = yield* getConnection;

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

      const result = yield* Effect.tryPromise({
        try: () => conn.pgClient.query(query, [startTime, endTime]),
        catch: (error) => {
          const msg = errorMessage(error);
          if (isLikelyConnectionError(msg)) {
            return new DbUnavailable(msg);
          }
          return new DatabaseQueryError(
            `Failed to query connectivity status: ${msg}`
          );
        },
      });

      if (!result.rows || result.rows.length === 0) {
        return [];
      }

      return result.rows.map(
        (row: Record<string, unknown>) =>
          ({
            timestamp: row.timestamp as string,
            up_count: Number(row.up_count ?? 0),
            down_count: Number(row.down_count ?? 0),
            degraded_count: Number(row.degraded_count ?? 0),
            total_count: Number(row.total_count ?? 0),
          }) satisfies ConnectivityStatusRow
      );
    }).pipe(
      Effect.catchTag("DbUnavailable", (e) =>
        markDisconnected(e.message).pipe(Effect.zipRight(Effect.fail(e)))
      )
    );

  const health = (): Effect.Effect<
    DatabaseHealth,
    DatabaseConnectionError | DbUnavailable
  > =>
    Effect.gen(function* () {
      const state = yield* Ref.get(stateRef);

      if (Option.isNone(state.connection)) {
        const errorMsg = Option.isSome(state.lastError)
          ? state.lastError.value.message
          : "Database not connected";
        return yield* Effect.fail(new DbUnavailable(errorMsg));
      }

      const conn = state.connection.value;

      yield* Effect.tryPromise({
        try: () => conn.pgClient.query("SELECT 1"),
        catch: (error) =>
          new DatabaseConnectionError(`Health check failed: ${error}`),
      });

      const uptime = Option.isSome(state.connectedSince)
        ? (Date.now() - state.connectedSince.value.getTime()) / 1000
        : 0;

      return {
        connected: true,
        uptime,
      } satisfies DatabaseHealth;
    });

  const close = (): Effect.Effect<void> =>
    Effect.gen(function* () {
      const state = yield* Ref.get(stateRef);
      if (Option.isSome(state.connection)) {
        yield* closeConnection(state.connection.value);
      }
      yield* Ref.set(stateRef, initialState);
    });

  return {
    writeMetric,
    queryMetrics,
    querySpeedtests,
    queryConnectivityStatus,
    health,
    close,
  } satisfies QuestDBService;
});

// ============================================================================
// Layer
// ============================================================================

export const QuestDBLive = Layer.scoped(QuestDB, make).pipe(
  Layer.provide(ConfigServiceLive)
);
