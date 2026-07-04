# Error Handling

Effect tracks **expected errors** in the error channel: `Effect<Success, Error, Requirements>`. This
means the compiler knows every failure a program can produce, as a union of types. Model failures as
data, recover with tag-based combinators, and never inspect `_tag` by hand.

## Defining errors

### In-process errors → `Data.TaggedError`

Use `Data.TaggedError` for failures that only ever travel through the Effect error channel in this
process. Reference: `apps/server/src/infrastructure/auth/jwt.ts`,
`apps/server/src/infrastructure/ping/service.ts`.

```typescript
import { Data } from "effect";

export class PingTimeoutError extends Data.TaggedError("PingTimeoutError")<{
  readonly host: string;
  readonly timeoutMs: number;
}> {}

// Construction uses a props object:
new PingTimeoutError({ host, timeoutMs });
```

Why this over a hand-rolled class:

- `_tag` is set automatically (the discriminant `catchTag` keys off).
- It extends `Error`, so you get real stack traces and `instanceof Error === true`.
- Value equality/hashing via `Data`.
- It is **yieldable**: `return yield* new PingTimeoutError(...)` works without `Effect.fail`.

Group related errors into a union type for signatures:

```typescript
export type JwtError = JwtInvalidError | JwtExpiredError | JwtMissingError;
```

### API-boundary errors → `Schema.TaggedError`

If an error crosses a serialization boundary (HTTP response, worker message) it must encode/decode.
Use `Schema.TaggedError` with `HttpApiSchema.annotations` for the status code. Reference:
`packages/shared/src/api/middlewares/authorization.ts`.

```typescript
import { HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  {},
  HttpApiSchema.annotations({ status: 401 })
) {}
```

**Rule of thumb:** in-process only → `Data.TaggedError`; crosses a boundary → `Schema.TaggedError`.

## Wrapping non-Effect code

Never let a raw `throw` or rejected `Promise` escape into an Effect. Wrap it and map to a typed error.

| Source | Combinator | Example |
| --- | --- | --- |
| Sync code that can throw | `Effect.try({ try, catch })` | `jwt.verify` in `jwt.ts` |
| Async / Promise | `Effect.tryPromise({ try, catch })` | `ping.promise.probe` in `ping/service.ts`, `pgClient.query` in `questdb/service.ts` |
| Sync code that can't throw | `Effect.sync(() => ...)` | `jwt.sign` |
| Async that can't reject | `Effect.promise(() => ...)` | — |

```typescript
const verify = (token: string): Effect.Effect<JwtPayload, JwtError> =>
  Effect.try({
    try: () => {
      const decoded = jwt.verify(token, config.auth.jwtSecret);
      if (!isJwtPayload(decoded)) throw new Error("Invalid token payload");
      return decoded;
    },
    catch: (error) =>
      error instanceof Error && error.name === "TokenExpiredError"
        ? new JwtExpiredError({ message: error.message })
        : new JwtInvalidError({ message: "Invalid token" }),
  });
```

The `catch` function is where you translate opaque unknowns into your typed domain errors. Classify
by inspecting the caught value (see the QuestDB pattern of mapping connection errors to `DbUnavailable`).

## Recovering from errors

### `catchTag` / `catchTags` — handle specific failures

Prefer these over `catchAll` when you want targeted recovery. They are type-safe: handled tags are
removed from the error channel, unhandled ones keep propagating. Reference:
`apps/server/src/infrastructure/database/questdb/service.ts`.

```typescript
Effect.gen(function* () {
  // ...db work that may fail with DbUnavailable | DatabaseWriteError
}).pipe(
  Effect.catchTag("DbUnavailable", (e) =>
    connection.markDisconnected(e.message).pipe(Effect.zipRight(Effect.fail(e)))
  )
);
```

```typescript
effect.pipe(
  Effect.catchTags({
    NotFoundError: () => Effect.succeed(fallback),
    ValidationError: (err) => Effect.fail(new ApiError(err.message)),
  })
);
```

### `catchAll` — collapse everything

Use when you genuinely want to handle *all* remaining errors, typically at a boundary to map into a
uniform response. Reference: `apps/server/src/core/api/handlers/metrics.ts` +
`apps/server/src/core/api/handlers/db-error.ts`.

```typescript
export const mapQueryError =
  (label: string) =>
  (error: unknown): Effect.Effect<never, DbUnavailableError | string> =>
    error instanceof DbUnavailable
      ? Effect.fail(makeDbUnavailableError())
      : Effect.fail(`${label}: ${error}`);

// handler:
Effect.gen(function* () { /* ... */ }).pipe(
  Effect.catchAll(mapQueryError("Failed to query metrics"))
);
```

### `mapError` — transform without recovering

Re-tag an error while keeping it in the failure channel. Reference:
`apps/server/src/infrastructure/auth/middleware.ts`.

```typescript
jwtService.verify(token).pipe(
  Effect.mapError((error) => new UnauthorizedError({ message: `Invalid token: ${error.message}` }))
);
```

## Type guards over `_tag`

**Never** compare `_tag` strings directly. Use the module guards / matchers:

```typescript
import { Either, Exit, Option } from "effect";

// ❌ if (result._tag === "Left") { ... }
// ✅
if (Either.isLeft(result)) { const err = result.left; }
if (Option.isSome(opt)) { const value = opt.value; }
if (Exit.isFailure(exit)) { const cause = exit.cause; }

Either.match(result, {
  onLeft: (error) => { /* ... */ },
  onRight: (value) => { /* ... */ },
});
```

`Option.isSome`/`isNone` are used in `questdb/service.ts` (`health()`); `Exit` guards appear across
`*.test.ts` files.

## Fail vs defect

- `Effect.fail(error)` — an **expected** error, tracked in the error channel. This is the default.
- Throwing / `Effect.die` — a **defect** (unrecoverable bug). Reserve for truly unexpected states.
- At the top level, log the full cause: `program.pipe(Effect.tapErrorCause(Effect.logError))`
  (see `apps/server/src/index.ts`).

## Anti-patterns

- ❌ `catch (e) { throw e }` inside `Effect.tryPromise` — return a typed error from `catch` instead.
- ❌ `Effect.catchAll(() => Effect.succeed(undefined))` swallowing errors silently.
- ❌ Direct `_tag` comparisons or `instanceof` chains where `catchTag` would do.
- ❌ Plain `class FooError { readonly _tag = "Foo" }` — use `Data.TaggedError`/`Schema.TaggedError`.
