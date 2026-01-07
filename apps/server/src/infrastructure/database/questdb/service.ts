import type { DatabaseHealth, NetworkMetric } from "@shared/metrics";
import { Context, Effect, Layer, Option } from "effect";
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
  mapConnectivityStatusRow,
  mapMetricRow,
} from "@/infrastructure/database/questdb/mappers";
import type {
  ConnectivityStatusRow,
  MetricRow,
  QueryMetricsParams,
  QuerySpeedtestsParams,
} from "@/infrastructure/database/questdb/model";
import { configurePgTypeParsers } from "@/infrastructure/database/questdb/pgwire";
import {
  buildQueryConnectivityStatus,
  buildQueryMetrics,
  buildQuerySpeedtests,
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

const make = Effect.gen(function* () {
  const connection = yield* QuestDBConnection;

  const writeMetric = (
    metric: NetworkMetric
  ): Effect.Effect<void, DatabaseWriteError | DbUnavailable> =>
    Effect.gen(function* () {
      const conn = yield* connection.getConnection;

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
        connection
          .markDisconnected(e.message)
          .pipe(Effect.zipRight(Effect.fail(e)))
      )
    );

  const queryMetrics = (
    params: QueryMetricsParams
  ): Effect.Effect<readonly MetricRow[], DatabaseQueryError | DbUnavailable> =>
    Effect.gen(function* () {
      const conn = yield* connection.getConnection;

      const spec = yield* buildQueryMetrics(params);

      const result = yield* Effect.tryPromise({
        try: () => conn.pgClient.query(spec.query, Array.from(spec.params)),
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

      return result.rows.map(mapMetricRow);
    }).pipe(
      Effect.catchTag("DbUnavailable", (e) =>
        connection
          .markDisconnected(e.message)
          .pipe(Effect.zipRight(Effect.fail(e)))
      )
    );

  const querySpeedtests = (
    params: QuerySpeedtestsParams
  ): Effect.Effect<readonly MetricRow[], DatabaseQueryError | DbUnavailable> =>
    Effect.gen(function* () {
      const conn = yield* connection.getConnection;

      const spec = buildQuerySpeedtests(params);

      const result = yield* Effect.tryPromise({
        try: () => conn.pgClient.query(spec.query, Array.from(spec.params)),
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

      return result.rows.map(mapMetricRow);
    }).pipe(
      Effect.catchTag("DbUnavailable", (e) =>
        connection
          .markDisconnected(e.message)
          .pipe(Effect.zipRight(Effect.fail(e)))
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

      const spec = yield* buildQueryConnectivityStatus(params);

      const result = yield* Effect.tryPromise({
        try: () => conn.pgClient.query(spec.query, Array.from(spec.params)),
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

      return result.rows.map(mapConnectivityStatusRow);
    }).pipe(
      Effect.catchTag("DbUnavailable", (e) =>
        connection
          .markDisconnected(e.message)
          .pipe(Effect.zipRight(Effect.fail(e)))
      )
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

  const flush = (): Effect.Effect<void, DatabaseWriteError | DbUnavailable> =>
    Effect.gen(function* () {
      const conn = yield* connection.getConnection;

      yield* Effect.tryPromise({
        try: async () => {
          await conn.sender.flush();
        },
        catch: (error) => {
          const msg = errorMessage(error);
          if (isLikelyConnectionError(msg)) {
            return new DbUnavailable(msg);
          }
          return new DatabaseWriteError(`Failed to flush metrics: ${msg}`);
        },
      });
    }).pipe(
      Effect.catchTag("DbUnavailable", (e) =>
        connection
          .markDisconnected(e.message)
          .pipe(Effect.zipRight(Effect.fail(e)))
      )
    );

  const close = (): Effect.Effect<void> => connection.close;

  return {
    writeMetric,
    flush,
    queryMetrics,
    querySpeedtests,
    queryConnectivityStatus,
    health,
    close,
  } satisfies QuestDBService;
});

export const QuestDBLive = Layer.scoped(QuestDB, make).pipe(
  Layer.provide(QuestDBConnectionLive)
);
