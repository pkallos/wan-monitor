import { describe, expect, it } from "@effect/vitest";
import { DbUnavailable, InternalError } from "@shared/api/errors";
import { Effect } from "effect";
import { withApiErrors } from "@/core/api/handlers/db-error";
import {
  DatabaseQueryError,
  DatabaseUnavailable,
} from "@/infrastructure/database/questdb";
import { captureLogs } from "@/test/logs";

describe("withApiErrors", () => {
  it.effect(
    "maps an unreachable database to a DbUnavailable with a fixed message",
    () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          withApiErrors("Failed to query metrics")(
            Effect.fail(
              new DatabaseUnavailable({
                message: "connect ECONNREFUSED 127.0.0.1:8812",
              })
            )
          )
        );

        expect(error).toBeInstanceOf(DbUnavailable);
        expect(error.message).toBe("Database temporarily unavailable");
      })
  );

  it.effect(
    "maps any other failure to an InternalError with a fixed message",
    () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          withApiErrors("Failed to query metrics")(
            Effect.fail(
              new DatabaseQueryError({
                message:
                  "Failed to query metrics: column secret_col is invalid",
              })
            )
          )
        );

        expect(error).toBeInstanceOf(InternalError);
        expect(error.message).toBe("Internal server error");
      })
  );

  it.effect("logs the cause of an internal error under the label", () => {
    const logs = captureLogs();

    return Effect.gen(function* () {
      yield* Effect.flip(
        withApiErrors("Failed to query metrics")(
          Effect.fail(
            new DatabaseQueryError({
              message: "Failed to query metrics: column secret_col is invalid",
            })
          )
        )
      );

      expect(logs.entries).toHaveLength(1);
      expect(logs.entries[0]?.level).toBe("Error");
      expect(logs.entries[0]?.text).toContain("Failed to query metrics");
      expect(logs.entries[0]?.text).toContain("secret_col");
    }).pipe(Effect.provide(logs.layer));
  });

  it.effect("does not log an unreachable database as an internal error", () => {
    const logs = captureLogs();

    return Effect.gen(function* () {
      yield* Effect.flip(
        withApiErrors("Failed to query metrics")(
          Effect.fail(new DatabaseUnavailable({ message: "refused" }))
        )
      );

      expect(logs.entries).toEqual([]);
    }).pipe(Effect.provide(logs.layer));
  });

  it.effect("passes a successful result through untouched", () =>
    Effect.gen(function* () {
      const value = yield* withApiErrors("Failed to query metrics")(
        Effect.succeed(42)
      );

      expect(value).toBe(42);
    })
  );
});
