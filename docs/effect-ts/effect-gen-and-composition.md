# Effect.gen & Composition

`Effect.gen` lets you write effectful logic that reads like synchronous code, with explicit control
over async, errors, and dependencies. `pipe` chains transformations. This repo uses `Effect.gen` as
the default and drops into `pipe` for post-processing (error mapping, retries, timeouts).

## `Effect.gen` basics

```typescript
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const db = yield* QuestDB;                 // resolve a service
  const rows = yield* db.queryMetrics(params); // run an effect, unwrap its success
  return transform(rows);                    // plain values are returned directly
});
```

- `yield*` runs an effect and unwraps its success value. If the effect fails, the generator
  short-circuits and the failure propagates.
- `yield*` a **`Context.Tag`** to resolve a service (see [`services-and-layers.md`](./services-and-layers.md)).
- Return the final value at the end; no need to wrap it in `Effect.succeed`.
- Tagged errors are yieldable: `return yield* new SomeError({ ... })` fails the effect.

Reference: `apps/server/src/core/api/handlers/metrics.ts`, `apps/server/src/index.ts`.

## `.pipe` for composition

Attach combinators after a `gen` block or any effect:

```typescript
Effect.gen(function* () { /* ... */ }).pipe(
  Effect.catchAll(mapQueryError("Failed to query metrics"))
);
```

Prefer `.pipe(...)` (method form) as used throughout the repo, rather than the standalone `pipe()`
function.

## Combinators used in this repo

| Combinator | Purpose | Seen in |
| --- | --- | --- |
| `Effect.map` | Transform the success value | `ping/service.ts` (`isReachable`) |
| `Effect.flatMap` | Sequence an effect that depends on the previous value | `ping/service.ts` |
| `Effect.catchAll` / `catchTag` | Recover from errors ([error-handling](./error-handling.md)) | `metrics.ts`, `questdb/service.ts` |
| `Effect.mapError` | Re-tag an error | `auth/middleware.ts` |
| `Effect.zipRight` | Run two effects, keep the second's result | `questdb/service.ts` |
| `Effect.tapErrorCause` | Side-effect on failure (logging) without handling | `index.ts` |
| `Effect.sleep` | Delay (accepts a `Duration` like `"100 millis"`) | `network-monitor.test.ts` |
| `Effect.fork` | Run an effect on a new fiber (concurrency) | `network-monitor.test.ts` |
| `Effect.never` | Never completes — keeps the server alive | `index.ts` |
| `Effect.void` | Succeed with `void` | mock layers in tests |
| `Effect.log` / `Effect.logError` | Structured logging | `server.ts`, `index.ts` |

## Concurrency & fibers

Effects run on **fibers** (lightweight virtual threads). Fork to run work in the background, then
observe or interrupt it.

```typescript
// network-monitor.test.ts
const fiber = yield* Effect.fork(monitor.start());
yield* Effect.sleep("100 millis");
const stats = yield* monitor.getStats();
// fiber is interrupted automatically when the scope/program ends
```

Use `Fiber.await(fiber)` to wait for completion, `Fiber.interrupt(fiber)` to cancel. Effect
interruption is cooperative and safe — resources acquired with `Layer.scoped`/`acquireRelease` are
released on interruption.

## Durations

Many time-based combinators accept a human-readable `Duration` string: `"100 millis"`, `"5 seconds"`,
`"1 minute"`. Prefer these over raw millisecond numbers.

## Running effects (the edge)

Run an effect **only at the boundary** — the app entry point, an HTTP handler wired by the platform,
or a test. Never `runPromise` inside service logic.

| Runner | Use | Seen in |
| --- | --- | --- |
| `Effect.runFork` | Fire-and-forget on a fiber; used for the long-running server | `index.ts` |
| `Effect.runPromise` | Await a success, reject on failure | tests |
| `Effect.runPromiseExit` | Await an `Exit` so you can assert on failures | tests (`speedtest/service.test.ts`) |
| `Effect.runSync` | Synchronous effects only | — |

```typescript
// index.ts
const runnable = program.pipe(
  Effect.provide(MainLive),
  Effect.tapErrorCause(Effect.logError)
);
Effect.runFork(runnable);
```

## Anti-patterns

- ❌ Mixing `async/await` with Effect. Wrap Promises with `Effect.tryPromise` and stay in the effect
  world (see [error-handling](./error-handling.md)).
- ❌ `Effect.runPromise` inside a service method — return the `Effect` and let the caller run it.
- ❌ Deeply nested `flatMap` chains where `Effect.gen` would be clearer. Default to `gen`.
