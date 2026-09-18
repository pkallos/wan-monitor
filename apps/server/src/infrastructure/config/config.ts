import { Config, Context, Effect, Layer, Schema } from "effect";

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
    readonly password: string;
    readonly jwtSecret: string;
    readonly jwtExpiresIn: string;
  };
}

// Config service tag
export class ConfigService extends Context.Service<ConfigService, AppConfig>()(
  "ConfigService"
) {}

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

  const pingTimeout = yield* Config.Number("PING_TIMEOUT").pipe(
    Config.withDefault(5)
  );
  const pingTrainCount = yield* Config.Number("PING_TRAIN_COUNT").pipe(
    Config.withDefault(10)
  );
  const pingIntervalSeconds = yield* Config.Number(
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
  const authPassword = yield* Config.String("WAN_MONITOR_PASSWORD").pipe(
    Config.withDefault("")
  );
  const jwtSecret = yield* Config.String("JWT_SECRET").pipe(
    Config.withDefault("wan-monitor-default-secret-change-in-production")
  );
  const jwtExpiresIn = yield* Config.String("JWT_EXPIRES_IN").pipe(
    Config.withDefault("24h")
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
      jwtExpiresIn,
    },
  };
});

// Config service layer
export const ConfigServiceLive = Layer.effect(ConfigService, makeConfig);
