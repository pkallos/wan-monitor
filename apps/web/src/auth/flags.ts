import { BrowserKeyValueStore } from "@effect/platform-browser";
import { Effect, Option, Schema as S } from "effect";
import { defaultSettings, readSettings, readToken, Settings } from "@/storage";

export const Flags = S.Struct({
  maybeToken: S.Option(S.String),
  settings: Settings,
});
export type Flags = typeof Flags.Type;

// `readToken` and `readSettings` each swallow their own failures (missing
// key, unreadable/corrupt blob) and resolve to a usable fallback, so this
// composition can't fail either. Requires KeyValueStore rather than
// providing a layer itself, so it can be tested against
// `KeyValueStore.layerMemory` directly.
export const readFlags = Effect.gen(function* () {
  const maybeToken = yield* readToken;
  const settings = yield* readSettings;
  return Flags.make({ maybeToken, settings });
});

// `Effect.catchDefect` guards against a defect building the store itself —
// e.g. `localStorage` throwing a SecurityError with site data blocked — which
// happens before `readFlags` ever runs, so it can't be caught inside
// `readSettings`/`readToken`. Boot must never die for a blocked store.
export const flags: Effect.Effect<Flags> = readFlags.pipe(
  Effect.provide(BrowserKeyValueStore.layerLocalStorage),
  Effect.catchDefect(() =>
    Effect.succeed(
      Flags.make({ maybeToken: Option.none(), settings: defaultSettings() })
    )
  )
);
