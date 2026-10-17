import { InvalidTimeRange } from "@shared/api/errors";
import { Cause, Effect, Exit, Option } from "effect";
import { expect } from "vitest";

/** Runs `effect`, expects it to fail with `InvalidTimeRange`, and returns that error. */
export const invalidTimeRangeOf = <R>(
  effect: Effect.Effect<unknown, unknown, R>
) =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(effect);
    expect(Exit.isFailure(exit)).toBe(true);
    const error = Exit.isFailure(exit)
      ? Cause.findErrorOption(exit.cause)
      : Option.none();
    if (Option.isNone(error) || !(error.value instanceof InvalidTimeRange)) {
      return yield* Effect.die("expected an InvalidTimeRange failure");
    }
    return error.value;
  });
