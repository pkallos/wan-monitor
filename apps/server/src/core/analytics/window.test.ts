import { describe, expect, it } from "@effect/vitest";
import { InvalidTimeRange } from "@shared/api/errors";
import { Cause, Effect, Exit, Option } from "effect";
import { resolveWindow, validateWindow } from "@/core/analytics/window";

const NOW = Date.parse("2024-06-01T12:00:00Z");
const DAY = 86_400_000;

describe("resolveWindow", () => {
  it("trails now by the default span when neither bound is given", () => {
    expect(resolveWindow({}, NOW, DAY)).toEqual({
      startMs: NOW - DAY,
      endMs: NOW,
    });
  });

  it("uses both bounds when both are given", () => {
    expect(
      resolveWindow(
        {
          startTime: "2024-05-01T00:00:00Z",
          endTime: "2024-05-02T00:00:00Z",
        },
        NOW,
        DAY
      )
    ).toEqual({
      startMs: Date.parse("2024-05-01T00:00:00Z"),
      endMs: Date.parse("2024-05-02T00:00:00Z"),
    });
  });

  it("trails a given end, not now, when only the end is given", () => {
    const endMs = Date.parse("2024-05-02T00:00:00Z");

    expect(
      resolveWindow({ endTime: "2024-05-02T00:00:00Z" }, NOW, DAY)
    ).toEqual({ startMs: endMs - DAY, endMs });
  });

  it("ends at now when only the start is given", () => {
    expect(
      resolveWindow({ startTime: "2024-05-01T00:00:00Z" }, NOW, DAY)
    ).toEqual({
      startMs: Date.parse("2024-05-01T00:00:00Z"),
      endMs: NOW,
    });
  });
});

describe("validateWindow", () => {
  const window = { startMs: NOW - DAY, endMs: NOW };

  const errorOf = (effect: Effect.Effect<unknown, InvalidTimeRange>) =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(effect);
      expect(Exit.isFailure(exit)).toBe(true);
      return Exit.isFailure(exit)
        ? Cause.findErrorOption(exit.cause)
        : Option.none();
    });

  it.effect("passes a well-ordered window through", () =>
    Effect.gen(function* () {
      expect(yield* validateWindow(window)).toEqual(window);
    })
  );

  it.effect("accepts an empty window", () =>
    Effect.gen(function* () {
      const empty = { startMs: NOW, endMs: NOW };

      expect(yield* validateWindow(empty)).toEqual(empty);
    })
  );

  it.effect("rejects a start after the end", () =>
    Effect.gen(function* () {
      const error = yield* errorOf(
        validateWindow({ startMs: NOW, endMs: NOW - DAY })
      );

      expect(Option.isSome(error)).toBe(true);
      if (Option.isSome(error)) {
        expect(error.value).toBeInstanceOf(InvalidTimeRange);
        expect(error.value.message).toContain("startTime");
      }
    })
  );

  it.effect("accepts a span of exactly the cap", () =>
    Effect.gen(function* () {
      const capped = { startMs: NOW - 90 * DAY, endMs: NOW };

      expect(yield* validateWindow(capped, 90)).toEqual(capped);
    })
  );

  it.effect("rejects a span over the cap and names the cap", () =>
    Effect.gen(function* () {
      const error = yield* errorOf(
        validateWindow({ startMs: NOW - 90 * DAY - 1, endMs: NOW }, 90)
      );

      expect(Option.isSome(error)).toBe(true);
      if (Option.isSome(error)) {
        expect(error.value).toBeInstanceOf(InvalidTimeRange);
        expect(error.value.message).toContain("90 days");
      }
    })
  );

  it.effect("applies no span cap when none is given", () =>
    Effect.gen(function* () {
      const long = { startMs: NOW - 1000 * DAY, endMs: NOW };

      expect(yield* validateWindow(long)).toEqual(long);
    })
  );
});
