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
      Effect.andThen(Effect.sleep(Duration.seconds(5))),
      Effect.andThen(connectionLoop)
    )
  )
);
```

See `apps/server/src/infrastructure/database/questdb/connection.ts`. `Effect.andThen` also accepts a
function (`Effect.andThen((a) => nextEffect(a))`), in which case it behaves like `flatMap` — pick
whichever form reads more clearly at the call site.

## Forking fibers

| Combinator | Lifetime | Use it when |
| --- | --- | --- |
| `Effect.forkChild` | Attached to the **parent fiber's** scope. Interrupted when the parent terminates ("auto supervision" — no fiber leaks). | The common case: a background task that should die with whatever started it. v4's rename of v3's `Effect.fork` — identical semantics, confirmed by the source doc verbatim. |
| `Effect.forkScoped` | Attached to the **enclosing `Scope`**. Interrupted when that scope closes, independent of the parent fiber's own lifetime. | A resource-lifecycle task started inside a `Layer.effect` constructor, meant to run for as long as the layer is alive — see `questdb/connection.ts`'s retry loop. |
| `Effect.forkDetach` | Attached to the **global scope**. Outlives the fiber that forked it. | A genuine daemon that should keep running after its caller returns — rare; most "background work" in this codebase wants `forkChild`, not this. |

```ts
// apps/server/src/core/monitoring/network-monitor.ts
yield* executePingCycle.pipe(
  Effect.catch((error) => Effect.logError(`Ping cycle error: ${error}`).pipe(Effect.flatMap(() => Effect.void))),
  Effect.repeat(schedule),
  Effect.forkChild
);
```

Note the point-free form above (`Effect.forkChild` passed bare at the end of a `.pipe()` chain, not
called as `Effect.forkChild(...)`) — both call shapes exist; a mechanical rename script matching only
`Effect.fork(` misses this one, since there's no `(` to match.

## Running an effect

- **`Effect.runFork(effect)`** — starts the effect as a fiber and returns immediately; used at the
  program's entry point (`apps/server/src/index.ts`) and for fire-and-forget error recovery
  (`connection.ts`'s `Effect.runFork(markDisconnected(error.message))` inside a synchronous callback).
- **`Effect.runPromise(effect)`** / **`Effect.runPromiseExit(effect)`** — used at the boundary between
  Effect and a non-Effect caller that wants a `Promise` (test files that `await` an Effect program;
  Foldkit's own runtime handles this boundary for `Command`/`flags` Effects in `apps/web`).
- **`Effect.runSync(effect)`** / **`Effect.runSyncExit(effect)`** — only for effects known to complete
  synchronously with no async gap; rare in this codebase since almost everything touches I/O.

`Effect<A, E, never>` (`R = never`, no remaining requirements) is what every runner above actually
requires — if you're trying to run an effect and the type error says a service is still required,
that's the compiler telling you a `Layer.provide` is missing, not a runner-API mismatch.

## Anti-patterns

- ❌ `async`/`await` and bare `Promise` chains for anything that should compose with the rest of an
  Effect program — wrap it at the boundary with `Effect.tryPromise`/`Effect.promise` and stay in
  `Effect` from there on.
- ❌ `Effect.forkDetach` reached for by default "to be safe" — it's the one fork variant whose
  lifetime genuinely outlives its caller; using it where `forkChild` was intended leaks fibers instead
  of preventing leaks.
- ❌ Calling `Effect.runSync` on something that might actually suspend (a promise-backed effect, a
  `Effect.sleep`) — it throws at runtime instead of failing to compile, so get this right by matching
  the runner to what the effect actually does, not by trial and error.
