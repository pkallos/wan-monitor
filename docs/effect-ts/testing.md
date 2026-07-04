# Testing Effect Code

Tests run on Vitest. For Effect code we use **`@effect/vitest`**, which adds `it.effect` / `it.scoped`
so a test *is* an Effect — the runtime, scoped-resource cleanup, and fiber failure reporting are
handled for you. Dependencies are supplied as **mock layers**, never by mutating globals.

Two styles coexist in the repo, both valid:

1. **`it.effect`** (from `@effect/vitest`) — the test body returns an `Effect`; the framework runs it.
2. **Plain `it`** (from `vitest`) + `Effect.runPromise` / `Effect.runPromiseExit` — run the effect
   yourself, usually to assert on an `Exit`.

## Style 1 — `it.effect` with mock layers

Reference: `apps/server/src/infrastructure/auth/jwt.test.ts`,
`apps/server/src/infrastructure/auth/middleware.test.ts`.

```typescript
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

describe("JWT Service", () => {
  it.effect("generates a valid JWT token", () => {
    const ConfigServiceTest = Layer.succeed(ConfigService, createTestConfigService("test-secret"));
    const JwtServiceTest = JwtServiceLive.pipe(Layer.provide(ConfigServiceTest));

    return Effect.gen(function* () {
      const jwt = yield* JwtService;
      const { token } = yield* jwt.sign("alice");
      expect(token).toBeTruthy();
    }).pipe(Effect.provide(JwtServiceTest));
  });
});
```

- Return the effect (`return Effect.gen(...)...`) so `it.effect` runs it and surfaces failures.
- Build the system under test's real `*Live` layer, then `Layer.provide` **test** dependencies into it.
- Assertions (`expect`) run inside the generator.

## Style 2 — `Effect.runPromiseExit` for failure assertions

Reference: `apps/server/src/infrastructure/speedtest/service.test.ts`.

```typescript
import { Effect, Exit, Logger, LogLevel } from "effect";

const exit = await Effect.runPromiseExit(
  service.runTest().pipe(Effect.provide(Logger.minimumLogLevel(LogLevel.None)))
);
expect(Exit.isFailure(exit)).toBe(true);
```

Use `runPromiseExit` when the effect is expected to fail and you want to inspect the `Exit`/`Cause`
with `Exit.isFailure` / `Exit.isSuccess` (never `exit._tag`). Use `runPromise` for success paths.

## Mock layers

Replace a dependency with a fake using `Layer.succeed(Tag, impl)`. The interface-only design of our
services (see [`services-and-layers.md`](./services-and-layers.md)) makes this a one-liner.
Reference: `apps/server/src/core/monitoring/network-monitor.test.ts`.

```typescript
import { vi } from "vitest";

const MockPingExecutor = Layer.succeed(PingExecutor, {
  executePing: vi.fn(),
  executeAll: () => Effect.succeed(mockPingResults), // return canned effects
  executeHosts: vi.fn(),
});

const MockQuestDB = Layer.succeed(QuestDB, {
  writeMetric: vi.fn(() => Effect.void),
  queryMetrics: vi.fn(),
  // ...every method on the interface...
});

const MockSpeedTestService = Layer.succeed(SpeedTestService, {
  runTest: vi.fn(() => Effect.fail(new SpeedTestExecutionError({ message: "Mock error" }))),
});
```

- Mock methods **return effects** (`Effect.succeed`, `Effect.fail`, `Effect.void`), matching the
  interface signature.
- Provide every method the interface declares (`vi.fn()` for ones the test doesn't exercise).

## Composing the test layer

Stack all mocks (plus a silenced logger) into one layer and provide it once.
Reference: `network-monitor.test.ts`.

```typescript
const TestLayer = NetworkMonitorLive.pipe(
  Layer.provide(MockPingExecutor),
  Layer.provide(MockQuestDB),
  Layer.provide(MockSpeedTestService),
  Layer.provide(MockConfig),
  Layer.provide(Logger.minimumLogLevel(LogLevel.None)) // keep test output clean
);

it("gets initial stats", async () => {
  const program = Effect.gen(function* () {
    const monitor = yield* NetworkMonitor;
    const stats = yield* monitor.getStats();
    expect(stats.uptime).toBe(0);
  });
  await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));
});
```

## Config in tests

Never mutate `process.env`. Inject config with `ConfigProvider.fromMap` or a mock `ConfigService`
layer — see [`configuration.md`](./configuration.md).

```typescript
const withConfigProvider = (entries: Record<string, string>) =>
  Effect.withConfigProvider(ConfigProvider.fromMap(new Map(Object.entries(entries))));
```

## Testing concurrency

Fork background work, advance/sleep, then assert. Reference: `network-monitor.test.ts`.

```typescript
const fiber = yield* Effect.fork(monitor.start());
yield* Effect.sleep("100 millis");
const stats = yield* monitor.getStats();
expect(stats.uptime).toBeGreaterThan(0);
```

For deterministic time-based tests, `@effect/vitest` exposes `TestClock` (advance virtual time
instead of real `sleep`). Prefer it for schedules/retries when flakiness appears.

## Conventions (from `AGENTS.md`)

- New features need unit tests; bug fixes need a regression test.
- No `.skip` / `.only`; no assertion-free happy-path tests.
- Silence logs in tests with `Logger.minimumLogLevel(LogLevel.None)`.
- Keep tests in sync with code; don't weaken tests to make them pass.

## Anti-patterns

- ❌ `process.env.X = ...` in a test — inject via `ConfigProvider`/mock layer.
- ❌ Asserting on `exit._tag` / `option._tag` — use `Exit.isFailure`, `Option.isSome`, etc.
- ❌ Real network/DB calls in unit tests — provide a `Layer.succeed` mock instead.
- ❌ Forgetting to `Effect.provide` the test layer, leaving unmet requirements (a type error).
