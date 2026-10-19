import { randomBytes } from "node:crypto";
import { PositiveIntFromStringSchema } from "@shared/api/schemas";
import {
  Config,
  Context,
  Effect,
  Layer,
  type LogLevel,
  Option,
  Redacted,
  References,
  Schema,
  SchemaIssue,
  SchemaTransformation,
} from "effect";

// Application configuration
export interface AppConfig {
  readonly server: {
    readonly port: number;
    readonly host: string;
  };
  readonly database: {
    readonly host: string;
    readonly port: number;
    readonly pgPort: number;
    readonly protocol: "http" | "tcp";
    readonly table: string;
    readonly autoFlushRows: number;
    readonly autoFlushInterval: number;
    readonly requestTimeout: number;
    readonly retryTimeout: number;
    readonly queryTimeout: number;
  };
  readonly ping: {
    readonly timeout: number;
    readonly trainCount: number;
    readonly intervalSeconds: number;
    readonly hosts: readonly string[];
  };
  readonly speedtest: {
    readonly intervalSeconds: number;
    readonly timeoutSeconds: number;
  };
  readonly auth: {
    readonly username: string;
    readonly password: Option.Option<Redacted.Redacted<string>>;
    readonly jwtSecret: Redacted.Redacted<string>;
    readonly jwtExpiresInSeconds: number;
  };
  readonly logging: {
    readonly level: LogLevel.LogLevel;
  };
}

// Config service tag
export class ConfigService extends Context.Service<ConfigService, AppConfig>()(
  "ConfigService"
) {}

// A secret generated per process start invalidates every session on restart,
// so enabling auth without JWT_SECRET is worth a startup warning.
const generateJwtSecret = (authEnabled: boolean) =>
  Effect.gen(function* () {
    if (authEnabled) {
      yield* Effect.logWarning(
        "JWT_SECRET is not set; sessions are signed with a random secret and will not survive a restart. Set JWT_SECRET to keep sessions across restarts."
      );
    }
    const secret = yield* Effect.sync(() => randomBytes(32).toString("hex"));
    return Redacted.make(secret);
  });

const logLevelNames = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
] as const;

const LOG_LEVELS: Record<(typeof logLevelNames)[number], LogLevel.LogLevel> = {
  trace: "Trace",
  debug: "Debug",
  info: "Info",
  warn: "Warn",
  error: "Error",
  fatal: "Fatal",
};

// Case-insensitive, so both "info" and Effect's "Info" are accepted.
const LogLevelName = Schema.String.pipe(
  Schema.decodeTo(Schema.String, SchemaTransformation.trim()),
  Schema.decodeTo(Schema.String, SchemaTransformation.toLowerCase()),
  Schema.decodeTo(Schema.Literals(logLevelNames))
);

const TIMESPAN_UNITS: ReadonlyArray<readonly [ReadonlyArray<string>, number]> =
  [
    [["ms", "msec", "msecs", "millisecond", "milliseconds"], 1],
    [["s", "sec", "secs", "second", "seconds"], 1000],
    [["m", "min", "mins", "minute", "minutes"], 60_000],
    [["h", "hr", "hrs", "hour", "hours"], 3_600_000],
    [["d", "day", "days"], 86_400_000],
    [["w", "week", "weeks"], 604_800_000],
    [["y", "yr", "yrs", "year", "years"], 31_557_600_000],
  ];

const MS_PER_UNIT = new Map(
  TIMESPAN_UNITS.flatMap(([names, ms]) =>
    names.map((name): [string, number] => [name, ms])
  )
);

// Same units as the `ms` package (https://github.com/vercel/ms), but the unit
// is required: `ms` reads a bare "3600" as milliseconds.
const TIMESPAN = /^(\d+(?:\.\d+)?|\.\d+) *([a-z]+)$/i;

// sign() turns `iat + expiry` into an ISO string, which throws past Date's
// range (8.64e15 ms). The 2^32 s margin covers issue times through year 2106.
const MAX_EXPIRES_IN_SECONDS = 8.64e12 - 2 ** 32;

const timespanSeconds = (input: string): Option.Option<number> => {
  const match = TIMESPAN.exec(input.trim());
  if (match === null) {
    return Option.none();
  }
  const msPerUnit = MS_PER_UNIT.get(match[2].toLowerCase());
  if (msPerUnit === undefined) {
    return Option.none();
  }
  const seconds = Math.floor((Number(match[1]) * msPerUnit) / 1000);
  return seconds >= 1 && seconds <= MAX_EXPIRES_IN_SECONDS
    ? Option.some(seconds)
    : Option.none();
};

const JwtExpiresInSeconds = Schema.String.pipe(
  Schema.decodeTo(
    Schema.Int,
    SchemaTransformation.transformEffect({
      decode: (raw) =>
        Option.match(timespanSeconds(raw), {
          onNone: () =>
            Effect.fail(
              new SchemaIssue.InvalidValue({
                message:
                  'needs a unit, for example "3600s", "90m", "24h" or "7d", and must be at least one second and short enough to give a valid expiry date',
              })
            ),
          onSome: Effect.succeed,
        }),
      encode: (seconds) => Effect.succeed(`${seconds}s`),
    })
  )
);

export const MinimumLogLevelLive = Layer.effect(
  References.MinimumLogLevel,
  ConfigService.use((config) => Effect.succeed(config.logging.level))
);

// Load configuration from environment
const makeConfig = Effect.gen(function* () {
  const serverPort = yield* Config.Number("SERVER_PORT").pipe(
    Config.withDefault(3001)
  );
  const serverHost = yield* Config.String("SERVER_HOST").pipe(
    Config.withDefault("0.0.0.0")
  );
  const dbHost = yield* Config.String("DB_HOST").pipe(
    Config.withDefault("localhost")
  );
  const dbPort = yield* Config.Number("DB_PORT").pipe(Config.withDefault(9000));
  const dbPgPort = yield* Config.Number("DB_PG_PORT").pipe(
    Config.withDefault(8812)
  );
  const dbProtocol = yield* Config.schema(
    Schema.Literals(["http", "tcp"]),
    "DB_PROTOCOL"
  ).pipe(Config.withDefault("http" as const));
  const dbTable = yield* Config.String("DB_TABLE").pipe(
    Config.withDefault("network_metrics")
  );
  const dbAutoFlushRows = yield* Config.Number("DB_AUTO_FLUSH_ROWS").pipe(
    Config.withDefault(100)
  );
  const dbAutoFlushInterval = yield* Config.Number(
    "DB_AUTO_FLUSH_INTERVAL"
  ).pipe(Config.withDefault(1000));
  const dbRequestTimeout = yield* Config.Number("DB_REQUEST_TIMEOUT").pipe(
    Config.withDefault(10000)
  );
  const dbRetryTimeout = yield* Config.Number("DB_RETRY_TIMEOUT").pipe(
    Config.withDefault(1000)
  );
  const dbQueryTimeout = yield* Config.schema(
    PositiveIntFromStringSchema,
    "DB_QUERY_TIMEOUT"
  ).pipe(Config.withDefault(25_000));

  const pingTimeout = yield* Config.Number("PING_TIMEOUT").pipe(
    Config.withDefault(5)
  );
  const pingTrainCount = yield* Config.Number("PING_TRAIN_COUNT").pipe(
    Config.withDefault(10)
  );
  const pingIntervalSeconds = yield* Config.schema(
    PositiveIntFromStringSchema,
    "PING_INTERVAL_SECONDS"
  ).pipe(Config.withDefault(30));
  const pingHostsStr = yield* Config.String("PING_HOSTS").pipe(
    Config.withDefault("8.8.8.8,1.1.1.1,cloudflare.com")
  );
  const pingHosts = pingHostsStr
    .split(",")
    .map((h: string) => h.trim())
    .filter((h: string) => h.length > 0);

  const speedTestIntervalSeconds = yield* Config.Number(
    "SPEEDTEST_INTERVAL_SECONDS"
  ).pipe(Config.withDefault(3600));
  const speedTestTimeoutSeconds = yield* Config.Number(
    "SPEEDTEST_TIMEOUT_SECONDS"
  ).pipe(Config.withDefault(120));

  const authUsername = yield* Config.String("WAN_MONITOR_USERNAME").pipe(
    Config.withDefault("admin")
  );
  const authPassword = yield* Config.option(
    Config.Redacted("WAN_MONITOR_PASSWORD")
  );
  const configuredJwtSecret = yield* Config.option(
    Config.Redacted("JWT_SECRET")
  );
  const jwtSecret = Option.isSome(configuredJwtSecret)
    ? configuredJwtSecret.value
    : yield* generateJwtSecret(Option.isSome(authPassword));
  const jwtExpiresInSeconds = yield* Config.schema(
    JwtExpiresInSeconds,
    "JWT_EXPIRES_IN"
  ).pipe(Config.withDefault(86_400));

  const logLevel = yield* Config.schema(LogLevelName, "LOG_LEVEL").pipe(
    Config.withDefault("info" as const)
  );

  return {
    server: {
      port: serverPort,
      host: serverHost,
    },
    database: {
      host: dbHost,
      port: dbPort,
      pgPort: dbPgPort,
      protocol: dbProtocol,
      table: dbTable,
      autoFlushRows: dbAutoFlushRows,
      autoFlushInterval: dbAutoFlushInterval,
      requestTimeout: dbRequestTimeout,
      retryTimeout: dbRetryTimeout,
      queryTimeout: dbQueryTimeout,
    },
    ping: {
      timeout: pingTimeout,
      trainCount: pingTrainCount,
      intervalSeconds: pingIntervalSeconds,
      hosts: pingHosts,
    },
    speedtest: {
      intervalSeconds: speedTestIntervalSeconds,
      timeoutSeconds: speedTestTimeoutSeconds,
    },
    auth: {
      username: authUsername,
      password: authPassword,
      jwtSecret,
      jwtExpiresInSeconds,
    },
    logging: {
      level: LOG_LEVELS[logLevel],
    },
  };
});

// Config service layer
export const ConfigServiceLive = Layer.effect(ConfigService, makeConfig);
