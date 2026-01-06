import { FetchHttpClient } from "@effect/platform";
import { Effect } from "effect";
import { WanMonitorClient } from "@/api/effect-client";

export const runEffect = <A, E>(
  effect: Effect.Effect<A, E, WanMonitorClient>
) => {
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(WanMonitorClient.Default),
      Effect.provide(FetchHttpClient.layer)
    )
  );
};

export const runEffectWithError = async <A, E>(
  effect: Effect.Effect<A, E, WanMonitorClient>
): Promise<A> => {
  const result = await Effect.runPromise(
    effect.pipe(
      Effect.either,
      Effect.provide(WanMonitorClient.Default),
      Effect.provide(FetchHttpClient.layer)
    )
  );

  if (result._tag === "Left") {
    throw result.left;
  }

  return result.right;
};
