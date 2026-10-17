import { Duration, Effect, Schema as S, Stream } from "effect";
import { Dom, Subscription } from "foldkit";
import type { Message } from "@/dashboard/message";
import {
  ChangedSystemTheme,
  Interacted,
  TickedRefresh,
  WentIdle,
} from "@/dashboard/message";
import type { Model } from "@/dashboard/model";
import { DARK_SCHEME_QUERY } from "@/dashboard/theme";

const REFRESH_INTERVAL = Duration.seconds(30);
const IDLE_TIMEOUT = Duration.minutes(2);
const ACTIVITY_EVENTS = [
  "mousemove",
  "keydown",
  "scroll",
  "touchstart",
  "click",
] as const;

export const modelToDependencies = (model: Model) => ({
  isPaused: model.isPaused,
  isIdle: model.isIdle,
});

export const dependenciesToStream = ({
  isPaused,
  isIdle,
}: {
  isPaused: boolean;
  isIdle: boolean;
}): Stream.Stream<Message> =>
  Stream.when(
    // Stream.tick emits immediately; drop that first emission so
    // arriving on the dashboard doesn't instantly refetch data that
    // EnteredDashboard just loaded.
    Stream.tick(REFRESH_INTERVAL).pipe(
      Stream.drop(1),
      Stream.map(() => TickedRefresh())
    ),
    Effect.sync(() => !isPaused && !isIdle)
  );

const activityStream = (): Stream.Stream<Message> =>
  Stream.mergeAll(
    ACTIVITY_EVENTS.map((type) =>
      Dom.streamFromEvent({
        target: window,
        type,
        mapEvent: () => Interacted(),
      })
    ),
    { concurrency: "unbounded" }
  );

// Seeded with one synthetic value so the debounce clock starts the instant
// the dashboard mounts, not just after the first real event — otherwise a
// user who never touches anything would never go idle.
const idleStream: Stream.Stream<Message> = Stream.concat(
  Stream.succeed(Interacted()),
  activityStream()
).pipe(
  Stream.debounce(IDLE_TIMEOUT),
  Stream.map(() => WentIdle())
);

// Exported standalone (rather than only living inside `subscriptions` below)
// so the auth layer — which owns the actual `isLoggedIn` gate the dashboard
// has no way to know about — can wrap it the same way it wraps `refresh`.
export const activityAndIdleStream: Stream.Stream<Message> = Stream.merge(
  activityStream(),
  idleStream
);

export const systemThemeModelToDependencies = (model: Model) => ({
  isSystemTheme: model.theme === "system",
});

// Only a `system` preference tracks the OS: an explicit light or dark choice
// must not repaint when the OS flips.
export const systemThemeDependenciesToStream = ({
  isSystemTheme,
}: {
  isSystemTheme: boolean;
}): Stream.Stream<Message> =>
  Stream.when(
    Dom.streamFromMediaQuery({
      query: DARK_SCHEME_QUERY,
      mapMatches: () => ChangedSystemTheme(),
    }),
    Effect.sync(() => isSystemTheme)
  );

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  refresh: entry(
    { isPaused: S.Boolean, isIdle: S.Boolean },
    { modelToDependencies, dependenciesToStream }
  ),
  activity: Subscription.persistentEntry(activityAndIdleStream),
  systemTheme: entry(
    { isSystemTheme: S.Boolean },
    {
      modelToDependencies: systemThemeModelToDependencies,
      dependenciesToStream: systemThemeDependenciesToStream,
    }
  ),
}));
