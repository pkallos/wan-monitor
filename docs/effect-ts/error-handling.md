# Error Handling

Effect tracks errors in a typed second channel (`Effect<A, E, R>`), not as thrown exceptions. Every
error this codebase produces is a tagged class so it can be recovered by tag instead of by string
comparison or `instanceof` on an untyped catch.

## Defining errors

**Domain errors (in-process only)** — `Data.TaggedError`:

```ts
import { Data } from "effect";

export class JwtExpiredError extends Data.TaggedError("JwtExpiredError")<{
  readonly message: string;
}> {}
```

See `apps/server/src/infrastructure/auth/jwt.ts` and `apps/server/src/infrastructure/auth/middleware.ts`
for the pattern repeated across every domain error in the server. `_tag` is set automatically and
excluded from the constructor; the class extends `Error` (real stack traces, `instanceof Error` is
true); construction takes a props object: `new JwtExpiredError({ message: "..." })`.

**Never hand-roll a plain class with a manual `readonly _tag` field.** It doesn't extend `Error` (no
stack trace, `instanceof Error` is false), has no value equality, and duplicates what `Data.TaggedError`
already gives you for free.

**Serializable / API-boundary errors** — `Schema.TaggedErrorClass` (so they encode/decode across the
HTTP boundary), as in `packages/shared/src/api/errors.ts`:

```ts
import { Schema } from "effect";

export class InvalidCredentials extends Schema.TaggedErrorClass<InvalidCredentials>()(
  "InvalidCredentials",
  { message: Schema.String },
  { httpApiStatus: 401 }
) {}
```

This is v4's `Schema.TaggedErrorClass` (v3's `Schema.TaggedError`, renamed). The third argument is a
schema annotations object; `httpApiStatus` is the field `effect/unstable/httpapi`'s `HttpApiSchema`
reads to pick the response status — it's a public, documented annotation key (declared without an
`@internal` marker in `HttpApiSchema.ts`'s `Schema.Annotations.Augment` interface), not an
implementation detail to avoid. `HttpApiSchema.status(401)(someSchema)` is the equivalent form for a
schema that isn't already a tagged-error class (`.pipe(HttpApiSchema.status(401))` on a plain
`Schema.String`, for example) — see `packages/shared/src/api/routes/auth.ts`'s `me` endpoint.

**Rule of thumb:** if the error only ever flows through the Effect error channel in-process, use
`Data.TaggedError`. If it crosses a serialization boundary (HTTP response), use
`Schema.TaggedErrorClass` with an `httpApiStatus` annotation.

## Recovering from errors

Discriminate by tag, never by direct `_tag` comparison:

```ts
effect.pipe(
  Effect.catchTag("JwtExpiredError", (e) => Effect.succeed(fallbackFor(e))),
  Effect.catchTags({
    SpeedTestExecutionError: (e) => handleExecutionError(e),
    SpeedTestTimeoutError: (e) => handleTimeout(e),
  })
);
```

`Effect.catch` recovers from every error the effect can produce, regardless of tag (v4's rename of
v3's `Effect.catchAll` — same "catch everything recoverable" semantics, just renamed since the source
declares it internally as `catch_` and re-exports it as `catch`, a reserved-word workaround, not a
different function). `Effect.catchCause` is the version that can also recover from defects and
interruption (v3's `Effect.catchAllCause`).

```ts
executeSpeedTest.pipe(
  Effect.catch((error) => new SpeedTestExecutionError({ message: error.message }))
);
```

## Single-error extraction: `Effect.result` / `Result`

To pull an effect's single typed error out as a value instead of catching it, use `Effect.result`
(v3's `Effect.either`) — it returns `Result<A, E>`, not `Either`. `Either` doesn't exist in v4 at all;
`Result` replaced it, with new accessor names:

```ts
import { Effect, Result } from "effect";

const result = yield* Effect.result(authService.verifyRequest(undefined));

if (Result.isFailure(result)) {
  expect(result.failure).toBeInstanceOf(MissingAuthHeaderError);
}
```

| v3 (`Either`) | v4 (`Result`) |
| --- | --- |
| `Either.isLeft(e)` | `Result.isFailure(r)` |
| `Either.isRight(e)` | `Result.isSuccess(r)` |
| `e.left` | `r.failure` |
| `e.right` | `r.success` |
| `Either.left(x)` | `Result.fail(x)` |
| `Either.right(x)` | `Result.succeed(x)` |

See `apps/server/src/infrastructure/auth/middleware.test.ts` and `apps/server/src/core/api/handlers/auth.test.ts`
for the full pattern in use.

## Inspecting a `Cause`

`Effect.exit`/`Effect.runSyncExit`/`Effect.runPromiseExit` give you an `Exit<A, E>`, whose `Failure`
case carries a `Cause<E>`. v4 flattened `Cause` from v3's recursive tree (`Fail | Die | Interrupt |
Sequential | Parallel | Empty`) to a simple wrapper around a flat array: `{ reasons:
ReadonlyArray<Reason<E>> }`, where `Reason` is just `Fail | Die | Interrupt`. A cause can still hold
**multiple** independent failures (from concurrent or sequential composition) — they just collapse
into one flat array instead of a tree.

**Don't** assume there's exactly one reason and index `cause.reasons[0]` directly — that's not what the
flattening is for, and it silently drops any reason after the first. Use the module's own search
helpers instead:

```ts
import { Cause, Exit, Option } from "effect";

const exit = yield* Effect.exit(service.runTest());

if (Exit.isFailure(exit)) {
  const error = Cause.findErrorOption(exit.cause); // Option<E>, searches all reasons
  if (Option.isSome(error)) {
    expect(error.value).toBeInstanceOf(SpeedTestTimeoutError);
  }
}
```

`Cause.findErrorOption(cause)` returns the first typed `Fail` error as an `Option<E>`. `Cause.findError`
does the same but returns a `Result<E, Cause<never>>` (the remaining cause on a miss, not just `None`).
`cause.reasons.filter(Cause.isFailReason)` gets all of them, if more than one might legitimately be
present. `Cause.hasFails` / `Cause.hasDies` / `Cause.hasInterrupts` test for presence without
extracting a value.

| v3 | v4 |
| --- | --- |
| `Cause.isFailType(cause)` | `Cause.isFailReason(reason)` — now narrows a `Reason`, not the whole `Cause` |
| `Cause.failureOption(cause)` | `Cause.findErrorOption(cause)` |
| `Cause.isFailure(cause)` | `Cause.hasFails(cause)` |
| `Cause.isInterrupted(cause)` | `Cause.hasInterrupts(cause)` (also `Exit.hasInterrupts(exit)` on an `Exit` directly) |
| `Cause.TimeoutException` | `Cause.TimeoutError` (all `*Exception` classes renamed to `*Error`) |

See `apps/server/src/index.test.ts`, `apps/server/src/infrastructure/database/questdb/queries.test.ts`,
and `apps/server/src/infrastructure/speedtest/service.test.ts` for real assertions using
`Cause.findErrorOption`.

## Anti-patterns

- ❌ A hand-rolled class with a manual `_tag` field instead of `Data.TaggedError` /
  `Schema.TaggedErrorClass`.
- ❌ Discriminating errors with `result._tag === "..."` instead of `Result.isFailure` /
  `Effect.catchTag`.
- ❌ Indexing `cause.reasons[0]` directly instead of `Cause.findErrorOption` / `.filter(isFailReason)`.
- ❌ Throwing a bare `Error` or rejecting a `Promise` across an `Effect` boundary instead of
  `Effect.fail(new SomeTaggedError(...))`.
- ❌ Setting a response status by hand-checking the error's `_tag` in a handler instead of annotating
  the error schema with `httpApiStatus` and letting the framework read it.
