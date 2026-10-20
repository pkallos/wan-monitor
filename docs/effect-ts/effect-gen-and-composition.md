# Effect.gen, pipe, and Composition

Effectful logic in this codebase is written with `Effect.gen`, composed with `pipe`, and forked or run
with one of a small set of documented combinators. There's no bare `async`/`await` outside an
`Effect.tryPromise`/`Effect.promise` boundary.

## `Effect.gen`

Write sequential effectful logic as a generator; `yield*` unwraps an `Effect`, and a thrown/failed
inner effect short-circuits the whole block:

```ts
const verifyRequest = (authHeader: string | undefined): Effect.Effect<JwtPayload | null, AuthError> =>
  Effect.gen(function* () {
    if (!config.auth.password) return null;
    if (!authHeader) {
      return yield* Effect.fail(new MissingAuthHeaderError({ message: "Authorization header required" }));
    }
    const payload = yield* jwtService.verify(token).pipe(
      Effect.mapError((error) => new UnauthorizedError({ message: `Invalid token: ${error.message}` }))
    );
    return payload;
  });
```

See `apps/server/src/infrastructure/auth/middleware.ts` for the full version. This is unchanged from
v3 — `Effect.gen` itself didn't move.

## `pipe` and sequencing combinators

`Effect.andThen` sequences two effects and keeps the second result, discarding the first — v4's rename
of v3's `Effect.zipRight` (same semantics: "run this, then run that, keep only the second"):

```ts
connectionLoop.pipe(
  Effect.catchCause((cause) =>
    Effect.logError("Connection loop crashed", cause).pipe(
      Effect.andThen(Effect.sleep(Duration.seconds(5)))
    )
  ),
  Effect.forever
);
```

See `apps/server/src/infrastructure/database/questdb/connection.ts`. `Effect.forever` restarts the loop
after each recovery, and interruption skips `catchCause`, so closing the scope still ends it.
`Effect.andThen` also accepts a function (`Effect.andThen((a) => nextEffect(a))`), in which case it
behaves like `flatMap` — pick whichever form reads more clearly at the call site.

## Forking fibers

| Combinator | Lifetime | Use it when |
| --- | --- | --- |
| `Effect.forkChild` | Attached to the **parent fiber's** scope. Interrupted when the parent terminates ("auto supervision" — no fiber leaks). | The common case: a background task that should die with whatever started it. v4's rename of v3's `Effect.fork` — identical semantics, confirmed by the source doc verbatim. |
| `Effect.forkScoped` | Attached to the **enclosing `Scope`**. Interrupted when that scope closes, independent of the parent fiber's own lifetime. | A task meant to run for as long as a scope is open: a `Layer.effect` constructor's background loop (`questdb/connection.ts`'s retry loop), or the monitor's ping and speed test loops, which `NetworkMonitor.start()` forks into the caller's `Scope`. |
| `Effect.forkDetach` | Attached to the **global scope**. Outlives the fiber that forked it. | A genuine daemon that should keep running after its caller returns — rare; prefer `forkScoped` or `forkChild`, which have an owner that ends them. |

```ts
// apps/server/src/core/monitoring/network-monitor.ts
yield* executePingCycle.pipe(
  Effect.schedule(Schedule.fixed(`${pingIntervalSeconds} seconds`)),
  Effect.forkScoped
);
```

Note the point-free form above (`Effect.forkScoped` passed bare at the end of a `.pipe()` chain, not
called as `Effect.forkScoped(...)`) — both call shapes exist; a mechanical rename script matching only
`Effect.fork(` misses this one, since there's no `(` to match.

`start()` has `Scope` in its requirements, so the loops end when the caller's scope closes. In
`index.ts` the program runs under `Effect.scoped` inside `Effect.provide(MainLive)`: the loops stop
first, then the layers they use (QuestDB) are released.

## Running an effect

- **`NodeRuntime.runMain(effect)`** — the process entry point (`apps/server/src/index.ts`). It
  interrupts the main fiber on SIGINT and SIGTERM so scope finalizers run, logs a failure's cause, and
  exits with code 130 after an interrupt or 1 after a failure.
- **`FiberSet.makeRuntime()`**: yields a run function that starts an effect as a fiber and returns
  immediately. Use it for fire-and-forget work inside a synchronous callback, such as
  `connection.ts`'s `runFork(markDisconnected(conn, error.message))` in a pg `error` handler. Create
  it once in the layer's `make`: the fibers it starts inherit the layer's context (logger, clock), and
  closing the layer's scope interrupts them, which a bare `Effect.runFork` does neither.
- **`Effect.runFork(effect)`**: starts the effect as a fiber outside any scope and returns
  immediately. Nothing interrupts the fiber when a scope closes.
- **`Effect.runPromise(effect)`** / **`Effect.runPromiseExit(effect)`** — used at the boundary between
  Effect and a non-Effect caller that wants a `Promise` (test files that `await` an Effect program;
  Foldkit's own runtime handles this boundary for `Command`/`flags` Effects in `apps/web`).
- **`Effect.runSync(effect)`** / **`Effect.runSyncExit(effect)`** — only for effects known to complete
  synchronously with no async gap; rare in this codebase since almost everything touches I/O.

`Effect<A, E, never>` (`R = never`, no remaining requirements) is what every runner above actually
requires — if you're trying to run an effect and the type error says a service is still required,
that's the compiler telling you a `Layer.provide` is missing, not a runner-API mismatch.

## Cancelling a Promise on timeout or interrupt

`Effect.timeout` and fiber interruption stop the Effect, not the Promise behind it. To stop the
underlying work too, take the `AbortSignal` that `Effect.tryPromise` passes to `try` and hand it on:

```ts
Effect.tryPromise({
  try: (signal) => executor(signal),
  catch: (error) => new SpeedTestExecutionError({ message: String(error) }),
}).pipe(Effect.timeout(Duration.seconds(120)));
```

The signal aborts when the timeout fires or the fiber is interrupted, and not after the Promise
settles. Effect creates it only when `try` declares a parameter, so `try: () => executor()` and
`try: executor` (with a zero-parameter `executor`) never receive one. See
`makeSpeedTestService` and `liveExecutor` in `apps/server/src/infrastructure/speedtest/service.ts`.

## Anti-patterns

- ❌ `Effect.runFork` at a process entry point: nothing handles SIGTERM, so scope finalizers never
  run, and a failed layer leaves the process exiting with code 0. Use `NodeRuntime.runMain`.
- ❌ `async`/`await` and bare `Promise` chains for anything that should compose with the rest of an
  Effect program — wrap it at the boundary with `Effect.tryPromise`/`Effect.promise` and stay in
  `Effect` from there on.
- ❌ `Effect.forkDetach` reached for by default "to be safe" — it's the one fork variant whose
  lifetime genuinely outlives its caller; using it where `forkChild` was intended leaks fibers instead
  of preventing leaks.
- ❌ Calling `Effect.runSync` on something that might actually suspend (a promise-backed effect, a
  `Effect.sleep`) — it throws at runtime instead of failing to compile, so get this right by matching
  the runner to what the effect actually does, not by trial and error.
