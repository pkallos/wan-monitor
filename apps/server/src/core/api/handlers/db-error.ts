import { DbUnavailable, InternalError } from "@shared/api/errors";
import { Effect } from "effect";
import type {
  DatabaseQueryError,
  DatabaseUnavailable,
} from "@/infrastructure/database/questdb";

const DB_UNAVAILABLE_MESSAGE = "Database temporarily unavailable";
const INTERNAL_ERROR_MESSAGE = "Internal server error";

/** Fixed-message API errors only: driver text never reaches a client, and a 500's cause is logged under `label`. */
export const withApiErrors =
  (label: string) =>
  <A, R>(self: Effect.Effect<A, DatabaseUnavailable | DatabaseQueryError, R>) =>
    self.pipe(
      Effect.catchTag(
        "DatabaseUnavailable",
        () =>
          Effect.fail(new DbUnavailable({ message: DB_UNAVAILABLE_MESSAGE })),
        (error) =>
          Effect.logError(label, error).pipe(
            Effect.andThen(
              Effect.fail(
                new InternalError({ message: INTERNAL_ERROR_MESSAGE })
              )
            )
          )
      )
    );
