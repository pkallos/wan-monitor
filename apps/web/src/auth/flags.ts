import { BrowserKeyValueStore } from "@effect/platform-browser";
import { Effect, Option, Schema as S } from "effect";
import { KeyValueStore } from "effect/unstable/persistence";
import { SESSION_STORAGE_KEY } from "@/auth/command";

export const Flags = S.Struct({
  maybeToken: S.Option(S.String),
});
export type Flags = typeof Flags.Type;

export const readStoredToken = Effect.gen(function* () {
  const store = yield* KeyValueStore.KeyValueStore;
  const token = yield* store.get(SESSION_STORAGE_KEY);
  return Flags.make({ maybeToken: Option.fromNullishOr(token) });
}).pipe(
  Effect.catch(() => Effect.succeed(Flags.make({ maybeToken: Option.none() })))
);

export const flags: Effect.Effect<Flags> = readStoredToken.pipe(
  Effect.provide(BrowserKeyValueStore.layerLocalStorage)
);
