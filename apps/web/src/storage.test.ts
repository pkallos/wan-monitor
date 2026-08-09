import { Effect, Layer, Option } from "effect";
import { KeyValueStore } from "effect/unstable/persistence";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Custom, Preset } from "@/dashboard/dateRange";
import {
  clearToken,
  defaultSettings,
  readSettings,
  readToken,
  SETTINGS_STORAGE_KEY,
  SETTINGS_VERSION,
  type Settings,
  writeSettings,
  writeToken,
} from "@/storage";

const stubSystemTheme = (prefersDark: boolean) =>
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: prefersDark && query === "(prefers-color-scheme: dark)",
  }));

const failingKeyValueStore = Layer.succeed(
  KeyValueStore.KeyValueStore,
  KeyValueStore.make({
    get: () =>
      Effect.fail(
        new KeyValueStore.KeyValueStoreError({
          message: "storage is unavailable",
          method: "get",
        })
      ),
    getUint8Array: () => Effect.succeed(undefined),
    set: () =>
      Effect.fail(
        new KeyValueStore.KeyValueStoreError({
          message: "storage is full",
          method: "set",
        })
      ),
    remove: () => Effect.succeed(undefined),
    clear: Effect.succeed(undefined),
    size: Effect.succeed(0),
  })
);

describe("defaultSettings", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("follows the OS dark preference", () => {
    stubSystemTheme(true);
    expect(defaultSettings().theme).toBe("dark");
  });

  test("follows the OS light preference", () => {
    stubSystemTheme(false);
    expect(defaultSettings().theme).toBe("light");
  });
});

describe("readSettings", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("falls back to defaultSettings() when nothing is stored", async () => {
    const result = await readSettings.pipe(
      Effect.provide(KeyValueStore.layerMemory),
      Effect.runPromise
    );

    expect(result).toEqual(defaultSettings());
  });

  test("round-trips a Preset date range", async () => {
    const settings: Settings = {
      theme: "dark",
      dateRange: Preset({ preset: "last7d" }),
      isPaused: true,
    };

    const result = await Effect.gen(function* () {
      yield* writeSettings(settings);
      return yield* readSettings;
    }).pipe(Effect.provide(KeyValueStore.layerMemory), Effect.runPromise);

    expect(result).toEqual(settings);
  });

  test("round-trips a Custom date range, preserving its _tag", async () => {
    const settings: Settings = {
      theme: "light",
      dateRange: Custom({
        startTime: "2026-01-01T00:00:00.000Z",
        endTime: "2026-01-08T00:00:00.000Z",
      }),
      isPaused: false,
    };

    const result = await Effect.gen(function* () {
      yield* writeSettings(settings);
      return yield* readSettings;
    }).pipe(Effect.provide(KeyValueStore.layerMemory), Effect.runPromise);

    expect(result).toEqual(settings);
    expect(result.dateRange._tag).toBe("Custom");
  });

  test("falls back to defaultSettings() on a corrupt (non-JSON) blob, and removes it", async () => {
    const result = await Effect.gen(function* () {
      const store = yield* KeyValueStore.KeyValueStore;
      yield* store.set(SETTINGS_STORAGE_KEY, "{not json");
      const settings = yield* readSettings;
      const stillStored = yield* store.get(SETTINGS_STORAGE_KEY);
      return { settings, stillStored };
    }).pipe(Effect.provide(KeyValueStore.layerMemory), Effect.runPromise);

    expect(result.settings).toEqual(defaultSettings());
    // Removed, not just ignored — otherwise `index.html`'s boot script (whose
    // own JSON.parse is more lenient than the schema) keeps reading a
    // `.theme` this build no longer honors.
    expect(result.stillStored).toBeUndefined();
  });

  test("falls back to defaultSettings() when the store itself fails", async () => {
    const result = await readSettings.pipe(
      Effect.provide(failingKeyValueStore),
      Effect.runPromise
    );

    expect(result).toEqual(defaultSettings());
  });

  test("an invalid field falls back to its own default without disturbing the others", async () => {
    const result = await Effect.gen(function* () {
      const store = yield* KeyValueStore.KeyValueStore;
      yield* store.set(
        SETTINGS_STORAGE_KEY,
        JSON.stringify({
          version: SETTINGS_VERSION,
          theme: "neon",
          dateRange: Preset({ preset: "last7d" }),
          isPaused: true,
        })
      );
      return yield* readSettings;
    }).pipe(Effect.provide(KeyValueStore.layerMemory), Effect.runPromise);

    expect(result).toEqual({
      theme: defaultSettings().theme,
      dateRange: Preset({ preset: "last7d" }),
      isPaused: true,
    });
  });

  test("a missing field falls back to its own default without disturbing the others", async () => {
    const result = await Effect.gen(function* () {
      const store = yield* KeyValueStore.KeyValueStore;
      yield* store.set(
        SETTINGS_STORAGE_KEY,
        JSON.stringify({ version: SETTINGS_VERSION, theme: "dark" })
      );
      return yield* readSettings;
    }).pipe(Effect.provide(KeyValueStore.layerMemory), Effect.runPromise);

    expect(result).toEqual({
      theme: "dark",
      dateRange: defaultSettings().dateRange,
      isPaused: false,
    });
  });

  test("ignores an unknown key rather than failing to decode", async () => {
    const result = await Effect.gen(function* () {
      const store = yield* KeyValueStore.KeyValueStore;
      yield* store.set(
        SETTINGS_STORAGE_KEY,
        JSON.stringify({
          version: SETTINGS_VERSION,
          theme: "dark",
          dateRange: Preset({ preset: "last7d" }),
          isPaused: false,
          somethingFromTheFuture: true,
        })
      );
      return yield* readSettings;
    }).pipe(Effect.provide(KeyValueStore.layerMemory), Effect.runPromise);

    expect(result).toEqual({
      theme: "dark",
      dateRange: Preset({ preset: "last7d" }),
      isPaused: false,
    });
  });

  test("a blob from a newer version resets wholesale rather than trusting fields that merely happen to decode", async () => {
    const result = await Effect.gen(function* () {
      const store = yield* KeyValueStore.KeyValueStore;
      yield* store.set(
        SETTINGS_STORAGE_KEY,
        JSON.stringify({
          version: SETTINGS_VERSION + 1,
          theme: "dark",
          dateRange: Preset({ preset: "last7d" }),
          isPaused: true,
        })
      );
      return yield* readSettings;
    }).pipe(Effect.provide(KeyValueStore.layerMemory), Effect.runPromise);

    expect(result).toEqual(defaultSettings());
  });

  test("a blob with no version (pre-migration) decodes leniently rather than resetting", async () => {
    const result = await Effect.gen(function* () {
      const store = yield* KeyValueStore.KeyValueStore;
      yield* store.set(
        SETTINGS_STORAGE_KEY,
        JSON.stringify({
          theme: "dark",
          dateRange: Preset({ preset: "last7d" }),
          isPaused: true,
        })
      );
      return yield* readSettings;
    }).pipe(Effect.provide(KeyValueStore.layerMemory), Effect.runPromise);

    expect(result).toEqual({
      theme: "dark",
      dateRange: Preset({ preset: "last7d" }),
      isPaused: true,
    });
  });
});

describe("writeSettings", () => {
  test("stamps the current SETTINGS_VERSION", async () => {
    const raw = await Effect.gen(function* () {
      const store = yield* KeyValueStore.KeyValueStore;
      yield* writeSettings(defaultSettings());
      return yield* store.get(SETTINGS_STORAGE_KEY);
    }).pipe(Effect.provide(KeyValueStore.layerMemory), Effect.runPromise);

    expect(raw).toBeDefined();
    expect(JSON.parse(raw as string).version).toBe(SETTINGS_VERSION);
  });
});

describe("token storage", () => {
  test("round-trips the token as a raw, unquoted string", async () => {
    const result = await Effect.gen(function* () {
      yield* writeToken("abc123");
      const store = yield* KeyValueStore.KeyValueStore;
      const stored = yield* store.get("wan_monitor_token");
      const read = yield* readToken;
      return { stored, read };
    }).pipe(Effect.provide(KeyValueStore.layerMemory), Effect.runPromise);

    // No wrapping quotes: this is what `toSchemaStore` would add, and it
    // would silently invalidate every session already stored on upgrade.
    expect(result.stored).toBe("abc123");
    expect(result.read).toEqual(Option.some("abc123"));
  });

  test("readToken is None when nothing is stored", async () => {
    const result = await readToken.pipe(
      Effect.provide(KeyValueStore.layerMemory),
      Effect.runPromise
    );

    expect(result).toEqual(Option.none());
  });

  test("clearToken removes a stored token", async () => {
    const result = await Effect.gen(function* () {
      yield* writeToken("abc123");
      yield* clearToken;
      return yield* readToken;
    }).pipe(Effect.provide(KeyValueStore.layerMemory), Effect.runPromise);

    expect(result).toEqual(Option.none());
  });
});
