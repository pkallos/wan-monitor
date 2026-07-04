import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  makeDbUnavailableError,
  mapQueryError,
} from "@/core/api/handlers/db-error";
import {
  DatabaseQueryError,
  DbUnavailable,
} from "@/infrastructure/database/questdb";

describe("mapQueryError", () => {
  it("makeDbUnavailableError returns the structured 503 payload", () => {
    const payload = makeDbUnavailableError();
    expect(payload.error).toBe("DB_UNAVAILABLE");
    expect(payload.message).toBe("Database temporarily unavailable");
    expect(typeof payload.timestamp).toBe("string");
  });

  it.effect("maps a DbUnavailable failure to the structured 503 payload", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        mapQueryError("Failed to query metrics")(
          new DbUnavailable("connection refused")
        )
      );
      expect(error).toMatchObject({ error: "DB_UNAVAILABLE" });
    })
  );

  it.effect("maps any other failure to a labelled string error", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        mapQueryError("Failed to query metrics")(new DatabaseQueryError("boom"))
      );
      expect(typeof error).toBe("string");
      expect(error).toContain("Failed to query metrics");
    })
  );
});
