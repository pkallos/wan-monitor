import { Sender } from "@questdb/nodejs-client";
import { Context, Duration, Effect, Layer, Option, Ref, Result } from "effect";
import { Pool } from "pg";
import { ConfigService } from "@/infrastructure/config/config";
import {
  DatabaseConnectionError,
  DbUnavailable,
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

export interface QuestDBConnectionState {
  readonly connection: Option.Option<QuestDBRawConnection>;
  readonly isConnecting: boolean;
  readonly lastError: Option.Option<{ message: string; timestamp: Date }>;
  readonly connectedSince: Option.Option<Date>;
}

// A sender flush never settles while QuestDB is down, so closing stops waiting after this long.
const closeFlushTimeoutMs = 5000;

const initialState: QuestDBConnectionState = {
  connection: Option.none(),
  isConnecting: false,
  lastError: Option.none(),
  connectedSince: Option.none(),
};

export interface QuestDBConnectionService {
  readonly getConnection: Effect.Effect<QuestDBRawConnection, DbUnavailable>;
  readonly getState: Effect.Effect<QuestDBConnectionState>;
  readonly markDisconnected: (error: string) => Effect.Effect<void>;
  readonly close: Effect.Effect<void>;
}

export class QuestDBConnection extends Context.Service<
  QuestDBConnection,
  QuestDBConnectionService
>()("QuestDBConnection") {}

const make = Effect.gen(function* () {
  const config = yield* ConfigService;
  const migrator = yield* SchemaMigrator;

  const connectTimeoutMs = 5000;
  const reconnectIntervalMs = 2000;
  // Only an operator can fix a terminal migration error. Transient failures back
  // off to the same wait because each retry of a rewrite copies the whole table.
  const terminalMigrationRetryMs = 10 * 60 * 1000;
  const healthCheckIntervalMs = 5000;

  const stateRef = yield* Ref.make<QuestDBConnectionState>(initialState);
  const failedMigrationsRef = yield* Ref.make(0);
  const senderCreatedRef = yield* Ref.make(false);

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

  const closeConnection = (conn: QuestDBRawConnection): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* Effect.promise(async () => {
        try {
          await conn.sender.flush();
        } catch {}
      }).pipe(
        Effect.timeout(Duration.millis(closeFlushTimeoutMs)),
        Effect.ignore
      );
      yield* Effect.promise(async () => {
        try {
          await conn.sender.close();
        } catch {}
        try {
          await conn.pgClient.end();
        } catch {}
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

    const pgClient = new Pool({
      ...pgConnectionSettings(config.database),
      connectionTimeoutMillis: connectTimeoutMs,
      query_timeout: connectTimeoutMs,
      statement_timeout: connectTimeoutMs,
      // Cap concurrent backing connections; QuestDB's pgwire handles multiple
      // sessions, and the app's concurrency is bounded by parallel API reads.
      max: 10,
      idleTimeoutMillis: 30_000,
    });

    // A Pool connects lazily, so the first query both establishes a backing
    // connection and verifies the database is reachable.
    yield* Effect.tryPromise({
      try: () => pgClient.query("SELECT 1"),
      catch: (error) =>
        new DatabaseConnectionError({
          message: `Connection verification failed: ${errorMessage(error)}`,
        }),
    }).pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          yield* Effect.promise(async () => {
            try {
              await sender.close();
            } catch {
              // ignore
            }
            try {
              await pgClient.end();
            } catch {
              // ignore
            }
          });
          return yield* Effect.fail(error);
        })
      )
    );

    yield* Effect.logInfo("QuestDB connection established");

    return { sender, pgClient } satisfies QuestDBRawConnection;
  });

  const markDisconnected = (error: string): Effect.Effect<void> =>
    Effect.gen(function* () {
      // Taking the connection out of state first means overlapping disconnects
      // never close it twice, nor close a connection made while this one closes.
      const previous = yield* Ref.modify(stateRef, (state) => [
        state.connection,
        {
          connection: Option.none(),
          isConnecting: false,
          lastError: Option.some({ message: error, timestamp: new Date() }),
          connectedSince: Option.none(),
        } satisfies QuestDBConnectionState,
      ]);

      if (Option.isSome(previous)) {
        yield* closeConnection(previous.value).pipe(Effect.ignore);
      }

      yield* Effect.logWarning(`QuestDB disconnected: ${error}`);
    });

  const attachPgErrorHandler = (pgClient: Pool): void => {
    pgClient.on("error", (error: Error) => {
      Effect.runFork(markDisconnected(error.message));
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
          attachPgErrorHandler(conn.pgClient);

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

  const getConnection = Effect.gen(function* () {
    const state = yield* Ref.get(stateRef);
    if (Option.isNone(state.connection)) {
      const errorMsg = Option.isSome(state.lastError)
        ? state.lastError.value.message
        : "Database not connected";
      return yield* Effect.fail(new DbUnavailable({ message: errorMsg }));
    }
    return state.connection.value;
  });

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
