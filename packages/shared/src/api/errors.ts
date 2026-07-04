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
