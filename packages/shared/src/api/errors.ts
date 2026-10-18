import { Schema } from "effect";

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

/** 400 when a time range is reversed or wider than the endpoint allows. */
export class InvalidTimeRange extends Schema.TaggedError<InvalidTimeRange>()(
  "InvalidTimeRange",
  { message: Schema.String },
  { httpApiStatus: 400 }
) {}

/** 503 — a dependency health check failed (e.g. QuestDB unreachable). */
export class HealthUnhealthy extends Schema.TaggedError<HealthUnhealthy>()(
  "HealthUnhealthy",
  { message: Schema.String },
  { httpApiStatus: 503 }
) {}

/**
 * 503 — QuestDB is unreachable. The web app keys its "database unavailable"
 * banner on this tag; the message is fixed and never carries driver text.
 */
export class DbUnavailable extends Schema.TaggedError<DbUnavailable>()(
  "DbUnavailable",
  { message: Schema.String },
  { httpApiStatus: 503 }
) {}

/**
 * 500 when a data query fails for a reason other than an outage. Fixed
 * message; the cause stays in the server log.
 */
export class InternalError extends Schema.TaggedError<InternalError>()(
  "InternalError",
  { message: Schema.String },
  { httpApiStatus: 500 }
) {}
