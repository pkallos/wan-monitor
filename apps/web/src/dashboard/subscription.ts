import { Clock, Duration, Effect, Option, Stream } from "effect";
import { AsyncData, Dom } from "foldkit";
import { chartEvents } from "@/dashboard/charts/chartHost";
import type { Message } from "@/dashboard/message";
import {
  BrushedChartRange,
  ChangedSystemTheme,
  Interacted,
  TickedClock,
  TickedRefresh,
  WentIdle,
} from "@/dashboard/message";
import type { Model } from "@/dashboard/model";
import { DARK_SCHEME_QUERY } from "@/dashboard/theme";

const REFRESH_INTERVAL = Duration.seconds(30);
const IDLE_TIMEOUT = Duration.minutes(2);
const MINUTE_MS = 60_000;
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

const activityStream: Stream.Stream<Message> = Stream.mergeAll(
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
// the dashboard mounts, not just after the first real event; otherwise a
// user who never touches anything would never go idle.
const idleAfterQuiet: Stream.Stream<Message> = Stream.concat(
  Stream.succeed(Interacted()),
  activityStream
).pipe(
  Stream.debounce(IDLE_TIMEOUT),
  Stream.map(() => WentIdle())
);

const firstActivity: Stream.Stream<Message> = activityStream.pipe(
  Stream.take(1)
);

// Foldkit restarts this stream when `isIdle` flips, so one set of listeners is attached at a time.
export const activityStreamFor = ({
  isIdle,
}: {
  readonly isIdle: boolean;
}): Stream.Stream<Message> => (isIdle ? firstActivity : idleAfterQuiet);

export type ClockResolution = "second" | "minute";

// `formatDurationAgo` counts seconds only below a minute, so seconds are needed
// only while a time on screen is that young. `Stream.tick` fires at once on
// restart, so minute ticks stay aligned to the youngest time.
export const clockModelToDependencies = (
  model: Model
): { readonly resolution: ClockResolution } => {
  const originsMs = [
    ...Option.toArray(model.maybeLastUpdatedMs),
    ...Option.toArray(
      Option.flatMap(
        AsyncData.getData(model.liveConnectivity),
        ({ maybeLastSampleAtMs }) => maybeLastSampleAtMs
      )
    ),
  ];
  return {
    resolution: originsMs.some((originMs) => model.nowMs - originMs < MINUTE_MS)
      ? "second"
      : "minute",
  };
};

export const clockDependenciesToStream = ({
  resolution,
}: {
  readonly resolution: ClockResolution;
}): Stream.Stream<Message> =>
  Stream.tick(
    resolution === "second" ? Duration.seconds(1) : Duration.minutes(1)
  ).pipe(
    Stream.mapEffect(() => Clock.currentTimeMillis),
    Stream.map((nowMs) => TickedClock({ nowMs }))
  );

/** A drag across the latency chart, as the range of time it covers. */
export const chartBrushStream: Stream.Stream<Message> = Dom.streamFromEvent({
  target: chartEvents,
  type: "brush",
  mapEvent: ({ detail }) =>
    BrushedChartRange({ startMs: detail.startMs, endMs: detail.endMs }),
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
