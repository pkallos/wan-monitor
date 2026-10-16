import { describe, expect, it } from "@effect/vitest";
import { InvalidTimeRange } from "@shared/api/errors";
import { Cause, Effect, Exit, Option } from "effect";
import {
  coverageGranularity,
  previousWindow,
  resolveWindow,
  validatePreviousWindow,
  validateWindow,
} from "@/core/analytics/window";

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

describe("previousWindow", () => {
  it("returns the window of equal length that ends just before the range begins", () => {
    const startMs = Date.parse("2026-07-26T10:00:00.000Z");
    const endMs = Date.parse("2026-07-26T12:00:00.000Z");

    expect(previousWindow(startMs, endMs)).toEqual({
      startMs: Date.parse("2026-07-26T07:59:59.999Z"),
      endMs: Date.parse("2026-07-26T09:59:59.999Z"),
    });
  });

  it("shares no instant with the range, so a boundary cycle is counted once", () => {
    const startMs = Date.parse("2026-07-26T10:00:00.000Z");
    const endMs = Date.parse("2026-07-26T12:00:00.000Z");

    expect(previousWindow(startMs, endMs).endMs).toBe(startMs - 1);
  });

  it("keeps the previous window's length equal to the range's", () => {
    const startMs = Date.parse("2026-07-26T10:07:13.000Z");
    const endMs = Date.parse("2026-07-29T01:00:00.000Z");
    const previous = previousWindow(startMs, endMs);

    expect(previous.endMs - previous.startMs).toBe(endMs - startMs);
  });

  it("collapses to an empty window for an empty range", () => {
    const at = Date.parse("2026-07-26T10:00:00.000Z");

    expect(previousWindow(at, at)).toEqual({
      startMs: at - 1,
      endMs: at - 1,
    });
  });
});

describe("previousWindow before the epoch", () => {
  it("starts before the epoch when the range is at least as long as its distance from it", () => {
    expect(previousWindow(DAY, 2 * DAY).startMs).toBe(-1);
  });

  it("starts exactly at the epoch for the earliest range that fits", () => {
    expect(previousWindow(DAY + 1, 2 * DAY + 1).startMs).toBe(0);
  });
});

describe("validatePreviousWindow", () => {
  const errorOf = (effect: Effect.Effect<unknown, InvalidTimeRange>) =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(effect);
      expect(Exit.isFailure(exit)).toBe(true);
      return Exit.isFailure(exit)
        ? Cause.findErrorOption(exit.cause)
        : Option.none();
    });

  it.effect("passes a window whose previous window starts at the epoch", () =>
    Effect.gen(function* () {
      const earliest = { startMs: DAY + 1, endMs: 2 * DAY + 1 };

      expect(yield* validatePreviousWindow(earliest)).toEqual(earliest);
    })
  );

  it.effect(
    "rejects a window whose previous window starts before the epoch",
    () =>
      Effect.gen(function* () {
        const error = yield* errorOf(
          validatePreviousWindow({ startMs: DAY, endMs: 2 * DAY })
        );

        expect(Option.isSome(error)).toBe(true);
        if (Option.isSome(error)) {
          expect(error.value).toBeInstanceOf(InvalidTimeRange);
          expect(error.value.message).toContain("1970");
        }
      })
  );
});

describe("coverageGranularity", () => {
  const hourMs = 3_600_000;

  it("uses 5m buckets for windows up to two days", () => {
    expect(coverageGranularity(hourMs)).toBe("5m");
    expect(coverageGranularity(48 * hourMs)).toBe("5m");
  });

  it("falls back to 1h buckets for longer windows so row counts stay bounded", () => {
    expect(coverageGranularity(48 * hourMs + 1)).toBe("1h");
    expect(coverageGranularity(30 * 24 * hourMs)).toBe("1h");
  });
});
