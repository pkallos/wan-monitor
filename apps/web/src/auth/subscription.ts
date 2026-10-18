import { Effect, Match as M, Schema as S, Stream } from "effect";
import { Subscription } from "foldkit";
import type { Message } from "@/auth/message";
import { GotDashboardMessage } from "@/auth/message";
import { currentSettings, type Model } from "@/auth/model";
import * as Dashboard from "@/dashboard";

export const modelToDependencies = (
  model: Model
): {
  readonly isPaused: boolean;
  readonly isIdle: boolean;
  readonly isLoggedIn: boolean;
} =>
  M.value(model).pipe(
    M.tag("LoggedIn", ({ dashboard }) => ({
      isPaused: dashboard.isPaused,
      isIdle: dashboard.isIdle,
      isLoggedIn: true,
    })),
    M.orElse(() => ({ isPaused: true, isIdle: false, isLoggedIn: false }))
  );

export const dependenciesToStream = ({
  isPaused,
  isIdle,
  isLoggedIn,
}: {
  readonly isPaused: boolean;
  readonly isIdle: boolean;
  readonly isLoggedIn: boolean;
}): Stream.Stream<Message> =>
  Stream.when(
    Dashboard.dependenciesToStream({ isPaused, isIdle }).pipe(
      Stream.map((message) => GotDashboardMessage({ message }))
    ),
    Effect.sync(() => isLoggedIn)
  );

export const loggedInModelToDependencies = (
  model: Model
): { readonly isLoggedIn: boolean } => ({
  isLoggedIn: M.value(model).pipe(
    M.tag("LoggedIn", () => true),
    M.orElse(() => false)
  ),
});

export const activityModelToDependencies = (
  model: Model
): { readonly isLoggedIn: boolean; readonly isIdle: boolean } => ({
  ...loggedInModelToDependencies(model),
  isIdle: M.value(model).pipe(
    M.tag("LoggedIn", ({ dashboard }) => dashboard.isIdle),
    M.orElse(() => false)
  ),
});

export const activityDependenciesToStream = ({
  isLoggedIn,
  isIdle,
}: {
  readonly isLoggedIn: boolean;
  readonly isIdle: boolean;
}): Stream.Stream<Message> =>
  Stream.when(
    Dashboard.activityStreamFor({ isIdle }).pipe(
      Stream.map((message) => GotDashboardMessage({ message }))
    ),
    Effect.sync(() => isLoggedIn)
  );

type ClockDependencies = {
  readonly isLoggedIn: boolean;
  readonly resolution: Dashboard.ClockResolution;
};

export const clockModelToDependencies = (model: Model): ClockDependencies =>
  M.value(model).pipe(
    M.withReturnType<ClockDependencies>(),
    M.tag("LoggedIn", ({ dashboard }) => ({
      isLoggedIn: true,
      ...Dashboard.clockModelToDependencies(dashboard),
    })),
    M.orElse(() => ({ isLoggedIn: false, resolution: "minute" }))
  );

// Not gated on `isPaused` or `isIdle`: a dashboard that has stopped refreshing
// still shows how long ago it last did.
export const clockDependenciesToStream = ({
  isLoggedIn,
  resolution,
}: ClockDependencies): Stream.Stream<Message> =>
  Stream.when(
    Dashboard.clockDependenciesToStream({ resolution }).pipe(
      Stream.map((message) => GotDashboardMessage({ message }))
    ),
    Effect.sync(() => isLoggedIn)
  );

export const chartBrushDependenciesToStream = ({
  isLoggedIn,
}: {
  readonly isLoggedIn: boolean;
}): Stream.Stream<Message> =>
  Stream.when(
    Dashboard.chartBrushStream.pipe(
      Stream.map((message) => GotDashboardMessage({ message }))
    ),
    Effect.sync(() => isLoggedIn)
  );

export const systemThemeModelToDependencies = (
  model: Model
): { readonly isSystemTheme: boolean } => ({
  isSystemTheme: currentSettings(model).theme === "system",
});

export const systemThemeDependenciesToStream = ({
  isSystemTheme,
}: {
  readonly isSystemTheme: boolean;
}): Stream.Stream<Message> =>
  Dashboard.systemThemeDependenciesToStream({ isSystemTheme }).pipe(
    Stream.map((message) => GotDashboardMessage({ message }))
  );

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  dashboardRefresh: entry(
    { isPaused: S.Boolean, isIdle: S.Boolean, isLoggedIn: S.Boolean },
    { modelToDependencies, dependenciesToStream }
  ),
  dashboardSystemTheme: entry(
    { isSystemTheme: S.Boolean },
    {
      modelToDependencies: systemThemeModelToDependencies,
      dependenciesToStream: systemThemeDependenciesToStream,
    }
  ),
  dashboardActivity: entry(
    { isLoggedIn: S.Boolean, isIdle: S.Boolean },
    {
      modelToDependencies: activityModelToDependencies,
      dependenciesToStream: activityDependenciesToStream,
    }
  ),
  dashboardClock: entry(
    { isLoggedIn: S.Boolean, resolution: S.Literals(["second", "minute"]) },
    {
      modelToDependencies: clockModelToDependencies,
      dependenciesToStream: clockDependenciesToStream,
    }
  ),
  dashboardChartBrush: entry(
    { isLoggedIn: S.Boolean },
    {
      modelToDependencies: loggedInModelToDependencies,
      dependenciesToStream: chartBrushDependenciesToStream,
    }
  ),
}));
