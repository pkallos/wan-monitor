import type { DatabaseHealth, NetworkMetric } from "@shared/metrics";
import type { Metric } from "@wan-monitor/shared";
import {
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Schema,
  Semaphore,
} from "effect";
import { ConfigService } from "@/infrastructure/config/config";
import {
  QuestDBConnection,
  QuestDBConnectionLive,
  type QuestDBRawConnection,
} from "@/infrastructure/database/questdb/connection";
import {
  DatabaseConnectionError,
  DatabaseQueryError,
  DatabaseUnavailable,
  type DatabaseWriteError,
} from "@/infrastructure/database/questdb/errors";
import { writeMetricToSender } from "@/infrastructure/database/questdb/ilp";
import {
  attachOutageHosts,
  toCyclePeriodMs,
  toMetric,
} from "@/infrastructure/database/questdb/mappers";
import {
  type ConnectivityStatusRow,
  ConnectivityStatusRowSchema,
  CyclePeriodRowSchema,
  type HostStatsRow,
  HostStatsRowSchema,
  type LiveConnectivityRow,
  LiveConnectivityRowSchema,
  MetricRowSchema,
  OutageHostRowSchema,
  type OutageRun,
  OutageRunRowSchema,
  type QueryMetricsParams,
  type QueryOutageParams,
  type QuerySpeedtestsParams,
  type QueryWindowParams,
  type SummaryStatsRow,
  SummaryStatsRowSchema,
  TimestampRowSchema,
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
  classifyQueryError,
  classifyWriteError,
} from "@/infrastructure/database/questdb/util";

configurePgTypeParsers();

export interface QuestDBService {
  readonly writeMetric: (
    metric: NetworkMetric
  ) => Effect.Effect<void, DatabaseWriteError | DatabaseUnavailable>;
  readonly flush: () => Effect.Effect<
    void,
    DatabaseWriteError | DatabaseUnavailable
  >;
  readonly queryMetrics: (
    params: QueryMetricsParams
  ) => Effect.Effect<
    readonly Metric[],
    DatabaseQueryError | DatabaseUnavailable
  >;
  readonly querySpeedtests: (
    params: QuerySpeedtestsParams
  ) => Effect.Effect<
    readonly Metric[],
    DatabaseQueryError | DatabaseUnavailable
  >;
  readonly queryConnectivityStatus: (
    params: QueryMetricsParams
  ) => Effect.Effect<
    readonly ConnectivityStatusRow[],
    DatabaseQueryError | DatabaseUnavailable
  >;
  readonly queryLiveConnectivity: (
    sinceIso: string
  ) => Effect.Effect<
    LiveConnectivityRow | null,
    DatabaseQueryError | DatabaseUnavailable
  >;
  readonly queryEarliestTimestamp: () => Effect.Effect<
    string | null,
    DatabaseQueryError | DatabaseUnavailable
  >;
  readonly queryLatestPingTimestamp: () => Effect.Effect<
    string | null,
    DatabaseQueryError | DatabaseUnavailable
  >;
  readonly querySummaryStats: (
    params: QueryWindowParams
  ) => Effect.Effect<SummaryStatsRow, DatabaseQueryError | DatabaseUnavailable>;
  readonly queryHostStats: (
    params: QueryWindowParams
  ) => Effect.Effect<
    readonly HostStatsRow[],
    DatabaseQueryError | DatabaseUnavailable
  >;
  readonly queryOutageRuns: (
    params: QueryOutageParams
  ) => Effect.Effect<
    readonly OutageRun[],
    DatabaseQueryError | DatabaseUnavailable
  >;
  readonly queryCyclePeriod: (
    params: QueryWindowParams
  ) => Effect.Effect<number | null, DatabaseQueryError | DatabaseUnavailable>;
  readonly health: () => Effect.Effect<
    DatabaseHealth,
    DatabaseConnectionError | DatabaseUnavailable
  >;
  readonly close: () => Effect.Effect<void>;
}

/** Stands in for a zero-row result; QuestDB answers an empty window with one all-null row. */
const NO_SUMMARY_STATS: SummaryStatsRow = {
  latency_p50: null,
  latency_p95: null,
  avg_packet_loss: null,
  avg_jitter: null,
};

export class QuestDB extends Context.Service<QuestDB, QuestDBService>()(
  "QuestDB"
) {}

const make = Effect.gen(function* () {
  const connection = yield* QuestDBConnection;
  const config = yield* ConfigService;
  const { table, protocol } = config.database;
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
            new DatabaseUnavailable({
              message: `QuestDB ${operation} timed out after ${ilpTimeoutMs}ms`,
            })
          ),
      })
    );

  const withDisconnectOnUnavailable = <
    A,
    E extends DatabaseQueryError | DatabaseWriteError,
  >(
    effect: Effect.Effect<A, E | DatabaseUnavailable>
  ) =>
    effect.pipe(
      Effect.catchTag("DatabaseUnavailable", (error) =>
        connection
          .markDisconnected(error.message)
          .pipe(Effect.andThen(Effect.fail(error)))
      )
    );

  const runIlp = (
    operation: "write" | "flush",
    action: string,
    send: (conn: QuestDBRawConnection) => Promise<void>
  ) =>
    connection.getConnection.pipe(
      Effect.flatMap((conn) =>
        withIlpTimeout(
          operation,
          Effect.tryPromise({
            try: () => send(conn),
            catch: classifyWriteError(action, protocol),
          })
        )
      ),
      withDisconnectOnUnavailable
    );

  // The sender batches rows across calls and drops a rejected batch, so each
  // row is flushed alone under this lock to tie a failure to its own row.
  const writeLock = yield* Semaphore.make(1);

  const writeMetric = (metric: NetworkMetric) =>
    runIlp("write", "write metric", async (conn) => {
      await writeMetricToSender(conn.sender, metric, table);
      await conn.sender.flush();
    }).pipe(writeLock.withPermits(1));

  const flush = () =>
    runIlp("flush", "flush metrics", async (conn) => {
      await conn.sender.flush();
    });

  const runRows = <S extends Schema.ConstraintDecoder<unknown>>(
    spec: SqlQuerySpec,
    label: string,
    schema: S
  ) =>
    connection.getConnection.pipe(
      Effect.flatMap((conn) =>
        Effect.tryPromise({
          try: () => conn.pgClient.query(spec.query, Array.from(spec.params)),
          catch: classifyQueryError(label),
        })
      ),
      Effect.flatMap((result) =>
        Schema.decodeUnknownEffect(Schema.Array(schema))(result.rows).pipe(
          Effect.mapError(
            (error) =>
              new DatabaseQueryError({
                message: `Failed to decode ${label} rows: ${error.message}`,
              })
          )
        )
      ),
      withDisconnectOnUnavailable
    );

  const queryMetrics = (params: QueryMetricsParams) =>
    runRows(buildQueryMetrics(params, table), "metrics", MetricRowSchema).pipe(
      Effect.map((rows) => rows.map(toMetric))
    );

  const querySpeedtests = (params: QuerySpeedtestsParams) =>
    runRows(
      buildQuerySpeedtests(params, table),
      "speedtests",
      MetricRowSchema
    ).pipe(Effect.map((rows) => rows.map(toMetric)));

  const queryConnectivityStatus = (params: QueryMetricsParams) =>
    runRows(
      buildQueryConnectivityStatus(params, table),
      "connectivity status",
      ConnectivityStatusRowSchema
    );

  const queryLiveConnectivity = (sinceIso: string) =>
    runRows(
      buildQueryLiveConnectivity({ sinceIso }, table),
      "live connectivity",
      LiveConnectivityRowSchema
    ).pipe(Effect.map((rows) => rows[0] ?? null));

  const queryEarliestTimestamp = () =>
    runRows(
      buildQueryEarliestTimestamp(table),
      "earliest timestamp",
      TimestampRowSchema
    ).pipe(Effect.map((rows) => rows[0]?.timestamp ?? null));

  const queryLatestPingTimestamp = () =>
    runRows(
      buildQueryLatestPingTimestamp(table),
      "latest ping timestamp",
      TimestampRowSchema
    ).pipe(Effect.map((rows) => rows[0]?.timestamp ?? null));

  const querySummaryStats = (params: QueryWindowParams) =>
    runRows(
      buildQuerySummaryStats(params, table),
      "summary stats",
      SummaryStatsRowSchema
    ).pipe(Effect.map((rows) => rows[0] ?? NO_SUMMARY_STATS));

  const queryHostStats = (params: QueryWindowParams) =>
    runRows(
      buildQueryHostStats(params, table),
      "host stats",
      HostStatsRowSchema
    );

  const queryOutageRuns = (params: QueryOutageParams) =>
    Effect.all(
      {
        runs: runRows(
          buildQueryOutageRuns(params, table),
          "outage runs",
          OutageRunRowSchema
        ),
        hosts: runRows(
          buildQueryOutageHosts(params, table),
          "outage hosts",
          OutageHostRowSchema
        ),
      },
      { concurrency: "unbounded" }
    ).pipe(Effect.map(({ runs, hosts }) => attachOutageHosts(runs, hosts)));

  const queryCyclePeriod = (params: QueryWindowParams) =>
    runRows(
      buildQueryCyclePeriod(params, table),
      "cycle period",
      CyclePeriodRowSchema
    ).pipe(
      Effect.map((rows) => toCyclePeriodMs(rows[0]?.period_micros ?? null))
    );

  const health = () =>
    Effect.gen(function* () {
      const conn = yield* connection.getConnection;

      yield* Effect.tryPromise({
        try: () => conn.pgClient.query("SELECT 1"),
        catch: (error) =>
          new DatabaseConnectionError({
            message: `Health check failed: ${error}`,
          }),
      });

      const { connectedSince } = yield* connection.getState;
      const uptime = Option.isSome(connectedSince)
        ? (Date.now() - connectedSince.value.getTime()) / 1000
        : 0;

      return { connected: true, uptime } satisfies DatabaseHealth;
    });

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
