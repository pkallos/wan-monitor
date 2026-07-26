import { Effect, Schema as S, Stream } from "effect";
import { Subscription } from "foldkit";
import type { Message } from "@/auth/message";
import { GotDashboardMessage } from "@/auth/message";
import type { Model } from "@/auth/model";
import * as Dashboard from "@/dashboard";

export const modelToDependencies = (
  model: Model
): { readonly isPaused: boolean; readonly isLoggedIn: boolean } =>
  model._tag === "LoggedIn"
    ? { isPaused: model.dashboard.isPaused, isLoggedIn: true }
    : { isPaused: true, isLoggedIn: false };

export const dependenciesToStream = ({
  isPaused,
  isLoggedIn,
}: {
  readonly isPaused: boolean;
  readonly isLoggedIn: boolean;
}): Stream.Stream<Message> =>
  Stream.when(
    Dashboard.dependenciesToStream({ isPaused }).pipe(
      Stream.map((message) => GotDashboardMessage({ message }))
    ),
    Effect.sync(() => isLoggedIn)
  );

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  dashboardRefresh: entry(
    { isPaused: S.Boolean, isLoggedIn: S.Boolean },
    { modelToDependencies, dependenciesToStream }
  ),
}));
