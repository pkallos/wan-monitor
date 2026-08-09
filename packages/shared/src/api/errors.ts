import { Schema } from "effect";

/**
 * Stable machine-readable code the frontend keys off to render the
 * "Database temporarily unavailable" banner. Kept in one place so the server
 * error payload and the client detection never drift.
 */
export const DB_UNAVAILABLE = "DB_UNAVAILABLE" as const;

/**
 * Structured body returned (with HTTP 503) by data endpoints when QuestDB is
 * unreachable. Declaring it as a typed API error lets the Effect HttpApiClient
 * decode it on the client instead of surfacing an opaque string.
 */
export const DbUnavailableErrorSchema = Schema.Struct({
  error: Schema.Literal(DB_UNAVAILABLE),
  message: Schema.String,
  timestamp: Schema.String,
});

export type DbUnavailableError = Schema.Schema.Type<
  typeof DbUnavailableErrorSchema
>;

// ---------------------------------------------------------------------------
// Typed HTTP errors — Schema.TaggedError subclasses carrying the response
// status. These replace plain `Effect.fail("string")` so the client can
// discriminate failures by error tag + HTTP status instead of string matching.
//
// `httpApiStatus` is the annotation key HttpApi resolves the error status from;
// leaving it off silently yields 500.
// ---------------------------------------------------------------------------

/** 400 — required fields missing from the login request. */
export class MissingCredentials extends Schema.TaggedError<MissingCredentials>()(
  "MissingCredentials",
  { message: Schema.String },
  { httpApiStatus: 400 }
) {}

/** 401 — username/password do not match configured credentials. */
export class InvalidCredentials extends Schema.TaggedError<InvalidCredentials>()(
  "InvalidCredentials",
  { message: Schema.String },
  { httpApiStatus: 401 }
) {}

/** 503 — auth is not configured (WAN_MONITOR_PASSWORD not set). */
export class AuthNotConfigured extends Schema.TaggedError<AuthNotConfigured>()(
  "AuthNotConfigured",
  { message: Schema.String },
  { httpApiStatus: 503 }
) {}

/** 503 — a dependency health check failed (e.g. QuestDB unreachable). */
export class HealthUnhealthy extends Schema.TaggedError<HealthUnhealthy>()(
  "HealthUnhealthy",
  { message: Schema.String },
  { httpApiStatus: 503 }
) {}
