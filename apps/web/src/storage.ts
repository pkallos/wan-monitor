import { Effect, Option, Schema as S } from "effect";
import { KeyValueStore } from "effect/unstable/persistence";
import { DateRangeSelection, Preset } from "@/dashboard/dateRange";
import { systemTheme, Theme } from "@/dashboard/theme";

// Every localStorage key this app owns is declared here. `index.html`'s
// pre-hydration boot script duplicates SETTINGS_STORAGE_KEY by necessity
// (it runs before any module loads) — keep the two in sync.
//
// Imports `@/dashboard/theme` and `@/dashboard/dateRange` directly, never
// the `@/dashboard` barrel, since `@/dashboard/command` imports this module.
export const SETTINGS_STORAGE_KEY = "wan_monitor_settings";
export const SESSION_STORAGE_KEY = "wan_monitor_token";

// Bump only when a field's *meaning* changes incompatibly (a rename, a unit
// change, a narrowed range) — a stored version newer than this one means the
// blob may hold a shape this build can't safely interpret even where a key
// happens to decode, so it's discarded wholesale (see readSettings). A pure
// addition needs no bump: per-field decoding below already degrades a
// missing/invalid field to its default without disturbing the rest.
export const SETTINGS_VERSION = 1;

export const Settings = S.Struct({
  theme: Theme,
  dateRange: DateRangeSelection,
  isPaused: S.Boolean,
});
export type Settings = typeof Settings.Type;

export const defaultSettings = (): Settings => ({
  theme: systemTheme(),
  dateRange: Preset({ preset: "last30d" }),
  isPaused: false,
});

// Each field below chains `catchDecoding` (an invalid value degrades to the
// fallback) with `withDecodingDefaultTypeKey` (a missing key does too), so
// one bad field can't wipe the other three. Written per-field rather than
// through a shared generic helper: a helper generic over the schema type
// can't convince the type checker that composing the two combinators on an
// abstract `T` still returns a `T`, even though it does for every concrete
// schema below.
const StoredSettings = S.Struct({
  version: S.Number.pipe(
    S.catchDecoding(() => Effect.succeed(Option.some(0))),
    S.withDecodingDefaultTypeKey(Effect.succeed(0))
  ),
  theme: Theme.pipe(
    S.catchDecoding(() => Effect.succeed(Option.some(systemTheme()))),
    S.withDecodingDefaultTypeKey(Effect.sync(systemTheme))
  ),
  dateRange: DateRangeSelection.pipe(
    S.catchDecoding(() =>
      Effect.succeed(Option.some(defaultSettings().dateRange))
    ),
    S.withDecodingDefaultTypeKey(Effect.sync(() => defaultSettings().dateRange))
  ),
  isPaused: S.Boolean.pipe(
    S.catchDecoding(() => Effect.succeed(Option.some(false))),
    S.withDecodingDefaultTypeKey(Effect.succeed(false))
  ),
});

// These require KeyValueStore from context rather than providing a layer
// themselves, so each Command below can provide the real
// `BrowserKeyValueStore.layerLocalStorage` while tests use `layerMemory`.

// Falls back to `defaultSettings()` on a missing key or a non-object/corrupt
// blob, rather than failing boot; a corrupt blob is also removed so the boot
// script's more lenient raw `JSON.parse` (`index.html`) doesn't keep
// repainting a theme this build no longer honors. A blob from a newer,
// incompatible version is discarded wholesale rather than trusting fields
// that merely happen to decode; anything else degrades per-field via
// `StoredSettings` above.
export const readSettings: Effect.Effect<
  Settings,
  never,
  KeyValueStore.KeyValueStore
> = Effect.gen(function* () {
  const store = yield* KeyValueStore.KeyValueStore;
  const schemaStore = KeyValueStore.toSchemaStore(store, StoredSettings);
  const maybeStored = yield* schemaStore
    .get(SETTINGS_STORAGE_KEY)
    .pipe(
      Effect.catch(
        (): Effect.Effect<
          Option.Option<never>,
          never,
          KeyValueStore.KeyValueStore
        > =>
          Effect.andThen(
            store.remove(SETTINGS_STORAGE_KEY).pipe(Effect.ignore),
            Effect.succeedNone
          )
      )
    );
  return Option.match(maybeStored, {
    onNone: () => defaultSettings(),
    onSome: ({ version, ...settings }) =>
      version > SETTINGS_VERSION ? defaultSettings() : settings,
  });
}).pipe(Effect.catch(() => Effect.succeed(defaultSettings())));

export const writeSettings = (settings: Settings) =>
  Effect.flatMap(KeyValueStore.KeyValueStore, (store) =>
    KeyValueStore.toSchemaStore(store, StoredSettings).set(
      SETTINGS_STORAGE_KEY,
      { version: SETTINGS_VERSION, ...settings }
    )
  );

// The auth token is a credential with its own lifecycle (cleared on logout),
// not a chrome setting, so it keeps its own key and is stored as a raw
// string — never through `toSchemaStore`, which would wrap it in JSON quotes
// and silently invalidate every stored session.
export const readToken: Effect.Effect<
  Option.Option<string>,
  never,
  KeyValueStore.KeyValueStore
> = Effect.gen(function* () {
  const store = yield* KeyValueStore.KeyValueStore;
  return Option.fromNullishOr(yield* store.get(SESSION_STORAGE_KEY));
}).pipe(Effect.catch(() => Effect.succeedNone));

export const writeToken = (token: string) =>
  Effect.flatMap(KeyValueStore.KeyValueStore, (store) =>
    store.set(SESSION_STORAGE_KEY, token)
  );

export const clearToken = Effect.flatMap(KeyValueStore.KeyValueStore, (store) =>
  store.remove(SESSION_STORAGE_KEY)
);
