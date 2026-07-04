import { Effect, Either, ManagedRuntime } from "effect";
import { WanMonitorClient } from "@/api/effect-client";
import { toApiError } from "@/api/errors";

const runtime = ManagedRuntime.make(WanMonitorClient.Default);

export const runEffect = <A, E>(
  effect: Effect.Effect<A, E, WanMonitorClient>
) => runtime.runPromise(effect);

export const runEffectWithError = async <A, E>(
  effect: Effect.Effect<A, E, WanMonitorClient>
): Promise<A> => {
  const result = await runtime.runPromise(effect.pipe(Effect.either));

  if (Either.isLeft(result)) {
    throw toApiError(result.left);
  }

  return result.right;
};
