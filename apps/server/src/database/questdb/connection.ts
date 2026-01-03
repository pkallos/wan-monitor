import { Sender } from "@questdb/nodejs-client";
import { Context, Duration, Effect, Layer, Option, Ref } from "effect";
import { Client as PgClient } from "pg";
import {
  DatabaseConnectionError,
  DbUnavailable,
} from "@/database/questdb/errors";
import { errorMessage } from "@/database/questdb/util";
import { ConfigService } from "@/services/config";

export interface QuestDBRawConnection {
  readonly sender: Sender;
  readonly pgClient: PgClient;
}

export interface QuestDBConnectionState {
  readonly connection: Option.Option<QuestDBRawConnection>;
  readonly isConnecting: boolean;
  readonly lastError: Option.Option<{ message: string; timestamp: Date }>;
  readonly connectedSince: Option.Option<Date>;
}

const QUESTDB_PG_PORT = 8812;

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

export class QuestDBConnection extends Context.Tag("QuestDBConnection")<
  QuestDBConnection,
  QuestDBConnectionService
>() {}

const make = Effect.gen(function* () {
  const config = yield* ConfigService;

  const connectTimeoutMs = 5000;
  const reconnectIntervalMs = 2000;
  const healthCheckIntervalMs = 5000;

  const stateRef = yield* Ref.make<QuestDBConnectionState>(initialState);

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
        new DatabaseConnectionError(
          `Sender connection failed: ${errorMessage(error)}`
        ),
    });

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

    yield* Effect.tryPromise({
      try: () => pgClient.connect(),
      catch: (error) =>
        new DatabaseConnectionError(
          `PgWire connection failed: ${errorMessage(error)}`
        ),
    }).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* Effect.promise(async () => {
            try {
              await sender.close();
            } catch {}
            try {
              await pgClient.end();
            } catch {}
          });
          return yield* Effect.fail(error);
        })
      )
    );

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
      const state = yield* Ref.get(stateRef);

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

  const attachPgErrorHandler = (pgClient: PgClient): void => {
    pgClient.on("error", (error: Error) => {
      Effect.runFork(markDisconnected(error.message));
    });
  };

  const connectionLoop = Effect.gen(function* () {
    yield* Effect.logInfo("QuestDB connection loop started");

    while (true) {
      const state = yield* Ref.get(stateRef);

      if (Option.isNone(state.connection)) {
        yield* Ref.update(stateRef, (s) => ({ ...s, isConnecting: true }));

        const result = yield* createConnection.pipe(
          Effect.timeout(Duration.millis(connectTimeoutMs * 2)),
          Effect.option
        );

        if (Option.isSome(result)) {
          const conn = result.value;
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

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      const state = yield* Ref.get(stateRef);
      if (Option.isSome(state.connection)) {
        yield* closeConnection(state.connection.value);
      }
      yield* Effect.logInfo("QuestDB connection closed");
    })
  );

  yield* Effect.sleep(Duration.millis(100));

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

export const QuestDBConnectionLive = Layer.scoped(QuestDBConnection, make);
