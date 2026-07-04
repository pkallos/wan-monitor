import { DB_UNAVAILABLE, type DbUnavailableError } from "@shared/api/errors";
import { Clock, Effect } from "effect";
import { DbUnavailable } from "@/infrastructure/database/questdb";

/** Structured 503 body signalling QuestDB is unreachable. */
export const makeDbUnavailableError = (): Effect.Effect<DbUnavailableError> =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return {
      error: DB_UNAVAILABLE,
      message: "Database temporarily unavailable",
      timestamp: new Date(now).toISOString(),
    };
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
    Effect.gen(function* () {
      if (error instanceof DbUnavailable) {
        const err = yield* makeDbUnavailableError();
        return yield* Effect.fail(err);
      }
      return yield* Effect.fail(`${label}: ${error}`);
    });
