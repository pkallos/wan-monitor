import { Effect, Option } from "effect";
import { KeyValueStore } from "effect/unstable/persistence";
import { describe, expect, test } from "vitest";
import { SESSION_STORAGE_KEY } from "@/auth/command";
import { readStoredToken } from "@/auth/flags";

describe("readStoredToken", () => {
  test("decodes a stored token into Flags", async () => {
    const result = await Effect.gen(function* () {
      const store = yield* KeyValueStore.KeyValueStore;
      yield* store.set(SESSION_STORAGE_KEY, "abc123");
      return yield* readStoredToken;
    }).pipe(Effect.provide(KeyValueStore.layerMemory), Effect.runPromise);

    expect(result).toEqual({ maybeToken: Option.some("abc123") });
  });

  test("falls back to no token when nothing is stored", async () => {
    const result = await readStoredToken.pipe(
      Effect.provide(KeyValueStore.layerMemory),
      Effect.runPromise
    );

    expect(result).toEqual({ maybeToken: Option.none() });
  });
});
