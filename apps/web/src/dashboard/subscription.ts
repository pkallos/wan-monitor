import { Duration, Effect, Schema as S, Stream } from "effect";
import { Subscription } from "foldkit";
import type { Message } from "@/dashboard/message";
import { TickedRefresh } from "@/dashboard/message";
import type { Model } from "@/dashboard/model";

const REFRESH_INTERVAL = Duration.seconds(30);

export const modelToDependencies = (model: Model) => ({
  isPaused: model.isPaused,
});

export const dependenciesToStream = ({
  isPaused,
}: {
  isPaused: boolean;
}): Stream.Stream<Message> =>
  Stream.when(
    // Stream.tick emits immediately; drop that first emission so
    // arriving on the dashboard doesn't instantly refetch data that
    // EnteredDashboard just loaded.
    Stream.tick(REFRESH_INTERVAL).pipe(
      Stream.drop(1),
      Stream.map(() => TickedRefresh())
    ),
    Effect.sync(() => !isPaused)
  );

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  refresh: entry(
    { isPaused: S.Boolean },
    { modelToDependencies, dependenciesToStream }
  ),
}));
