import type { DatabaseHealth, NetworkMetric } from "@shared/metrics";
import { Context, Duration, Effect, Layer, Option } from "effect";
import { ConfigService } from "@/infrastructure/config/config";
import {
  QuestDBConnection,
  QuestDBConnectionLive,
} from "@/infrastructure/database/questdb/connection";
import {
  DatabaseConnectionError,
  DatabaseQueryError,
  DatabaseWriteError,
  DbUnavailable,
} from "@/infrastructure/database/questdb/errors";
import { writeMetricToSender } from "@/infrastructure/database/questdb/ilp";
import {
  attachOutageHosts,
  mapConnectivityStatusRow,
  mapCyclePeriodMs,
  mapHostStatsRow,
  mapLiveConnectivityRow,
  mapMetricRow,
  mapOutageHostRow,
  mapOutageRunRow,
  mapSummaryStatsRow,
} from "@/infrastructure/database/questdb/mappers";
import type {
  ConnectivityStatusRow,
  HostStatsRow,
  LiveConnectivityRow,
  MetricRow,
  OutageRun,
  QueryMetricsParams,
  QueryOutageParams,
  QuerySpeedtestsParams,
  QueryWindowParams,
  SummaryStatsRow,
} from "@/infrastructure/database/questdb/model";
import { configurePgTypeParsers } from "@/infrastructure/database/questdb/pgwire";
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
  type SqlQuerySpec,
} from "@/infrastructure/database/questdb/queries";
import {
  errorMessage,
  isLikelyConnectionError,
} from "@/infrastructure/database/questdb/util";

configurePgTypeParsers();

export interface QuestDBService {
  readonly writeMetric: (
    metric: NetworkMetric
  ) => Effect.Effect<void, DatabaseWriteError | DbUnavailable>;
  readonly flush: () => Effect.Effect<void, DatabaseWriteError | DbUnavailable>;
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
  readonly queryLiveConnectivity: (
    sinceIso: string
  ) => Effect.Effect<
    LiveConnectivityRow | null,
    DatabaseQueryError | DbUnavailable
  >;
  readonly queryEarliestTimestamp: () => Effect.Effect<
    string | null,
    DatabaseQueryError | DbUnavailable
  >;
  readonly queryLatestPingTimestamp: () => Effect.Effect<
    string | null,
    DatabaseQueryError | DbUnavailable
  >;
  readonly querySummaryStats: (
    params: QueryWindowParams
  ) => Effect.Effect<SummaryStatsRow, DatabaseQueryError | DbUnavailable>;
  readonly queryHostStats: (
    params: QueryWindowParams
  ) => Effect.Effect<
    readonly HostStatsRow[],
    DatabaseQueryError | DbUnavailable
  >;
  readonly queryOutageRuns: (
    params: QueryOutageParams
  ) => Effect.Effect<readonly OutageRun[], DatabaseQueryError | DbUnavailable>;
  readonly queryCyclePeriod: (
    params: QueryWindowParams
  ) => Effect.Effect<number | null, DatabaseQueryError | DbUnavailable>;
  readonly health: () => Effect.Effect<
    DatabaseHealth,
    DatabaseConnectionError | DbUnavailable
  >;
  readonly close: () => Effect.Effect<void>;
}

export class QuestDB extends Context.Service<QuestDB, QuestDBService>()(
  "QuestDB"
) {}

const make = Effect.gen(function* () {
  const connection = yield* QuestDBConnection;
  const config = yield* ConfigService;
  const table = config.database.table;
  const ilpTimeoutMs =
    config.database.requestTimeout + config.database.retryTimeout;

  // undici retries refused connections indefinitely and ignores retry_timeout,
  // so a sender call against a down QuestDB never settles on its own.
  const withIlpTimeout = <A, E, R>(
    operation: "write" | "flush",
    effect: Effect.Effect<A, E, R>
  ) =>
    effect.pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(ilpTimeoutMs),
        orElse: () =>
          Effect.fail(
            new DbUnavailable({
              message: `QuestDB ${operation} timed out after ${ilpTimeoutMs}ms`,
            })
          ),
      })
    );

  const writeMetric = (
    metric: NetworkMetric
  ): Effect.Effect<void, DatabaseWriteError | DbUnavailable> =>
    Effect.gen(function* () {
      const conn = yield* connection.getConnection;

      yield* withIlpTimeout(
        "write",
        Effect.tryPromise({
          try: () => writeMetricToSender(conn.sender, metric, table),
          catch: (error) => {
            const msg = errorMessage(error);
            if (isLikelyConnectionError(msg)) {
              return new DbUnavailable({ message: msg });
            }
            return new DatabaseWriteError({
              message: `Failed to write metric: ${msg}`,
            });
          },
        })
      );
    }).pipe(
      Effect.catchTag("DbUnavailable", (e) =>
        connection
          .markDisconnected(e.message)
          .pipe(Effect.andThen(Effect.fail(e)))
      )
    );

  const queryMetrics = (
    params: QueryMetricsParams
  ): Effect.Effect<readonly MetricRow[], DatabaseQueryError | DbUnavailable> =>
    Effect.gen(function* () {
      const conn = yield* connection.getConnection;

      const spec = yield* buildQueryMetrics(params, table);

      const result = yield* Effect.tryPromise({
        try: () => conn.pgClient.query(spec.query, Array.from(spec.params)),
        catch: (error) => {
          const msg = errorMessage(error);
          if (isLikelyConnectionError(msg)) {
            return new DbUnavailable({ message: msg });
          }
          return new DatabaseQueryError({
            message: `Failed to query metrics: ${msg}`,
          });
        },
      });

      if (!result.rows || result.rows.length === 0) {
        return [];
      }

      return result.rows.map(mapMetricRow);
    }).pipe(
      Effect.catchTag("DbUnavailable", (e) =>
        connection
          .markDisconnected(e.message)
          .pipe(Effect.andThen(Effect.fail(e)))
      )
    );

  const querySpeedtests = (
    params: QuerySpeedtestsParams
  ): Effect.Effect<readonly MetricRow[], DatabaseQueryError | DbUnavailable> =>
    Effect.gen(function* () {
      const conn = yield* connection.getConnection;

      const spec = yield* buildQuerySpeedtests(params, table);

      const result = yield* Effect.tryPromise({
        try: () => conn.pgClient.query(spec.query, Array.from(spec.params)),
        catch: (error) => {
          const msg = errorMessage(error);
          if (isLikelyConnectionError(msg)) {
            return new DbUnavailable({ message: msg });
          }
          return new DatabaseQueryError({
            message: `Failed to query speedtests: ${msg}`,
          });
        },
      });

      if (!result.rows || result.rows.length === 0) {
        return [];
      }

      return result.rows.map(mapMetricRow);
    }).pipe(
      Effect.catchTag("DbUnavailable", (e) =>
        connection
          .markDisconnected(e.message)
          .pipe(Effect.andThen(Effect.fail(e)))
      )
    );

  const queryConnectivityStatus = (
    params: QueryMetricsParams
  ): Effect.Effect<
    readonly ConnectivityStatusRow[],
    DatabaseQueryError | DbUnavailable
  > =>
    Effect.gen(function* () {
      const conn = yield* connection.getConnection;

      const spec = yield* buildQueryConnectivityStatus(params, table);

      const result = yield* Effect.tryPromise({
        try: () => conn.pgClient.query(spec.query, Array.from(spec.params)),
        catch: (error) => {
          const msg = errorMessage(error);
          if (isLikelyConnectionError(msg)) {
            return new DbUnavailable({ message: msg });
          }
          return new DatabaseQueryError({
            message: `Failed to query connectivity status: ${msg}`,
          });
        },
      });

      if (!result.rows || result.rows.length === 0) {
        return [];
      }

      return result.rows.map(mapConnectivityStatusRow);
    }).pipe(
      Effect.catchTag("DbUnavailable", (e) =>
        connection
          .markDisconnected(e.message)
          .pipe(Effect.andThen(Effect.fail(e)))
      )
    );

  const queryLiveConnectivity = (
    sinceIso: string
  ): Effect.Effect<
    LiveConnectivityRow | null,
    DatabaseQueryError | DbUnavailable
  > =>
    Effect.gen(function* () {
      const conn = yield* connection.getConnection;

      const spec = yield* buildQueryLiveConnectivity({ sinceIso }, table);

      const result = yield* Effect.tryPromise({
        try: () => conn.pgClient.query(spec.query, Array.from(spec.params)),
        catch: (error) => {
          const msg = errorMessage(error);
          if (isLikelyConnectionError(msg)) {
            return new DbUnavailable({ message: msg });
          }
          return new DatabaseQueryError({
            message: `Failed to query live connectivity: ${msg}`,
          });
        },
      });

      const row = result.rows?.[0];
      return row ? mapLiveConnectivityRow(row) : null;
    }).pipe(
      Effect.catchTag("DbUnavailable", (e) =>
        connection
          .markDisconnected(e.message)
          .pipe(Effect.andThen(Effect.fail(e)))
      )
    );

  const queryEarliestTimestamp = (): Effect.Effect<
    string | null,
    DatabaseQueryError | DbUnavailable
  > =>
    Effect.gen(function* () {
      const conn = yield* connection.getConnection;

      const spec = yield* buildQueryEarliestTimestamp(table);

      const result = yield* Effect.tryPromise({
        try: () => conn.pgClient.query(spec.query, Array.from(spec.params)),
        catch: (error) => {
          const msg = errorMessage(error);
          if (isLikelyConnectionError(msg)) {
            return new DbUnavailable({ message: msg });
          }
          return new DatabaseQueryError({
            message: `Failed to query earliest timestamp: ${msg}`,
          });
        },
      });

      return result.rows[0]?.timestamp ?? null;
    }).pipe(
      Effect.catchTag("DbUnavailable", (e) =>
        connection
          .markDisconnected(e.message)
          .pipe(Effect.andThen(Effect.fail(e)))
      )
    );

  const queryLatestPingTimestamp = (): Effect.Effect<
    string | null,
    DatabaseQueryError | DbUnavailable
  > =>
    Effect.gen(function* () {
      const conn = yield* connection.getConnection;

      const spec = yield* buildQueryLatestPingTimestamp(table);

      const result = yield* Effect.tryPromise({
        try: () => conn.pgClient.query(spec.query, Array.from(spec.params)),
        catch: (error) => {
          const msg = errorMessage(error);
          if (isLikelyConnectionError(msg)) {
            return new DbUnavailable({ message: msg });
          }
          return new DatabaseQueryError({
            message: `Failed to query latest ping timestamp: ${msg}`,
          });
        },
      });

      return result.rows[0]?.timestamp ?? null;
    }).pipe(
      Effect.catchTag("DbUnavailable", (e) =>
        connection
          .markDisconnected(e.message)
          .pipe(Effect.andThen(Effect.fail(e)))
      )
    );

  const runRows = (
    spec: SqlQuerySpec,
    label: string
  ): Effect.Effect<
    readonly Record<string, unknown>[],
    DatabaseQueryError | DbUnavailable
  > =>
    Effect.gen(function* () {
      const conn = yield* connection.getConnection;

      const result = yield* Effect.tryPromise({
        try: () => conn.pgClient.query(spec.query, Array.from(spec.params)),
        catch: (error) => {
          const msg = errorMessage(error);
          if (isLikelyConnectionError(msg)) {
            return new DbUnavailable({ message: msg });
          }
          return new DatabaseQueryError({
            message: `Failed to query ${label}: ${msg}`,
          });
        },
      });

      return result.rows ?? [];
    }).pipe(
      Effect.catchTag("DbUnavailable", (e) =>
        connection
          .markDisconnected(e.message)
          .pipe(Effect.andThen(Effect.fail(e)))
      )
    );

  const querySummaryStats = (
    params: QueryWindowParams
  ): Effect.Effect<SummaryStatsRow, DatabaseQueryError | DbUnavailable> =>
    buildQuerySummaryStats(params, table).pipe(
      Effect.flatMap((spec) => runRows(spec, "summary stats")),
      Effect.map((rows) => mapSummaryStatsRow(rows[0] ?? {}))
    );

  const queryHostStats = (
    params: QueryWindowParams
  ): Effect.Effect<
    readonly HostStatsRow[],
    DatabaseQueryError | DbUnavailable
  > =>
    buildQueryHostStats(params, table).pipe(
      Effect.flatMap((spec) => runRows(spec, "host stats")),
      Effect.map((rows) => rows.map(mapHostStatsRow))
    );

  const queryOutageRuns = (
    params: QueryOutageParams
  ): Effect.Effect<readonly OutageRun[], DatabaseQueryError | DbUnavailable> =>
    Effect.all(
      {
        runs: buildQueryOutageRuns(params, table).pipe(
          Effect.flatMap((spec) => runRows(spec, "outage runs")),
          Effect.map((rows) => rows.map(mapOutageRunRow))
        ),
        hosts: buildQueryOutageHosts(params, table).pipe(
          Effect.flatMap((spec) => runRows(spec, "outage hosts")),
          Effect.map((rows) => rows.map(mapOutageHostRow))
        ),
      },
      { concurrency: "unbounded" }
    ).pipe(Effect.map(({ runs, hosts }) => attachOutageHosts(runs, hosts)));

  const queryCyclePeriod = (
    params: QueryWindowParams
  ): Effect.Effect<number | null, DatabaseQueryError | DbUnavailable> =>
    buildQueryCyclePeriod(params, table).pipe(
      Effect.flatMap((spec) => runRows(spec, "cycle period")),
      Effect.map((rows) => mapCyclePeriodMs(rows[0]))
    );

  const health = (): Effect.Effect<
    DatabaseHealth,
    DatabaseConnectionError | DbUnavailable
  > =>
    Effect.gen(function* () {
      const state = yield* connection.getState;

      if (Option.isNone(state.connection)) {
        const errorMsg = Option.isSome(state.lastError)
          ? state.lastError.value.message
          : "Database not connected";
        return yield* Effect.fail(new DbUnavailable({ message: errorMsg }));
      }

      const conn = state.connection.value;

      yield* Effect.tryPromise({
        try: () => conn.pgClient.query("SELECT 1"),
        catch: (error) =>
          new DatabaseConnectionError({
            message: `Health check failed: ${error}`,
          }),
      });

      const uptime = Option.isSome(state.connectedSince)
        ? (Date.now() - state.connectedSince.value.getTime()) / 1000
        : 0;

      return {
        connected: true,
        uptime,
      } satisfies DatabaseHealth;
    });

  const flush = (): Effect.Effect<void, DatabaseWriteError | DbUnavailable> =>
    Effect.gen(function* () {
      const conn = yield* connection.getConnection;

      yield* withIlpTimeout(
        "flush",
        Effect.tryPromise({
          try: async () => {
            await conn.sender.flush();
          },
          catch: (error) => {
            const msg = errorMessage(error);
            if (isLikelyConnectionError(msg)) {
              return new DbUnavailable({ message: msg });
            }
            return new DatabaseWriteError({
              message: `Failed to flush metrics: ${msg}`,
            });
          },
        })
      );
    }).pipe(
      Effect.catchTag("DbUnavailable", (e) =>
        connection
          .markDisconnected(e.message)
          .pipe(Effect.andThen(Effect.fail(e)))
      )
    );

  const close = (): Effect.Effect<void> => connection.close;

  return {
    writeMetric,
    flush,
    queryMetrics,
    querySpeedtests,
    queryConnectivityStatus,
    queryLiveConnectivity,
    queryEarliestTimestamp,
    queryLatestPingTimestamp,
    querySummaryStats,
    queryHostStats,
    queryOutageRuns,
    queryCyclePeriod,
    health,
    close,
  } satisfies QuestDBService;
});

export const QuestDBOverConnection = Layer.effect(QuestDB, make);

export const QuestDBLive = QuestDBOverConnection.pipe(
  Layer.provide(QuestDBConnectionLive)
);
