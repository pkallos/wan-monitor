import { Sender } from "@questdb/nodejs-client";
import {
  Clock,
  Context,
  Duration,
  Effect,
  FiberSet,
  Layer,
  Option,
  Ref,
  Result,
} from "effect";
import { Pool, type PoolConfig } from "pg";
import { type AppConfig, ConfigService } from "@/infrastructure/config/config";
import {
  DatabaseConnectionError,
  DatabaseUnavailable,
} from "@/infrastructure/database/questdb/errors";
import {
  SchemaMigrator,
  SchemaMigratorLive,
} from "@/infrastructure/database/questdb/migrations/service";
import { pgConnectionSettings } from "@/infrastructure/database/questdb/pgwire";
import { errorMessage } from "@/infrastructure/database/questdb/util";

export interface QuestDBRawConnection {
  readonly sender: Sender;
  // A connection pool (not a single client) so concurrent API reads — the
  // dashboard fires metrics, speedtest, and connectivity queries in parallel —
  // each acquire their own backing connection instead of colliding on one
  // client ("client is already executing a query").
  readonly pgClient: Pool;
}

export interface QuestDBConnectionState<
  Connection extends QuestDBRawConnection = QuestDBRawConnection,
> {
  readonly connection: Option.Option<Connection>;
  readonly isConnecting: boolean;
  readonly lastError: Option.Option<{ message: string; timestamp: Date }>;
  readonly connectedSince: Option.Option<Date>;
}

/** Adds a one-connection pool so the health check never queues behind API queries. */
interface OpenConnection extends QuestDBRawConnection {
  readonly healthPool: Pool;
}

const connectTimeoutMs = 5000;

// Flushing the sender and ending a pool can hang while QuestDB is down, so closing stops waiting after this long.
const closeTimeoutMs = 5000;

// Lets the server's own cut-off at the query timeout fire first and leave the pooled connection usable.
const clientTimeoutGraceMs = 5000;

type PoolDatabaseConfig = Pick<
  AppConfig["database"],
  "host" | "pgPort" | "queryTimeout"
>;

// QuestDB reads statement_timeout only from `options`. connectionTimeoutMillis
// also bounds the wait for a free pooled connection, so it follows the query timeout.
export const queryPoolConfig = (database: PoolDatabaseConfig): PoolConfig => ({
  ...pgConnectionSettings(database),
  connectionTimeoutMillis: database.queryTimeout,
  options: `-c statement_timeout=${database.queryTimeout}`,
  query_timeout: database.queryTimeout + clientTimeoutGraceMs,
  // Cap concurrent backing connections; QuestDB's pgwire handles multiple
  // sessions, and the app's concurrency is bounded by parallel API reads.
  max: 10,
  idleTimeoutMillis: 30_000,
});

export const healthPoolConfig = (database: PoolDatabaseConfig): PoolConfig => ({
  ...pgConnectionSettings(database),
  connectionTimeoutMillis: connectTimeoutMs,
  // Lets pg release a hung SELECT 1, so ending the pool can finish.
  query_timeout: database.queryTimeout,
  max: 1,
});

const initialState: QuestDBConnectionState<OpenConnection> = {
  connection: Option.none(),
  isConnecting: false,
  lastError: Option.none(),
  connectedSince: Option.none(),
};

export interface QuestDBConnectionService {
  readonly getConnection: Effect.Effect<
    QuestDBRawConnection,
    DatabaseUnavailable
  >;
  readonly getState: Effect.Effect<QuestDBConnectionState>;
  /**
   * Closes `connection` and records `reason`, but only while it is still the
   * current connection; a report about a replaced one changes nothing.
   */
  readonly markDisconnected: (
    connection: QuestDBRawConnection,
    reason: string
  ) => Effect.Effect<void>;
  /** A `SELECT 1` on the connection's own health pool, so it never waits behind API queries. */
  readonly ping: Effect.Effect<
    void,
    DatabaseConnectionError | DatabaseUnavailable
  >;
  readonly close: Effect.Effect<void>;
}

export class QuestDBConnection extends Context.Service<
  QuestDBConnection,
  QuestDBConnectionService
>()("QuestDBConnection") {}

const make = Effect.gen(function* () {
  const config = yield* ConfigService;
  const migrator = yield* SchemaMigrator;

  const reconnectIntervalMs = 2000;
  // Only an operator can fix a terminal migration error. Transient failures back
  // off to the same wait because each retry of a rewrite copies the whole table.
  const terminalMigrationRetryMs = 10 * 60 * 1000;
  const healthCheckIntervalMs = 5000;

  const stateRef =
    yield* Ref.make<QuestDBConnectionState<OpenConnection>>(initialState);
  const failedMigrationsRef = yield* Ref.make(0);
  const senderCreatedRef = yield* Ref.make(false);
  const runFork = yield* FiberSet.makeRuntime();

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

  const endPool = (pool: Pool): Effect.Effect<void> =>
    Effect.promise(async () => {
      try {
        await pool.end();
      } catch {}
    }).pipe(Effect.timeout(Duration.millis(closeTimeoutMs)), Effect.ignore);

  const closeConnection = (conn: OpenConnection): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* Effect.promise(async () => {
        try {
          await conn.sender.flush();
        } catch {}
      }).pipe(Effect.timeout(Duration.millis(closeTimeoutMs)), Effect.ignore);
      yield* Effect.promise(async () => {
        try {
          await conn.sender.close();
        } catch {}
      });
      yield* Effect.all([endPool(conn.pgClient), endPool(conn.healthPool)], {
        concurrency: "unbounded",
      });
    });

  const createConnection = Effect.gen(function* () {
    yield* Effect.logDebug("Attempting to create QuestDB connection...");

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
        new DatabaseConnectionError({
          message: `Sender connection failed: ${errorMessage(error)}`,
        }),
    });

    const pgClient = new Pool(queryPoolConfig(config.database));
    const healthPool = new Pool(healthPoolConfig(config.database));

    // The health pool's first query opens its connection and proves the
    // database is reachable; the query pool connects lazily. Bounded here so a
    // failed attempt cleans up inside the loop's own timeout.
    yield* Effect.tryPromise({
      try: () => healthPool.query("SELECT 1"),
      catch: (error) =>
        new DatabaseConnectionError({
          message: `Connection verification failed: ${errorMessage(error)}`,
        }),
    }).pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(connectTimeoutMs),
        orElse: () =>
          Effect.fail(
            new DatabaseConnectionError({
              message: `Connection verification timed out after ${connectTimeoutMs}ms`,
            })
          ),
      }),
      Effect.catch((error) =>
        Effect.gen(function* () {
          yield* Effect.promise(async () => {
            try {
              await sender.close();
            } catch {
              // ignore
            }
          });
          yield* Effect.all([endPool(pgClient), endPool(healthPool)], {
            concurrency: "unbounded",
          });
          return yield* Effect.fail(error);
        })
      )
    );

    yield* Effect.logInfo("QuestDB connection established");

    return { sender, pgClient, healthPool } satisfies OpenConnection;
  });

  const markDisconnected = (
    connection: QuestDBRawConnection,
    reason: string
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      // Only the connection still in state is taken out, so overlapping or late
      // reports never close one twice or take down its replacement.
      const closing = yield* Ref.modify(
        stateRef,
        (
          state
        ): [
          Option.Option<OpenConnection>,
          QuestDBConnectionState<OpenConnection>,
        ] =>
          Option.isSome(state.connection) &&
          state.connection.value === connection
            ? [
                state.connection,
                {
                  connection: Option.none(),
                  isConnecting: false,
                  lastError: Option.some({
                    message: reason,
                    timestamp: new Date(now),
                  }),
                  connectedSince: Option.none(),
                },
              ]
            : [Option.none(), state]
      );

      if (Option.isNone(closing)) {
        yield* Effect.logDebug(
          `Ignored disconnect report for a QuestDB connection no longer in use: ${reason}`
        );
        return;
      }

      yield* closeConnection(closing.value).pipe(Effect.ignore);
      yield* Effect.logWarning(`QuestDB disconnected: ${reason}`);
    });

  const attachPgErrorHandler = (conn: OpenConnection, pool: Pool): void => {
    pool.on("error", (error: Error) => {
      runFork(markDisconnected(conn, error.message));
    });
  };

  const setLastError = (message: string): Effect.Effect<void> =>
    Ref.update(stateRef, (s) => ({
      ...s,
      lastError: Option.some({ message, timestamp: new Date() }),
    }));

  const migrationRetryMs = (failures: number): number =>
    Math.min(
      reconnectIntervalMs * 2 ** (failures - 1),
      terminalMigrationRetryMs
    );

  // Runs on its own client, outside the connect timeout: a table rewrite takes
  // far longer than a connection attempt.
  const migrateSchema = Effect.gen(function* () {
    const outcome = yield* migrator
      .migrate({
        canRewriteTables: !(yield* Ref.get(senderCreatedRef)),
        onProgress: (step) =>
          setLastError(`Migrating database schema (${step})`),
      })
      .pipe(Effect.result);
    if (Result.isSuccess(outcome)) {
      yield* Ref.set(failedMigrationsRef, 0);
      return true;
    }

    const error = outcome.failure;
    yield* Ref.update(stateRef, (s) => ({ ...s, isConnecting: false }));
    yield* setLastError(error.message);

    // A connect failure usually means QuestDB is still starting, so it neither
    // counts toward the backoff nor logs as a migration error.
    if (error.step === "connect") {
      yield* Effect.logWarning(
        `QuestDB connection attempt failed: ${error.message}`
      );
      yield* Effect.sleep(Duration.millis(reconnectIntervalMs));
      return false;
    }

    const failures = yield* Ref.updateAndGet(failedMigrationsRef, (n) => n + 1);
    const log = error.kind === "terminal" ? Effect.logError : Effect.logWarning;
    yield* log(`QuestDB schema migration: ${error.message}`);
    yield* Effect.sleep(
      Duration.millis(
        error.kind === "terminal"
          ? terminalMigrationRetryMs
          : migrationRetryMs(failures)
      )
    );
    return false;
  });

  const connectionLoop = Effect.gen(function* () {
    yield* Effect.logInfo("QuestDB connection loop started");

    while (true) {
      const state = yield* Ref.get(stateRef);

      if (Option.isNone(state.connection)) {
        yield* Ref.update(stateRef, (s) => ({ ...s, isConnecting: true }));

        if (!(yield* migrateSchema)) {
          continue;
        }

        const result = yield* createConnection.pipe(
          Effect.timeout(Duration.millis(connectTimeoutMs * 2)),
          Effect.option
        );

        if (Option.isSome(result)) {
          const conn = result.value;
          yield* Ref.set(senderCreatedRef, true);
          attachPgErrorHandler(conn, conn.pgClient);
          attachPgErrorHandler(conn, conn.healthPool);

          yield* Ref.set(stateRef, {
            connection: Option.some(conn),
            isConnecting: false,
            lastError: Option.none(),
            connectedSince: Option.some(new Date()),
          });

          yield* Effect.logInfo("QuestDB connected successfully");
        } else {
          yield* Ref.update(stateRef, (s) => ({
            ...s,
            isConnecting: false,
            lastError: Option.some({
              message: "Connection attempt timed out",
              timestamp: new Date(),
            }),
          }));

          yield* Effect.logWarning("QuestDB connection attempt failed");

          yield* Effect.sleep(Duration.millis(reconnectIntervalMs));
        }
      } else {
        const conn = state.connection.value;

        // QuestDB answers even SELECT 1 slowly while it runs long queries, so the
        // check waits as long as a query may take.
        const healthOk = yield* Effect.tryPromise({
          try: () => conn.healthPool.query("SELECT 1"),
          catch: (error) => errorMessage(error),
        }).pipe(
          Effect.timeout(Duration.millis(config.database.queryTimeout)),
          Effect.match({
            onFailure: () => false,
            onSuccess: () => true,
          })
        );

        if (!healthOk) {
          yield* markDisconnected(conn, "Health check failed");
        } else {
          yield* Effect.sleep(Duration.millis(healthCheckIntervalMs));
        }
      }
    }
  });

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      const state = yield* Ref.get(stateRef);
      if (Option.isSome(state.connection)) {
        yield* closeConnection(state.connection.value);
      }
      yield* Effect.logInfo("QuestDB connection closed");
    })
  );

  // An interrupted fiber skips catchCause handlers, so closing the scope still
  // ends the loop instead of restarting it.
  yield* Effect.forkScoped(
    connectionLoop.pipe(
      Effect.catchCause((cause) =>
        Effect.logError("Connection loop crashed", cause).pipe(
          Effect.andThen(Effect.sleep(Duration.seconds(5)))
        )
      ),
      Effect.forever
    )
  );

  yield* Effect.sleep(Duration.millis(100));

  const getOpenConnection = Effect.gen(function* () {
    const state = yield* Ref.get(stateRef);
    if (Option.isNone(state.connection)) {
      const errorMsg = Option.isSome(state.lastError)
        ? state.lastError.value.message
        : "Database not connected";
      return yield* Effect.fail(new DatabaseUnavailable({ message: errorMsg }));
    }
    return state.connection.value;
  });

  const getConnection: QuestDBConnectionService["getConnection"] =
    getOpenConnection;

  const ping = getOpenConnection.pipe(
    Effect.flatMap((conn) =>
      Effect.tryPromise({
        try: () => conn.healthPool.query("SELECT 1"),
        catch: (error) =>
          new DatabaseConnectionError({
            message: `Health check failed: ${error}`,
          }),
      })
    ),
    Effect.asVoid
  );

  const getState = Ref.get(stateRef);

  const close = Effect.gen(function* () {
    const state = yield* Ref.get(stateRef);
    if (Option.isSome(state.connection)) {
      yield* closeConnection(state.connection.value);
    }
    yield* Ref.set(stateRef, initialState);
  });

  return {
    getConnection,
    getState,
    markDisconnected,
    ping,
    close,
  } satisfies QuestDBConnectionService;
});

export const QuestDBConnectionOverMigrator = Layer.effect(
  QuestDBConnection,
  make
);

export const QuestDBConnectionLive = QuestDBConnectionOverMigrator.pipe(
  Layer.provide(SchemaMigratorLive)
);
