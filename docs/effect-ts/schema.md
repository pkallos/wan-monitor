# Schema

`Schema` describes the shape of data and gives you decoding, encoding, and derived TypeScript types
from a single source of truth. In this repo, Schema defines the **shared API contract** (request
params, responses, errors) in `packages/shared`, so the server and web client stay in sync.

> **Import from `effect`.** Our code uses `import { Schema } from "effect"`, not
> `@effect/schema`, even though the latter is a listed dependency. Stay consistent. See
> `packages/shared/src/api/routes/metrics.ts` and `packages/shared/src/api/errors.ts`.

## Understanding `Schema<Type, Encoded, Context>`

- **Type** — the decoded, in-app TypeScript value.
- **Encoded** — the serialized/wire form (e.g. a string over HTTP).
- **Context** — dependencies needed to decode/encode (usually `never`).

`Schema.NumberFromString` is the classic example: `Type = number`, `Encoded = string`. It decodes a
query-string `"50"` into `50`. Used for `limit` in `GetMetricsQueryParams`.

## Defining schemas

Reference: `packages/shared/src/api/routes/metrics.ts`.

```typescript
import { Schema } from "effect";

// Literal unions
export const GranularitySchema = Schema.Literal("1m", "5m", "15m", "1h", "6h", "1d");

// Structs with optional fields
export const MetricSchema = Schema.Struct({
  timestamp: Schema.String,
  source: Schema.Literal("ping", "speedtest"),
  host: Schema.optional(Schema.String),
  latency: Schema.optional(Schema.Number),
});

// Query params: NumberFromString decodes "50" -> 50
export const GetMetricsQueryParams = Schema.Struct({
  startTime: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString),
  granularity: Schema.optional(GranularitySchema),
});

// Arrays / nesting
const GetMetricsResponse = Schema.Struct({
  data: Schema.Array(MetricSchema),
  meta: MetaSchema,
});
```

Common building blocks used here: `Schema.String`, `Schema.Number`, `Schema.Boolean`,
`Schema.Literal(...)`, `Schema.Struct({...})`, `Schema.Array(...)`, `Schema.optional(...)`,
`Schema.NumberFromString`.

## Deriving TypeScript types

**Always derive the type from the schema** with `Schema.Schema.Type<typeof X>` — never write a
parallel `interface` that can drift. Reference: `metrics.ts`, `errors.ts`.

```typescript
export type Granularity = Schema.Schema.Type<typeof GranularitySchema>;
export type Metric = Schema.Schema.Type<typeof MetricSchema>;
export type DbUnavailableError = Schema.Schema.Type<typeof DbUnavailableErrorSchema>;
```

In handlers, type the decoded params off the shared schema so server and contract match:

```typescript
// core/api/handlers/metrics.ts
export const getMetricsHandler = ({
  urlParams,
}: {
  urlParams: Schema.Schema.Type<typeof GetMetricsQueryParams>;
}) => Effect.gen(function* () { /* ... */ });
```

## Decoding & encoding

The `HttpApi` layer decodes/encodes automatically at the boundary (see [`http-api.md`](./http-api.md)),
so handlers receive already-decoded values. When you need to decode manually:

- `Schema.decodeUnknown(schema)(input)` → `Effect<Type, ParseError>` — validate untrusted input.
- `Schema.decodeUnknownSync(schema)(input)` → throws on failure (edges/tests only).
- `Schema.encode(schema)(value)` → `Effect<Encoded, ParseError>` — back to the wire form.
- `*Either` / `*Option` variants return `Either`/`Option` instead of an effect.

Prefer the effectful `decodeUnknown` inside Effect code so parse failures live in the error channel.

## Transformations

For values whose in-app form differs from the wire form, use `Schema.transform` (infallible) or
`Schema.transformOrFail` (can fail during decode/encode). `Schema.NumberFromString` is a built-in
transform. Reach for custom transforms only when a plain struct field can't express the mapping.

## Serializable errors

API errors are schemas too, so the client can decode them instead of getting an opaque string.
Reference: `packages/shared/src/api/errors.ts`.

```typescript
export const DbUnavailableErrorSchema = Schema.Struct({
  error: Schema.Literal(DB_UNAVAILABLE),
  message: Schema.String,
  timestamp: Schema.String,
});
```

For tagged, status-annotated errors use `Schema.TaggedError` (see [error-handling](./error-handling.md)).

## Anti-patterns

- ❌ Declaring a `type`/`interface` next to a schema by hand. Derive with `Schema.Schema.Type`.
- ❌ Importing `Schema` from `@effect/schema` when the rest of the repo uses `effect`.
- ❌ `decodeUnknownSync` inside service logic — it throws; use the effectful `decodeUnknown`.
- ❌ Duplicating the same shape in `packages/shared` and the server. Define once in shared, import it.
