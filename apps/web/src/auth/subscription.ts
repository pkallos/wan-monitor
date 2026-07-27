import { Effect, Schema as S, Stream } from "effect";
import { Subscription } from "foldkit";
import type { Message } from "@/auth/message";
import { GotDashboardMessage } from "@/auth/message";
import type { Model } from "@/auth/model";
import * as Dashboard from "@/dashboard";

export const modelToDependencies = (
  model: Model
): {
  readonly isPaused: boolean;
  readonly isIdle: boolean;
  readonly isLoggedIn: boolean;
} =>
  model._tag === "LoggedIn"
    ? {
        isPaused: model.dashboard.isPaused,
        isIdle: model.dashboard.isIdle,
        isLoggedIn: true,
      }
    : { isPaused: true, isIdle: false, isLoggedIn: false };

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

export const activityModelToDependencies = (
  model: Model
): { readonly isLoggedIn: boolean } => ({
  isLoggedIn: model._tag === "LoggedIn",
});

export const activityDependenciesToStream = ({
  isLoggedIn,
}: {
  readonly isLoggedIn: boolean;
}): Stream.Stream<Message> =>
  Stream.when(
    Dashboard.activityAndIdleStream.pipe(
      Stream.map((message) => GotDashboardMessage({ message }))
    ),
    Effect.sync(() => isLoggedIn)
  );

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  dashboardRefresh: entry(
    { isPaused: S.Boolean, isIdle: S.Boolean, isLoggedIn: S.Boolean },
    { modelToDependencies, dependenciesToStream }
  ),
  dashboardActivity: entry(
    { isLoggedIn: S.Boolean },
    {
      modelToDependencies: activityModelToDependencies,
      dependenciesToStream: activityDependenciesToStream,
    }
  ),
}));
