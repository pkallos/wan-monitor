import { Effect, Option } from "effect";
import { KeyValueStore } from "effect/unstable/persistence";
import { describe, expect, test } from "vitest";
import { flags, readFlags } from "@/auth/flags";
import { Preset } from "@/dashboard/dateRange";
import {
  defaultSettings,
  SESSION_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
} from "@/storage";

describe("readFlags", () => {
  test("decodes a stored token and settings into Flags", async () => {
    const result = await Effect.gen(function* () {
      const store = yield* KeyValueStore.KeyValueStore;
      yield* store.set(SESSION_STORAGE_KEY, "abc123");
      yield* store.set(
        SETTINGS_STORAGE_KEY,
        JSON.stringify({
          theme: "dark",
          dateRange: Preset({ preset: "last7d" }),
          isPaused: true,
        })
      );
      return yield* readFlags;
    }).pipe(Effect.provide(KeyValueStore.layerMemory), Effect.runPromise);

    expect(result).toEqual({
      maybeToken: Option.some("abc123"),
      settings: {
        theme: "dark",
        dateRange: Preset({ preset: "last7d" }),
        isPaused: true,
      },
    });
  });

  test("falls back to no token and default settings when nothing is stored", async () => {
    const result = await readFlags.pipe(
      Effect.provide(KeyValueStore.layerMemory),
      Effect.runPromise
    );

    expect(result).toEqual({
      maybeToken: Option.none(),
      settings: defaultSettings(),
    });
  });

  test("still returns the token when the settings blob is corrupt", async () => {
    const result = await Effect.gen(function* () {
      const store = yield* KeyValueStore.KeyValueStore;
      yield* store.set(SESSION_STORAGE_KEY, "abc123");
      yield* store.set(SETTINGS_STORAGE_KEY, "{not json");
      return yield* readFlags;
    }).pipe(Effect.provide(KeyValueStore.layerMemory), Effect.runPromise);

    expect(result).toEqual({
      maybeToken: Option.some("abc123"),
      settings: defaultSettings(),
    });
  });
});

describe("flags", () => {
  test("falls back to defaults when the storage layer itself throws (blocked localStorage)", async () => {
    // `BrowserKeyValueStore.layerLocalStorage` reads `globalThis.localStorage`
    // inside `Layer.sync`, unguarded — Chrome throws a SecurityError there
    // when site data is blocked for the origin. That's a defect, not a typed
    // failure, so it happens before `readSettings`/`readToken` ever run and
    // can't be caught inside them; `flags` has to guard it at the boundary.
    const original = Object.getOwnPropertyDescriptor(
      globalThis,
      "localStorage"
    );
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Access is denied.", "SecurityError");
      },
    });

    try {
      const result = await Effect.runPromise(flags);
      expect(result).toEqual({
        maybeToken: Option.none(),
        settings: defaultSettings(),
      });
    } finally {
      if (original) {
        Object.defineProperty(globalThis, "localStorage", original);
      }
    }
  });
});
