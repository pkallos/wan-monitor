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

  return {
    server: {
      port: serverPort,
      host: serverHost,
    },
    database: {
      host: dbHost,
      port: dbPort,
    },
  };
});

// Config service layer
export const ConfigServiceLive = Layer.effect(ConfigService, makeConfig);
