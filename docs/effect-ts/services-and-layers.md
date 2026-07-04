# Services & Layers

A **service** is a reusable capability (JWT signing, DB access, ping execution). In Effect a service
is an **interface** identified by a **`Context.Tag`**, and its implementation is provided by a
**`Layer`**. Requirements are tracked in the third type parameter of `Effect<A, E, R>`.

## Anatomy of a service (the repo standard)

Every service in this repo follows the same four-part shape. Reference: `apps/server/src/infrastructure/auth/jwt.ts`.

```typescript
import { Context, Data, Effect, Layer } from "effect";

// 1. Errors (see error-handling.md)
export class JwtInvalidError extends Data.TaggedError("JwtInvalidError")<{
  readonly message: string;
}> {}

// 2. Interface — describes operations only, never its own dependencies
export interface JwtServiceInterface {
  readonly sign: (username: string) => Effect.Effect<TokenResponse, never>;
  readonly verify: (token: string) => Effect.Effect<JwtPayload, JwtError>;
}

// 3. Tag — the unique identifier + the shape the runtime hands back on `yield*`
export class JwtService extends Context.Tag("JwtService")<
  JwtService,
  JwtServiceInterface
>() {}

// 4. Live layer — builds the implementation, pulling deps from context
export const JwtServiceLive = Layer.effect(
  JwtService,
  Effect.gen(function* () {
    const config = yield* ConfigService; // dependency resolved here, not in the interface
    const sign = (username: string) => Effect.sync(() => /* ... */);
    const verify = (token: string) => Effect.try({ /* ... */ });
    return { sign, verify, decode };
  })
);
```

Key rules:

- **The interface lists operations, not dependencies.** `JwtServiceInterface` never mentions
  `ConfigService`. The dependency shows up only inside `JwtServiceLive`, which keeps the interface
  clean and makes the service trivial to mock (see [`testing.md`](./testing.md)).
- **Use `Context.Tag("Name")<Self, Shape>()`.** The string id must be unique across the app.
- **Name the layer `<Service>Live`.** This is the convention throughout `apps/server`.

## Choosing a layer constructor

| Constructor | Use when | Example in repo |
| --- | --- | --- |
| `Layer.succeed(Tag, impl)` | The implementation is a plain value with no effects/deps | Mock layers in tests (`Layer.succeed(PingExecutor, {...})`) |
| `Layer.effect(Tag, make)` | Building the service needs effects/other services | `JwtServiceLive`, `ConfigServiceLive`, `PingServiceLive` |
| `Layer.scoped(Tag, make)` | The service acquires resources that must be released | `QuestDBLive` (holds a DB connection) |
| `Layer.unwrapEffect(effect)` | You must run an effect to *produce a layer* | `NodeHttpServerLayer` (reads config, then builds the server layer) |

### `Layer.scoped` for resources

When a service owns a resource (connection, file handle, timer), build it with `Layer.scoped` so the
resource is released when the layer's scope closes. Reference:
`apps/server/src/infrastructure/database/questdb/service.ts`.

```typescript
export const QuestDBLive = Layer.scoped(QuestDB, make).pipe(
  Layer.provide(QuestDBConnectionLive)
);
```

### `Layer.unwrapEffect` to compute a layer

Reference: `apps/server/src/core/api/server.ts`.

```typescript
export const NodeHttpServerLayer = Layer.unwrapEffect(
  Effect.gen(function* () {
    const config = yield* ConfigService;
    yield* Effect.log(`API server on ${config.server.host}:${config.server.port}`);
    return NodeHttpServer.layer(createServer, { port: config.server.port });
  })
);
```

## Composing the dependency graph

Layers compose with `Layer.provide`, `Layer.merge`, and `Layer.mergeAll`. The rule of thumb:
**each layer explicitly provides its own dependencies**, then the top-level layers are merged.

- `Layer.provide(deps)` — feed dependencies *into* a layer, satisfying its `RIn`.
- `Layer.merge(a, b)` — combine two layers into one that provides both services.
- `Layer.mergeAll(a, b, c, ...)` — merge many at once.

Reference: `apps/server/src/index.ts` builds the graph level by level:

```typescript
// Base layers (no deps)
const ConfigLayer = ConfigServiceLive;

// Level 1: depend only on Config
const QuestDBLayer = QuestDBLive.pipe(Layer.provide(ConfigLayer));
const JwtLayer = JwtServiceLive.pipe(Layer.provide(ConfigLayer));

// Level 2: multiple deps
const AuthServiceLayer = AuthServiceLive.pipe(
  Layer.provide(Layer.merge(ConfigLayer, JwtLayer))
);
const NetworkMonitorLayer = NetworkMonitorLive.pipe(
  Layer.provide(Layer.mergeAll(ConfigLayer, QuestDBLayer, PingExecutorLayer, SpeedTestLayer))
);

// Top level: only include layers used directly by the program.
// Their transitive deps are already satisfied inside them.
const MainLive = Layer.mergeAll(ConfigLayer, NetworkMonitorLayer, ApiServerLayer);
```

Notes:

- **Redundant `Layer.provide` is fine and often necessary for type safety.** If two sibling layers
  both need `Config`, provide it to each. Effect memoises layer construction, so a shared layer is
  still built once at runtime.
- **Only merge top-level layers into `MainLive`.** Anything already provided inside a merged layer
  should *not* be re-listed, or you leak implementation detail into the top level.

## Accessing a service

Inside `Effect.gen`, `yield*` the tag to get the implementation:

```typescript
const program = Effect.gen(function* () {
  const monitor = yield* NetworkMonitor;
  yield* monitor.start();
});
```

## Providing layers to a program

- **Runtime entry point:** `Effect.provide(MainLive)` then `Effect.runFork` — see `apps/server/src/index.ts`.
- **HTTP API layer:** built via `HttpApiBuilder.api(...)` + `Layer.provide([...groups])` — see
  `apps/server/src/core/api/service.ts` and [`http-api.md`](./http-api.md).
- **Tests:** `Effect.provide(TestLayer)` with mock layers — see [`testing.md`](./testing.md).

## Anti-patterns

- ❌ Putting dependencies in the service interface (e.g. `query: (cfg: Config) => ...`). Resolve deps
  in the `*Live` layer instead.
- ❌ Calling `Effect.runPromise`/`runSync` deep inside service code. Return an `Effect` and run it
  once at the edge (`index.ts`, a handler, or a test).
- ❌ Re-listing already-provided sub-layers at the top level.
