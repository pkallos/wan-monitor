# Schema

`Schema` describes the shape of data and gives you decoding, encoding, and derived TypeScript types
from a single source of truth. In this repo, Schema defines the **shared API contract** (request
params, responses, errors) in `packages/shared`, so the server and web client stay in sync.

> **Import from `effect`.** Use `import { Schema } from "effect"`. There is no separate schema
> package. See `packages/shared/src/api/routes/metrics.ts` and `packages/shared/src/api/errors.ts`.

## Understanding `Schema<Type, Encoded, Context>`

- **Type** — the decoded, in-app TypeScript value.
- **Encoded** — the serialized/wire form (e.g. a string over HTTP).
- **Context** — dependencies needed to decode/encode (usually `never`).

`Schema.NumberFromString` is the classic example: `Type = number`, `Encoded = string`. It decodes a
query-string `"50"` into `50`. It is the base of `PositiveIntFromStringSchema`, which `limit` uses.

## Defining schemas

```ts
import { Schema } from "effect";

export const MetricSchema = Schema.Struct({
  timestamp: Schema.String,
  source: Schema.Literals(["ping", "speedtest"]),
  host: Schema.optional(Schema.String),
  latency: Schema.optional(Schema.Number),
});
```

`Schema.Literals` takes an **array** of literal values — `Schema.Literals(["http", "tcp"])`, not
`Schema.Literal("http", "tcp")`. v4's `Schema.Literal(value)` is single-argument (one literal only);
the multi-value case moved to the separate `Literals` function entirely. Likewise `Schema.Union` takes
an array: `Schema.Union([SchemaA, SchemaB])`, not `Schema.Union(SchemaA, SchemaB)`. Both are easy to
get wrong quietly, since the old multi-argument call shape doesn't error until you actually reach for
more than one argument.

Derive the TypeScript type from a schema — never redeclare it by hand:

```ts
export type Granularity = Schema.Schema.Type<typeof GranularitySchema>;
```

## Decoding and encoding

- `Schema.decodeUnknownEffect(schema)` — effectful decode from `unknown`, fails with a typed
  `SchemaError` in the `Effect` error channel. This is v4's rename of v3's `Schema.decodeUnknown`
  (the un-suffixed name in v4 belongs to a different, narrower overload; use the `*Effect` suffix
  for the common "decode inside an `Effect.gen`" case).
- `Schema.decodeUnknownSync(schema)` — throws on failure. Reserve for places you've already validated
  the input is well-formed (e.g. decoding your own just-encoded value back); never use it on
  unvalidated external input inside service logic.
- `Schema.encode(schema)` / `Schema.decode(schema)` — for values already known to be schema-shaped
  (`Type`/`Encoded` respectively), not raw `unknown`.

## Custom validation

`Schema.check` attaches a predicate to a schema, and `Schema.makeFilter` builds one from a plain
function. A request that fails the predicate is rejected by `HttpApi` with a 400 before the handler runs:

```ts
export const IsoTimestampSchema = Schema.String.check(
  Schema.makeFilter((value) => isValidIsoTimestamp(value), {
    message: "Expected an ISO 8601 timestamp in years 0000 to 9999, such as 2024-02-10T08:00:00Z",
  })
);
```

See `packages/shared/src/api/schemas.ts`, used by the `startTime` and `endTime` query fields in the
route schemas under `packages/shared/src/api/routes/`. The predicate is `isValidIsoTimestamp` in
`packages/shared/src/timestamp.ts`. `PositiveIntFromStringSchema` in the same file is a second
example: it decodes a query-string number such as `limit` and rejects anything that is not a positive
integer.

## Config-validated values

`Config.schema(schema, envVarName)` reads an environment variable through a `Schema` and produces a
`ConfigError` automatically on a mismatch — see `configuration.md` for the full pattern. Prefer this
over hand-writing a `Config.mapOrFail` with a manually-constructed `ConfigError`; it already does the
validation-error wrapping correctly and gives a structured, path-aware error instead of a flat string.

## Typed HTTP errors

`Schema.TaggedErrorClass` (v3's `Schema.TaggedError`, renamed) defines an error that both encodes over
HTTP and carries a response status, via the `httpApiStatus` annotation:

```ts
export class MissingCredentials extends Schema.TaggedErrorClass<MissingCredentials>()(
  "MissingCredentials",
  { message: Schema.String },
  { httpApiStatus: 400 }
) {}
```

See `error-handling.md` for the full error-modeling rules and `http-api.md` for how these attach to
endpoints.

## Anti-patterns

- ❌ Declaring a `type`/`interface` next to a schema by hand. Derive with `Schema.Schema.Type`.
- ❌ Importing `Schema` from anywhere but the `effect` barrel.
- ❌ `Schema.Literal("a", "b", "c")` or `Schema.Union(a, b)` — both are single-argument in v4; the
  multi-value form is `Schema.Literals([...])` / `Schema.Union([...])`.
- ❌ `decodeUnknownSync` inside service logic on unvalidated input — it throws; use the effectful
  `decodeUnknownEffect`.
- ❌ Duplicating the same shape in `packages/shared` and the server. Define once in shared, import it.
