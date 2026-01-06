import { Config, Context, Effect, Layer } from "effect";

// Application configuration
export interface AppConfig {
  readonly server: {
    readonly port: number;
    readonly host: string;
  };
  readonly database: {
    readonly host: string;
    readonly port: number;
    readonly protocol: "http" | "tcp";
    readonly autoFlushRows: number;
    readonly autoFlushInterval: number;
    readonly requestTimeout: number;
    readonly retryTimeout: number;
  };
  readonly ping: {
    readonly timeout: number;
    readonly trainCount: number;
    readonly hosts: readonly string[];
  };
  readonly auth: {
    readonly username: string;
    readonly password: string;
    readonly jwtSecret: string;
    readonly jwtExpiresIn: string;
  };
}

// Config service tag
export class ConfigService extends Context.Tag("ConfigService")<
  ConfigService,
  AppConfig
>() {}

// Load configuration from environment
const makeConfig = Effect.gen(function* () {
  const serverPort = yield* Config.number("SERVER_PORT").pipe(
    Config.withDefault(3001)
  );
  const serverHost = yield* Config.string("SERVER_HOST").pipe(
    Config.withDefault("0.0.0.0")
  );
  const dbHost = yield* Config.string("DB_HOST").pipe(
    Config.withDefault("localhost")
  );
  const dbPort = yield* Config.number("DB_PORT").pipe(Config.withDefault(9000));
  const dbProtocol = yield* Config.string("DB_PROTOCOL").pipe(
    Config.withDefault("http")
  );
  const dbAutoFlushRows = yield* Config.number("DB_AUTO_FLUSH_ROWS").pipe(
    Config.withDefault(100)
  );
  const dbAutoFlushInterval = yield* Config.number(
    "DB_AUTO_FLUSH_INTERVAL"
  ).pipe(Config.withDefault(1000));
  const dbRequestTimeout = yield* Config.number("DB_REQUEST_TIMEOUT").pipe(
    Config.withDefault(10000)
  );
  const dbRetryTimeout = yield* Config.number("DB_RETRY_TIMEOUT").pipe(
    Config.withDefault(1000)
  );

  const pingTimeout = yield* Config.number("PING_TIMEOUT").pipe(
    Config.withDefault(5)
  );
  const pingTrainCount = yield* Config.number("PING_TRAIN_COUNT").pipe(
    Config.withDefault(10)
  );
  const pingHostsStr = yield* Config.string("PING_HOSTS").pipe(
    Config.withDefault("8.8.8.8,1.1.1.1,cloudflare.com")
  );
  const pingHosts = pingHostsStr.split(",").map((h) => h.trim());

  const authUsername = yield* Config.string("WAN_MONITOR_USERNAME").pipe(
    Config.withDefault("admin")
  );
  const authPassword = yield* Config.string("WAN_MONITOR_PASSWORD").pipe(
    Config.withDefault("")
  );
  const jwtSecret = yield* Config.string("JWT_SECRET").pipe(
    Config.withDefault("wan-monitor-default-secret-change-in-production")
  );
  const jwtExpiresIn = yield* Config.string("JWT_EXPIRES_IN").pipe(
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
      protocol: dbProtocol as "http" | "tcp",
      autoFlushRows: dbAutoFlushRows,
      autoFlushInterval: dbAutoFlushInterval,
      requestTimeout: dbRequestTimeout,
      retryTimeout: dbRetryTimeout,
    },
    ping: {
      timeout: pingTimeout,
      trainCount: pingTrainCount,
      hosts: pingHosts,
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
