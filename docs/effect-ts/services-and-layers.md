# Services and Layers

A **service** is an interface plus a runtime key that lets Effect resolve an implementation from
context. A **layer** builds a service (or several), possibly with its own dependencies, possibly with
side effects at construction time. This is how the codebase does dependency injection: every external
dependency (config, a database connection, a JWT signer) is a service, provided by a layer, requested
with `yield*`.

## Defining a service: `Context.Service`

v4 has one constructor for services: `Context.Service`. (v3's `Context.Tag`, `Context.GenericTag`,
`Effect.Tag`, and `Effect.Service` are all gone — this replaced every one of them.)

```ts
import { Context, Effect } from "effect";

export interface AppConfig {
  readonly server: { readonly port: number; readonly host: string };
  // ...
}

export class ConfigService extends Context.Service<ConfigService, AppConfig>()(
  "ConfigService"
) {}
```

See `apps/server/src/infrastructure/config/config.ts`, `apps/server/src/infrastructure/database/questdb/service.ts`,
`apps/server/src/core/monitoring/network-monitor.ts`, `packages/shared/src/api/middlewares/authorization.ts` for
the same shape repeated across the app: define the interface, extend `Context.Service<Self, Shape>()("Id")`.

Read the class name back as a **type** to get the interface it holds — used as a function parameter
type this way:

```ts
export const cleanupDatabase = (db: QuestDB["Service"]) => Effect.gen(function* () { /* ... */ });
```

(`Context.Service`'s class instances aren't the shape themselves; the shape is exposed through the
class's `["Service"]` property. This replaces v3's `Tag["Type"]`.)

`yield* ConfigService` inside an `Effect.gen` resolves the service from context — the class is itself
Yieldable, so you never call a separate accessor:

```ts
const config = yield* ConfigService;
```

### The two-argument form (bundling a constructor)

`Context.Service<Self>()(id, { make })` lets the class carry its own constructor effect, for services
whose only implementation is the "normal" one (`apps/web/src/api/effect-client.ts`'s `WanMonitorClient`
does this). This is the v4 replacement for v3's `Effect.Service<Self>()(id, { effect, dependencies })`
— the shape is similar but the `dependencies` option is gone entirely, and `make` does **not**
auto-generate a `.Default` layer the way v3's `effect` option did. Build the layer yourself and call it
`layer` (v4's naming convention, not v3's `Default`/`Live`):

```ts
export class WanMonitorClient extends Context.Service<WanMonitorClient>()(
  "WanMonitorClient",
  { make: Effect.gen(function* () { /* ... */ }) }
) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(FetchHttpClient.layer)
  );
}
```

Most services in this codebase use the plain zero-option form and build their layer as a separate
top-level export instead (see below) — reach for the bundled form only when there's exactly one
implementation and no reason to keep the constructor and the layer visually apart.

### References: services with a default

`Context.Reference` is for a value that has a sensible default but can be overridden — not something
you'd model as a required service. The codebase's own use of this is `References.MinimumLogLevel`
(built into `effect`, not something this repo defines its own reference for yet):

```ts
Layer.provide(Layer.succeed(References.MinimumLogLevel, "None"));
```

Define your own the same way `LoggerRef` is defined in the source docs — `Context.Reference("Key", {
defaultValue: () => ... })` — when you actually need an overridable default, not a required
dependency. Most services in this codebase are required (`Context.Service`), because a monitoring
server that silently falls back to "no config" or "no database" on a missing dependency is worse than
a startup-time error.

## Building a layer: `Layer.effect`

`Layer.effect(ServiceKey, effect)` constructs a layer from an `Effect` that produces the service. This
is the only constructor you need for effectful service construction — v3 split "just run an effect"
(`Layer.effect`) from "run an effect that needs scoped resource cleanup" (`Layer.scoped`); v4 folded
them into one. The doc comment is explicit about this: "Use when you need to construct a
`Layer`-provided service with an Effect, dependencies, **or scoped resource acquisition**... The Effect
is executed in the scope of the layer, allowing for proper resource management." So a constructor that
forks a background loop with `Effect.forkScoped` and expects it torn down when the layer's scope closes
works exactly the same under `Layer.effect` as it did under v3's `Layer.scoped`:

```ts
// apps/server/src/infrastructure/database/questdb/connection.ts
const make = Effect.gen(function* () {
  // ...
  yield* Effect.forkScoped(connectionLoop.pipe(/* retry on crash */));
  return { /* ...QuestDBConnectionService */ } satisfies QuestDBConnectionService;
});

export const QuestDBConnectionLive = Layer.effect(QuestDBConnection, make);
```

```ts
// apps/server/src/infrastructure/database/questdb/service.ts
export const QuestDBLive = Layer.effect(QuestDB, make).pipe(
  Layer.provide(QuestDBConnectionLive)
);
```

## Composing the dependency graph: `Layer.provide` / `Layer.mergeAll`

`Layer.provide(dependency)` wires a dependency's output into a layer's remaining requirements.
`Layer.mergeAll(...)` combines several layers into one, requiring the union of what each one still
needs. `apps/server/src/index.ts` builds the whole app this way, leaf-first:

```ts
const ConfigLayer = ConfigServiceLive;
const QuestDBLayer = QuestDBLive.pipe(Layer.provide(ConfigLayer));
const JwtLayer = JwtServiceLive.pipe(Layer.provide(ConfigLayer));
const AuthServiceLayer = AuthServiceLive.pipe(
  Layer.provide(Layer.merge(ConfigLayer, JwtLayer))
);
// ...
const ApiServerLayer = ApiServerLive.pipe(
  Layer.provide(NodeHttpServerLayer),
  Layer.provide(
    Layer.mergeAll(ConfigLayer, QuestDBLayer, PingExecutorLayer, JwtLayer, AuthServiceLayer, SpeedTestLayer)
  )
);
```

Each named `*Layer` constant is fully resolved (requires nothing further) before it's fed into the
next. Read the graph top-to-bottom in `index.ts` to see the whole app's dependencies at a glance —
that file is the one place they're all assembled; every other file only knows its own direct
dependencies.

`Layer.provide` also takes an array — `Layer.provide([layerA, layerB, layerC])` — when several sibling
layers need to be provided at once and there's no reason to `mergeAll` them first (used for the six
route-group layers in `apps/server/src/core/api/service.ts`).

## Anti-patterns

- ❌ A hand-rolled singleton (a module-level `let` plus a getter) instead of a `Context.Service`. You
  lose testability (no way to substitute a mock layer) and the type-level tracking of what an
  `Effect` requires.
- ❌ Reaching for `Context.Reference` for something that's actually a required dependency. A silent
  default hides a real misconfiguration; use `Context.Service` and let a missing layer fail loudly at
  layer-build time.
- ❌ Constructing a layer's dependencies inline at every call site instead of composing named
  `*Layer` constants once, the way `index.ts` does. Duplication here means the graph has to be
  re-derived by reading every call site instead of read top-to-bottom in one place.
