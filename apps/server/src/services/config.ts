import { Config, Context, Effect, Layer } from 'effect';

// Application configuration
export interface AppConfig {
  readonly server: {
    readonly port: number;
    readonly host: string;
  };
  readonly database: {
    readonly host: string;
    readonly port: number;
    readonly protocol: 'http' | 'tcp';
    readonly autoFlushRows: number;
    readonly autoFlushInterval: number;
    readonly requestTimeout: number;
    readonly retryTimeout: number;
  };
  readonly ping: {
    readonly timeout: number;
    readonly retries: number;
    readonly hosts: readonly string[];
  };
}

// Config service tag
export class ConfigService extends Context.Tag('ConfigService')<
  ConfigService,
  AppConfig
>() {}

// Load configuration from environment
const makeConfig = Effect.gen(function* () {
  const serverPort = yield* Config.number('SERVER_PORT').pipe(
    Config.withDefault(3001)
  );
  const serverHost = yield* Config.string('SERVER_HOST').pipe(
    Config.withDefault('0.0.0.0')
  );
  const dbHost = yield* Config.string('DB_HOST').pipe(
    Config.withDefault('localhost')
  );
  const dbPort = yield* Config.number('DB_PORT').pipe(Config.withDefault(9000));
  const dbProtocol = yield* Config.string('DB_PROTOCOL').pipe(
    Config.withDefault('http')
  );
  const dbAutoFlushRows = yield* Config.number('DB_AUTO_FLUSH_ROWS').pipe(
    Config.withDefault(100)
  );
  const dbAutoFlushInterval = yield* Config.number(
    'DB_AUTO_FLUSH_INTERVAL'
  ).pipe(Config.withDefault(1000));
  const dbRequestTimeout = yield* Config.number('DB_REQUEST_TIMEOUT').pipe(
    Config.withDefault(10000)
  );
  const dbRetryTimeout = yield* Config.number('DB_RETRY_TIMEOUT').pipe(
    Config.withDefault(1000)
  );

  const pingTimeout = yield* Config.number('PING_TIMEOUT').pipe(
    Config.withDefault(5)
  );
  const pingRetries = yield* Config.number('PING_RETRIES').pipe(
    Config.withDefault(1)
  );
  const pingHostsStr = yield* Config.string('PING_HOSTS').pipe(
    Config.withDefault('8.8.8.8,1.1.1.1,cloudflare.com')
  );
  const pingHosts = pingHostsStr.split(',').map((h) => h.trim());

  return {
    server: {
      port: serverPort,
      host: serverHost,
    },
    database: {
      host: dbHost,
      port: dbPort,
      protocol: dbProtocol as 'http' | 'tcp',
      autoFlushRows: dbAutoFlushRows,
      autoFlushInterval: dbAutoFlushInterval,
      requestTimeout: dbRequestTimeout,
      retryTimeout: dbRetryTimeout,
    },
    ping: {
      timeout: pingTimeout,
      retries: pingRetries,
      hosts: pingHosts,
    },
  };
});

// Config service layer
export const ConfigServiceLive = Layer.effect(ConfigService, makeConfig);
