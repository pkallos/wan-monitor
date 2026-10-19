# Testing

Effect code is tested with `@effect/vitest`'s `it.effect` / `it.live`, mock `Layer`s standing in for
real services, and `TestClock` for anything time-based. Plain `vitest` `it`/`describe` is used only
for non-Effect logic (pure functions, React components).

## `it.effect` vs `it.live`

Both always run the test effect inside a `Scope` (so `Effect.forkScoped`, `Effect.addFinalizer`, etc.
work without extra ceremony). They differ in what environment they provide:

- **`it.effect`** — provides a `TestEnv` (fake `TestClock` + `TestConsole`). Time doesn't pass on its
  own; you advance it explicitly. Use for anything that shouldn't depend on real wall-clock timing.
- **`it.live`** — provides the real environment. Time passes normally; `setTimeout`-backed mocks and
  real async timing behave as they would outside a test. Use when a test's assertions genuinely depend
  on real elapsed time (a mocked `Promise` that resolves after a real delay, a retry loop being
  observed across real intervals).

v3 had four testers for this: `it.effect` (fake, no scope), `it.scoped` (fake, scope), `it.live` (real,
no scope), `it.scopedLive` (real, scope). v4 collapsed all four into two, since `Scope` is now always
provided — `it.scoped`/`it.scopedLive` don't exist anymore; their scope-providing behavior folded into
`it.effect`/`it.live` respectively. **Getting this rename wrong is easy and silent**: `it.scopedLive` →
`it.effect` compiles fine (nothing type-checks against which fake-vs-real environment a test runs
under) but silently switches a real-timing test onto the virtual clock, which can make a test that
should observe real async behavior pass for the wrong reason or become flaky. The correct mapping is
`it.scoped` → `it.effect`, `it.scopedLive` → `it.live`.

```ts
it.effect("returns metrics data with metadata", () => {
  const QuestDBTest = Layer.succeed(QuestDB, createMockQuestDB(mockData));

  return Effect.gen(function* () {
    const result = yield* getMetricsHandler({ query: {} });
    expect(result.data).toEqual(mockData);
  }).pipe(Effect.provide(QuestDBTest));
});
```

See `apps/server/src/core/api/handlers/metrics.test.ts`. For a test that needs the real environment
(mocked `pg`/`Sender` connections resolving asynchronously), see
`apps/server/src/infrastructure/database/questdb/connection.test.ts`'s use of `it.live`.

## Mocking a service

`Layer.succeed(ServiceTag, implementation)` provides a fixed implementation without running any
construction effect — the standard way to mock a `Context.Service` in a test:

```ts
const mockQuestDB: QuestDBService = {
  writeMetric: () => Effect.void,
  queryMetrics: () => Effect.succeed([]),
  health: () => Effect.succeed({ connected: true, uptime: 1000 }),
  // ...
};

const QuestDBTest = Layer.succeed(QuestDB, mockQuestDB);
```

Provide it with `.pipe(Effect.provide(QuestDBTest))` on the test effect, or fold several mocks together
with `Layer.mergeAll(ConfigLayer, QuestDBTest, JwtLayer, /* ... */)` for a test that assembles a larger
slice of the app (see `apps/server/src/index.test.ts`, `apps/server/src/core/api/handlers/auth.http.test.ts`).

## `TestClock`

Import from `effect/testing`, not the `effect` barrel — `TestClock` moved there in v4:

```ts
import { TestClock } from "effect/testing";

yield* TestClock.setTime(fixedNow);
// or
yield* TestClock.adjust(Duration.seconds(44));
```

`TestClock` starts at epoch 0. Code that treats a 0 timestamp as unset (`NetworkMonitor.getStats` does)
needs `TestClock.setTime` with a non-zero instant before it runs.

Only meaningful under `it.effect` (which provides the fake clock `TestEnv` implicitly); using
`TestClock` under `it.live` has nothing to hook into, since `it.live` doesn't install it.

`apps/web` tests its Foldkit Subscription streams the same way (`apps/web/src/dashboard/subscription.test.ts`):
fork the stream with `Effect.forkChild`, yield until the listener is attached, dispatch the DOM event,
`Effect.yieldNow` so the stream takes it in, then `TestClock.adjust`. Check an unfinished stream with
`fiber.pollUnsafe()`, which is `undefined` until the fiber exits.

## A fixed clock around real I/O

`TestClock` stalls code that polls a real service, such as `seedDatabase`'s wait for QuestDB's row count. For a handler that reads `Clock.currentTimeMillis` but runs against a real database, write the rows on the live clock and provide a fixed `Clock.Clock` to the handler call only:

```ts
handler.pipe(Effect.provideService(Clock.Clock, fixedClock(nowMs)), Effect.provide(layer));
```

`fixedClock` is a `Clock.Clock` whose time readings return `nowMs`. See `apps/server/src/core/api/handlers/time-model.integration.test.ts`, which also gives each case its own table and runs the real migrations through `seedTable`.

A layer built inside another `Effect.provide` of the same service reuses the outer layer's connection, so a test that needs a second table runs its second program in its own `Effect.runPromise`, as `queries.integration.test.ts` does for its legacy table.

## Suppressing log noise

```ts
import { Layer, References } from "effect";

Effect.provide(Layer.succeed(References.MinimumLogLevel, "None"));
```

This is v4's replacement for v3's `Logger.minimumLogLevel("None")`, which no longer exists.
`References.MinimumLogLevel` is a `Context.Reference` with a default; `Layer.succeed` overrides it for
the scope of whatever it's provided into. See `apps/server/src/core/monitoring/network-monitor.test.ts`
and `apps/server/src/infrastructure/speedtest/service.test.ts` for the pattern repeated across
every test that forks a long-running background loop and doesn't want its log output in the test run.

## Polling a fiber without waiting

`Fiber.poll` is gone; the instance method `fiber.pollUnsafe()` replaces it — synchronous, returns
`Exit<A, E> | undefined` (`undefined` means still running) instead of v3's
`Effect<Option<Exit<A, E>>>`:

```ts
const fiber = yield* Effect.forkChild(service.runTest());
yield* TestClock.adjust(Duration.seconds(44));
const beforeTimeout = fiber.pollUnsafe();
expect(beforeTimeout).toBeUndefined(); // still running one second before the timeout fires
```

See `apps/server/src/infrastructure/speedtest/service.test.ts`.

## Fetch error paths run in the node environment

`apps/web` tests run under `happy-dom`, where an `HttpApiClient` call that gets a declared error status
with a body that does not decode (empty, HTML, plain text) dies with a `TypeError` instead of failing
with `HttpClientError`. Effect 4.0.0 hashes the failure's object graph while combining causes, and under
`happy-dom` that graph reaches a live generator through the window. Chromium and WebKit don't reach it;
Firefox wasn't checked. Test dashboard fetch error paths in a file that starts with
`// @vitest-environment node`, as `apps/web/src/dashboard/command.errorBodies.test.ts` does. Node has no
page origin, so that file stubs `VITE_API_URL`; without a base URL every request fails before a response
is read and the test passes for the wrong reason.

Modules that import `@/dashboard`, which is all of `@/auth`, read `window` at load and can't run in the
node environment. Cover their error bodies in e2e (`e2e/auth.spec.ts`).

## Anti-patterns

- ❌ `it.scoped`/`it.scopedLive` — neither exists; use `it.effect`/`it.live`.
- ❌ Using `it.effect` for a test whose assertions depend on real elapsed time (mocked `setTimeout`
  behavior, real retry intervals) — the fake clock doesn't advance on its own, so the test either
  hangs or passes for a reason unrelated to what it claims to verify. Use `it.live`.
- ❌ Reaching into a service's internals instead of substituting a `Layer.succeed` mock at the
  boundary the code actually depends on.
- ❌ Deleting or weakening an assertion to make a migrated test pass instead of finding the correct v4
  replacement API. If a test genuinely can't be expressed in the new version, that's a finding to
  surface, not a line to quietly remove.
