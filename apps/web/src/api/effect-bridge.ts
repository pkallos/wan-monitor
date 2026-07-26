import { Effect, ManagedRuntime, Result } from "effect";
import { WanMonitorClient } from "@/api/effect-client";
import { toApiError } from "@/api/errors";

const runtime = ManagedRuntime.make(WanMonitorClient.layer);

export const runEffect = <A, E>(
  effect: Effect.Effect<A, E, WanMonitorClient>
) => runtime.runPromise(effect);

export const runEffectWithError = async <A, E>(
  effect: Effect.Effect<A, E, WanMonitorClient>
): Promise<A> => {
  const result = await runtime.runPromise(effect.pipe(Effect.result));

  if (Result.isFailure(result)) {
    throw toApiError(result.failure);
  }

  return result.success;
};
