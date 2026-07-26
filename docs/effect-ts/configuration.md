# Configuration

`Config` reads typed values from the environment (or any `ConfigProvider`), with defaults, and fails
with a structured `ConfigError` instead of returning `undefined` or throwing. `apps/server/src/infrastructure/config/config.ts`
is the one place environment variables are read; everything else takes `ConfigService` as a
dependency.

## Reading values

```ts
import { Config, Effect } from "effect";

const makeConfig = Effect.gen(function* () {
  const serverPort = yield* Config.number("SERVER_PORT").pipe(Config.withDefault(3001));
  const serverHost = yield* Config.string("SERVER_HOST").pipe(Config.withDefault("0.0.0.0"));
  // ...
});
```

`Config.string`, `Config.number`, `Config.boolean` are shortcuts for `Config.schema(SomeSchema, name)`
with the obvious schema. `Config.withDefault(value)` supplies a fallback when the variable is unset.

## Schema-validated values

For a value that must be one of a fixed set (not just "a string"), use `Config.schema` directly with a
`Schema` — don't hand-roll validation with `Config.mapOrFail`:

```ts
import { Config, Schema } from "effect";

const dbProtocol = yield* Config.schema(
  Schema.Literals(["http", "tcp"]),
  "DB_PROTOCOL"
).pipe(Config.withDefault("http" as const));
```

`Config.schema` decodes the raw value through the schema and wraps any validation failure in a
`ConfigError` automatically, with a proper `SchemaIssue` (path, expected type) attached. This matters:
`ConfigError.cause` is typed `SourceError | Schema.SchemaError` — `SourceError` means "the provider
could not read data" (an I/O failure), `SchemaError` means "the data was found but didn't match the
schema" (a validation failure). A value like `DB_PROTOCOL=ftp` is the second case, not the first — if
you ever do need to construct a `ConfigError` by hand (rare; `Config.schema` covers the normal case),
reach for `new Config.ConfigError(new Schema.SchemaError(...))`, not `SourceError`.

`Config.mapOrFail`'s callback returns an `Effect<A, ConfigError>` in v4 (v3's `Result<A, ConfigError>`)
— if you do need a manual transform for something `Config.schema` genuinely can't express, match that
signature.

## Injecting config in tests

Provide a fixed `AppConfig` directly via `Layer.succeed`, bypassing environment reads entirely:

```ts
import { Layer } from "effect";
import { ConfigService } from "@/infrastructure/config/config";
import { makeTestAppConfig } from "@/test/config";

const ConfigLayer = Layer.succeed(ConfigService, makeTestAppConfig({ auth: { password: "test" } }));
```

`makeTestAppConfig` (in `apps/server/src/test/config.ts`) builds a complete `AppConfig` from shared
defaults plus per-section partial overrides, so a test only spells out the fields it cares about. This
replaced a config object literal that used to be copy-pasted across the server test suite — reach for
it instead of constructing an `AppConfig` by hand in a new test.

For a test that needs to exercise `ConfigProvider` itself (integration tests reading real environment
variables under a scoped override), use `ConfigProvider.fromUnknown({ KEY: "value" })` for the
override, layered with `.pipe(ConfigProvider.orElse(ConfigProvider.fromEnv()))` as a fallback, and
provide it with `ConfigProvider.layer(...)`:

```ts
const testConfigProvider = () =>
  ConfigProvider.fromUnknown({ DB_TABLE: TEST_TABLE }).pipe(
    ConfigProvider.orElse(ConfigProvider.fromEnv())
  );

export const createTestLayer = () =>
  Layer.provide(QuestDBLive, Layer.provide(ConfigServiceLive, ConfigProvider.layer(testConfigProvider())));
```

See `apps/server/src/infrastructure/database/questdb/test-utils/setup.ts`. Two v4 renames baked into
this: `ConfigProvider.fromMap(new Map([...]))` became `ConfigProvider.fromUnknown({...})` (a plain
object, not a `Map`), and `Layer.setConfigProvider(provider)` became `ConfigProvider.layer(provider)`
provided the ordinary way through `Layer.provide`. `ConfigProvider.orElse` also changed from taking a
thunk (`orElse(() => provider)`) to taking the provider value directly (`orElse(provider)`).

## Anti-patterns

- ❌ Reading `process.env` directly anywhere outside `infrastructure/config/config.ts`. Every other
  module takes `ConfigService` as a dependency.
- ❌ Hand-validating a config value with `Config.mapOrFail` plus a manually-built `ConfigError` when
  `Config.schema` already does exactly this.
- ❌ Wrapping a value-validation failure in `ConfigProvider.SourceError` — that type means the
  underlying source (the env, a file) failed to produce data at all, not that the data was wrong.
- ❌ Copy-pasting a full `AppConfig` object literal into a new test instead of `makeTestAppConfig`
  with overrides.
