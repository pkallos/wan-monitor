import { it } from "@effect/vitest";
import { type Duration, Effect, Fiber, Option, Stream } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, describe, expect, test, vi } from "vitest";
import { chartEvents } from "@/dashboard/charts/chartHost";
import { Interacted, TickedClock, WentIdle } from "@/dashboard/message";
import {
  LiveConnectivityAsyncData,
  type Model,
  initModel as realInitModel,
} from "@/dashboard/model";
import {
  activityStreamFor,
  chartBrushStream,
  clockDependenciesToStream,
  clockModelToDependencies,
  dependenciesToStream,
  modelToDependencies,
  systemThemeDependenciesToStream,
} from "@/dashboard/subscription";
import { defaultSettings } from "@/storage";

const NOW_MS = Date.parse("2026-07-28T12:00:00.000Z");

const initModel = (settings: Parameters<typeof realInitModel>[0]) =>
  realInitModel(settings, NOW_MS);

describe("modelToDependencies", () => {
  test("derives isPaused and isIdle from the Model", () => {
    expect(modelToDependencies(initModel(defaultSettings()))).toEqual({
      isPaused: false,
      isIdle: false,
    });
    expect(
      modelToDependencies({
        ...initModel(defaultSettings()),
        isPaused: true,
        isIdle: true,
      })
    ).toEqual({ isPaused: true, isIdle: true });
  });
});

describe("dependenciesToStream", () => {
  test("is empty while paused, so no refresh tick can ever fire", async () => {
    const events = await Stream.runCollect(
      dependenciesToStream({ isPaused: true, isIdle: false })
    ).pipe(Effect.runPromise);

    expect(Array.from(events)).toEqual([]);
  });

  test("is empty while idle, even if not manually paused", async () => {
    const events = await Stream.runCollect(
      dependenciesToStream({ isPaused: false, isIdle: true })
    ).pipe(Effect.runPromise);

    expect(Array.from(events)).toEqual([]);
  });
});

describe("systemThemeDependenciesToStream", () => {
  afterEach(() => vi.unstubAllGlobals());

  const stubMediaQuery = () => {
    const mediaQuery = Object.assign(new EventTarget(), { matches: false });
    const matchMedia = vi.fn(() => mediaQuery);
    vi.stubGlobal("matchMedia", matchMedia);
    return { mediaQuery, matchMedia };
  };

  test("is empty, and never touches matchMedia, for an explicit theme", async () => {
    const { matchMedia } = stubMediaQuery();

    const events = await Stream.runCollect(
      systemThemeDependenciesToStream({ isSystemTheme: false })
    ).pipe(Effect.runPromise);

    expect(Array.from(events)).toEqual([]);
    expect(matchMedia).not.toHaveBeenCalled();
  });

  test("removes its change listener once the stream ends, so a switch away from system leaks nothing", async () => {
    const { mediaQuery } = stubMediaQuery();
    const addListener = vi.spyOn(mediaQuery, "addEventListener");
    const removeListener = vi.spyOn(mediaQuery, "removeEventListener");

    await Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        Stream.runCollect(
          systemThemeDependenciesToStream({ isSystemTheme: true }).pipe(
            Stream.take(2)
          )
        )
      );
      yield* Effect.sleep("10 millis");
      expect(removeListener).not.toHaveBeenCalled();
      mediaQuery.dispatchEvent(new Event("change"));
      yield* Fiber.join(fiber);
    }).pipe(Effect.runPromise);

    expect(addListener).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(removeListener.mock.calls[0]?.[0]).toBe("change");
    expect(removeListener.mock.calls[0]?.[1]).toBe(
      addListener.mock.calls[0]?.[1]
    );
  });

  test("emits ChangedSystemTheme as soon as it starts, so a switch back to system repaints without waiting for the next OS change", async () => {
    stubMediaQuery();

    const events = await Stream.runCollect(
      systemThemeDependenciesToStream({ isSystemTheme: true }).pipe(
        Stream.take(1)
      )
    ).pipe(Effect.runPromise);

    expect(Array.from(events)).toEqual([{ _tag: "ChangedSystemTheme" }]);
  });

  test("emits ChangedSystemTheme each time the OS preference flips", async () => {
    const { mediaQuery, matchMedia } = stubMediaQuery();

    const events = await Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        Stream.runCollect(
          systemThemeDependenciesToStream({ isSystemTheme: true }).pipe(
            Stream.take(3)
          )
        )
      );
      yield* Effect.sleep("10 millis");
      mediaQuery.dispatchEvent(new Event("change"));
      mediaQuery.dispatchEvent(new Event("change"));
      return yield* Fiber.join(fiber);
    }).pipe(Effect.runPromise);

    expect(Array.from(events)).toEqual([
      { _tag: "ChangedSystemTheme" },
      { _tag: "ChangedSystemTheme" },
      { _tag: "ChangedSystemTheme" },
    ]);
    expect(matchMedia).toHaveBeenCalledWith("(prefers-color-scheme: dark)");
  });
});

describe("chartBrushStream", () => {
  test("turns each stroke reported by a chart into the range it covers", async () => {
    const events = await Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        Stream.runCollect(chartBrushStream.pipe(Stream.take(2)))
      );
      yield* Effect.sleep("10 millis");
      chartEvents.dispatchEvent(
        new CustomEvent("brush", { detail: { startMs: 1000, endMs: 5000 } })
      );
      chartEvents.dispatchEvent(
        new CustomEvent("brush", { detail: { startMs: 7000, endMs: 9000 } })
      );
      return yield* Fiber.join(fiber);
    }).pipe(Effect.runPromise);

    expect(Array.from(events)).toEqual([
      { _tag: "BrushedChartRange", startMs: 1000, endMs: 5000 },
      { _tag: "BrushedChartRange", startMs: 7000, endMs: 9000 },
    ]);
  });
});

describe("activityStreamFor", () => {
  const ACTIVITY_TYPES = [
    "mousemove",
    "keydown",
    "scroll",
    "touchstart",
    "click",
  ];

  afterEach(() => vi.restoreAllMocks());

  const spyOnListeners = () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const countOf = (spy: typeof add | typeof remove, type: string) =>
      spy.mock.calls.filter(([calledType]) => calledType === type).length;
    const untilAttached = Effect.yieldNow.pipe(
      Effect.repeat({
        until: () => ACTIVITY_TYPES.every((type) => countOf(add, type) > 0),
      })
    );
    return { add, remove, countOf, untilAttached };
  };

  // The yield lets the stream take the event in before the clock moves.
  const dispatch = (type: string) =>
    Effect.sync(() => window.dispatchEvent(new Event(type))).pipe(
      Effect.andThen(Effect.yieldNow)
    );

  it.effect.each([false, true])(
    "attaches one window listener per activity type when isIdle is %s",
    (isIdle) =>
      Effect.gen(function* () {
        const { add, countOf, untilAttached } = spyOnListeners();
        const fiber = yield* Effect.forkChild(
          Stream.runDrain(activityStreamFor({ isIdle }))
        );
        yield* untilAttached;
        yield* Fiber.interrupt(fiber);

        for (const type of ACTIVITY_TYPES) {
          expect(countOf(add, type)).toBe(1);
        }
      })
  );

  it.effect(
    "sends nothing for activity while active, then WentIdle after two quiet minutes",
    () =>
      Effect.gen(function* () {
        const { untilAttached } = spyOnListeners();
        const fiber = yield* Effect.forkChild(
          Stream.runCollect(
            activityStreamFor({ isIdle: false }).pipe(Stream.take(1))
          )
        );
        yield* untilAttached;
        yield* dispatch("mousemove");
        yield* TestClock.adjust("119 seconds");
        expect(fiber.pollUnsafe()).toBeUndefined();
        yield* TestClock.adjust("1 second");

        expect(Array.from(yield* Fiber.join(fiber))).toEqual([WentIdle()]);
      })
  );

  it.effect("restarts the idle countdown on each sign of activity", () =>
    Effect.gen(function* () {
      const { untilAttached } = spyOnListeners();
      const fiber = yield* Effect.forkChild(
        Stream.runCollect(
          activityStreamFor({ isIdle: false }).pipe(Stream.take(1))
        )
      );
      yield* untilAttached;
      yield* TestClock.adjust("90 seconds");
      yield* dispatch("keydown");
      yield* TestClock.adjust("90 seconds");
      expect(fiber.pollUnsafe()).toBeUndefined();
      yield* TestClock.adjust("30 seconds");

      expect(Array.from(yield* Fiber.join(fiber))).toEqual([WentIdle()]);
    })
  );

  it.effect("counts down from the moment it starts, before any activity", () =>
    Effect.gen(function* () {
      const { untilAttached } = spyOnListeners();
      const fiber = yield* Effect.forkChild(
        Stream.runCollect(
          activityStreamFor({ isIdle: false }).pipe(Stream.take(1))
        )
      );
      yield* untilAttached;
      yield* TestClock.adjust("2 minutes");

      expect(Array.from(yield* Fiber.join(fiber))).toEqual([WentIdle()]);
    })
  );

  it.effect(
    "sends one Interacted for the first activity while idle, then detaches",
    () =>
      Effect.gen(function* () {
        const { remove, countOf, untilAttached } = spyOnListeners();
        const fiber = yield* Effect.forkChild(
          Stream.runCollect(activityStreamFor({ isIdle: true }))
        );
        yield* untilAttached;
        yield* dispatch("mousemove");
        yield* dispatch("keydown");

        expect(Array.from(yield* Fiber.join(fiber))).toEqual([Interacted()]);
        for (const type of ACTIVITY_TYPES) {
          expect(countOf(remove, type)).toBe(1);
        }
      })
  );
});

describe("clockModelToDependencies", () => {
  const MINUTE_MS = 60_000;
  const at = (overrides: Partial<Model>): Model => ({
    ...initModel(defaultSettings()),
    ...overrides,
  });
  const sample = (sampleAtMs: number) =>
    LiveConnectivityAsyncData.Success({
      data: { status: "up", maybeLastSampleAtMs: Option.some(sampleAtMs) },
    });

  test("counts seconds while the last update is under a minute old", () => {
    expect(
      clockModelToDependencies(
        at({ maybeLastUpdatedMs: Option.some(NOW_MS - 59_000) })
      )
    ).toEqual({ resolution: "second" });
  });

  test("counts seconds while the last sample is under a minute old, however old the last update", () => {
    expect(
      clockModelToDependencies(
        at({
          maybeLastUpdatedMs: Option.some(NOW_MS - 10 * MINUTE_MS),
          liveConnectivity: sample(NOW_MS - 5_000),
        })
      )
    ).toEqual({ resolution: "second" });
  });

  test("counts minutes once every time on screen has passed a minute, which is when its text stops showing seconds", () => {
    expect(
      clockModelToDependencies(
        at({
          maybeLastUpdatedMs: Option.some(NOW_MS - MINUTE_MS),
          liveConnectivity: sample(NOW_MS - 2 * MINUTE_MS),
        })
      )
    ).toEqual({ resolution: "minute" });
  });

  test("counts minutes when nothing on screen says how long ago it was", () => {
    expect(clockModelToDependencies(at({}))).toEqual({ resolution: "minute" });
  });
});

describe("clockDependenciesToStream", () => {
  const START_MS = Date.parse("2026-07-28T12:00:00.000Z");

  const collectTicks = (
    resolution: "second" | "minute",
    steps: ReadonlyArray<Duration.Input>
  ) =>
    Effect.gen(function* () {
      yield* TestClock.setTime(START_MS);
      const fiber = yield* Effect.forkChild(
        Stream.runCollect(
          clockDependenciesToStream({ resolution }).pipe(
            Stream.take(steps.length + 1)
          )
        )
      );
      yield* Effect.yieldNow;
      for (const step of steps) {
        yield* TestClock.adjust(step);
      }
      return Array.from(yield* Fiber.join(fiber));
    });

  it.effect("reports the time at once and then every second", () =>
    Effect.gen(function* () {
      expect(yield* collectTicks("second", ["1 second", "1 second"])).toEqual([
        TickedClock({ nowMs: START_MS }),
        TickedClock({ nowMs: START_MS + 1000 }),
        TickedClock({ nowMs: START_MS + 2000 }),
      ]);
    })
  );

  it.effect("reports the time at once and then every minute", () =>
    Effect.gen(function* () {
      expect(yield* collectTicks("minute", ["1 minute"])).toEqual([
        TickedClock({ nowMs: START_MS }),
        TickedClock({ nowMs: START_MS + 60_000 }),
      ]);
    })
  );

  it.effect("does not report again before a minute is up", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(START_MS);
      const fiber = yield* Effect.forkChild(
        Stream.runCollect(
          clockDependenciesToStream({ resolution: "minute" }).pipe(
            Stream.take(2)
          )
        )
      );
      yield* Effect.yieldNow;
      yield* TestClock.adjust("59 seconds");

      expect(fiber.pollUnsafe()).toBeUndefined();
    })
  );
});
