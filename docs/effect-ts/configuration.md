# Configuration

Read runtime configuration through Effect's `Config` module, not `process.env` directly. `Config`
gives you typed values, defaults, validation, and — crucially — the ability to **inject config in
tests** via a `ConfigProvider` without mutating global state.

The whole app config is loaded once into a `ConfigService` and provided as a layer. Reference:
`apps/server/src/infrastructure/config/config.ts`.

## Reading values

```typescript
import { Config, ConfigError, Effect, Either, Layer } from "effect";

const makeConfig = Effect.gen(function* () {
  const serverPort = yield* Config.number("SERVER_PORT").pipe(Config.withDefault(3001));
  const serverHost = yield* Config.string("SERVER_HOST").pipe(Config.withDefault("0.0.0.0"));
  const pingHostsStr = yield* Config.string("PING_HOSTS").pipe(
    Config.withDefault("8.8.8.8,1.1.1.1,cloudflare.com")
  );
  const pingHosts = pingHostsStr.split(",").map((h) => h.trim());
  return { server: { port: serverPort, host: serverHost }, ping: { hosts: pingHosts } };
});
```

Primitives: `Config.string`, `Config.number`, `Config.boolean`, `Config.integer`. Always give env
values a sensible `Config.withDefault(...)` so local/dev runs work without a full `.env`.

## Validation with `Config.mapOrFail`

Validate/normalise a value and fail with a `ConfigError` when it's invalid. Reference:
`config.ts` (`DB_PROTOCOL`).

```typescript
const dbProtocol = yield* Config.string("DB_PROTOCOL").pipe(
  Config.withDefault("http"),
  Config.mapOrFail(
    (value): Either.Either<"http" | "tcp", ConfigError.ConfigError> =>
      value === "http" || value === "tcp"
        ? Either.right(value)
        : Either.left(ConfigError.InvalidData([], `DB_PROTOCOL must be 'http' or 'tcp', got '${value}'`))
  )
);
```

## Secrets

For sensitive values prefer `Config.redacted("JWT_SECRET")`, which yields a `Redacted<string>` that
won't print in logs; unwrap with `Redacted.value(...)` only where needed. (Today `config.ts` reads
the secret as a plain string with a default — when touching auth config, migrate toward
`Config.redacted`. Never commit real secrets; see the "Never hardcode secrets" rule in `AGENTS.md`.)

## Exposing config as a service

Wrap the loaded config behind a `Context.Tag` and a `Layer.effect` so the rest of the app depends on
`ConfigService`, not on env reads. Reference: `config.ts`.

```typescript
export class ConfigService extends Context.Tag("ConfigService")<
  ConfigService,
  AppConfig
>() {}

export const ConfigServiceLive = Layer.effect(ConfigService, makeConfig);
```

Consumers `yield* ConfigService` (see `JwtServiceLive`, `PingServiceLive`, `NodeHttpServerLayer`).

## Injecting config in tests

**Never mutate `process.env` in tests** — it leaks across tests. Instead provide a `ConfigProvider`
built from a map, or a mock `ConfigService` layer.

`ConfigProvider.fromMap` (drives real `Config.*` reads). Reference:
`apps/server/src/core/monitoring/network-monitor.test.ts`.

```typescript
import { ConfigProvider, Effect } from "effect";

const withConfigProvider = (entries: Record<string, string>) =>
  Effect.withConfigProvider(ConfigProvider.fromMap(new Map(Object.entries(entries))));
```

Mock `ConfigService` directly (bypasses env entirely). Reference: `network-monitor.test.ts` uses a
`makeTestConfigLayer(...)` helper; auth tests use `Layer.succeed(ConfigService, createTestConfigService(...))`.

```typescript
const MockConfig = makeTestConfigLayer({
  ping: { hosts: ["8.8.8.8", "1.1.1.1"], timeout: 5000 },
  auth: { password: "testpassword", jwtExpiresIn: "1h" },
});
```

See [`testing.md`](./testing.md) for the full test-layer picture.

## Anti-patterns

- ❌ `process.env.FOO` inside service code — read via `Config` into `ConfigService`.
- ❌ Mutating `process.env` in tests — use `ConfigProvider.fromMap` or a mock `ConfigService` layer.
- ❌ Config values without defaults, forcing every environment to set every var.
- ❌ Logging raw secrets — use `Config.redacted`.
