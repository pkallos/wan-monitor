import { DB_UNAVAILABLE, type DbUnavailableError } from "@shared/api/errors";
import { Effect } from "effect";
import { DbUnavailable } from "@/infrastructure/database/questdb";

/** Structured 503 body signalling QuestDB is unreachable. */
export const makeDbUnavailableError = (): DbUnavailableError => ({
  error: DB_UNAVAILABLE,
  message: "Database temporarily unavailable",
  timestamp: new Date().toISOString(),
});

/**
 * Uniform error mapping for data-query handlers: a `DbUnavailable` failure
 * becomes the structured 503 `DB_UNAVAILABLE` error (which the frontend keys off
 * to show its recovery banner); anything else becomes a generic string error
 * (HTTP 500) tagged with the provided context label.
 */
export const mapQueryError =
  (label: string) =>
  (error: unknown): Effect.Effect<never, DbUnavailableError | string> =>
    error instanceof DbUnavailable
      ? Effect.fail(makeDbUnavailableError())
      : Effect.fail(`${label}: ${error}`);
