import { it } from "@effect/vitest";
import { Effect, Fiber, Option, Stream } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, describe, expect, test, vi } from "vitest";
import { GotDashboardMessage } from "@/auth/message";
import { Checking, initLoggedOut, LoggedIn } from "@/auth/model";
import {
  activityDependenciesToStream,
  activityModelToDependencies,
  chartBrushDependenciesToStream,
  clockDependenciesToStream,
  clockModelToDependencies,
  dependenciesToStream,
  loggedInModelToDependencies,
  modelToDependencies,
  systemThemeDependenciesToStream,
  systemThemeModelToDependencies,
} from "@/auth/subscription";
import {
  ChangedSystemTheme,
  Interacted,
  initModel as realInitDashboardModel,
  TickedClock,
} from "@/dashboard";
import { chartEvents } from "@/dashboard/charts/chartHost";
import { defaultSettings } from "@/storage";

const NOW_MS = Date.parse("2026-07-28T12:00:00.000Z");

const initDashboardModel = (
  settings: Parameters<typeof realInitDashboardModel>[0]
) => realInitDashboardModel(settings, NOW_MS);

describe("modelToDependencies", () => {
  test("is never logged in while Checking or LoggedOut", () => {
    expect(
      modelToDependencies(
        Checking({ maybeToken: Option.none(), settings: defaultSettings() })
      )
    ).toEqual({ isPaused: true, isIdle: false, isLoggedIn: false });
    expect(modelToDependencies(initLoggedOut(defaultSettings()))).toEqual({
      isPaused: true,
      isIdle: false,
      isLoggedIn: false,
    });
  });

  test("derives isPaused and isIdle from the embedded dashboard once LoggedIn", () => {
    expect(
      modelToDependencies(
        LoggedIn({
          maybeSession: Option.none(),
          dashboard: {
            ...initDashboardModel(defaultSettings()),
            isPaused: true,
            isIdle: true,
          },
        })
      )
    ).toEqual({ isPaused: true, isIdle: true, isLoggedIn: true });
  });
});

describe("dependenciesToStream", () => {
  test("is empty while not logged in, even if the embedded dashboard is unpaused", async () => {
    const events = await Stream.runCollect(
      dependenciesToStream({
        isPaused: false,
        isIdle: false,
        isLoggedIn: false,
      })
    ).pipe(Effect.runPromise);

    expect(Array.from(events)).toEqual([]);
  });

  test("is empty while logged in but paused", async () => {
    const events = await Stream.runCollect(
      dependenciesToStream({ isPaused: true, isIdle: false, isLoggedIn: true })
    ).pipe(Effect.runPromise);

    expect(Array.from(events)).toEqual([]);
  });
});

describe("systemThemeModelToDependencies", () => {
  const withTheme = (theme: "system" | "dark") => ({
    ...defaultSettings(),
    theme,
  });

  test("tracks the OS theme in every auth state whose theme is system", () => {
    const states = [
      Checking({ maybeToken: Option.none(), settings: withTheme("system") }),
      initLoggedOut(withTheme("system")),
      LoggedIn({
        maybeSession: Option.none(),
        dashboard: {
          ...initDashboardModel(defaultSettings()),
          theme: "system",
        },
      }),
    ];

    for (const state of states) {
      expect(systemThemeModelToDependencies(state)).toEqual({
        isSystemTheme: true,
      });
    }
  });

  test("ignores the OS theme in every auth state with an explicit theme", () => {
    const states = [
      Checking({ maybeToken: Option.none(), settings: withTheme("dark") }),
      initLoggedOut(withTheme("dark")),
      LoggedIn({
        maybeSession: Option.none(),
        dashboard: { ...initDashboardModel(defaultSettings()), theme: "dark" },
      }),
    ];

    for (const state of states) {
      expect(systemThemeModelToDependencies(state)).toEqual({
        isSystemTheme: false,
      });
    }
  });
});

describe("systemThemeDependenciesToStream", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("is empty, and never touches matchMedia, for an explicit theme", async () => {
    const matchMedia = vi.fn();
    vi.stubGlobal("matchMedia", matchMedia);

    const events = await Stream.runCollect(
      systemThemeDependenciesToStream({ isSystemTheme: false })
    ).pipe(Effect.runPromise);

    expect(Array.from(events)).toEqual([]);
    expect(matchMedia).not.toHaveBeenCalled();
  });

  test("wraps the OS theme change for the dashboard", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => Object.assign(new EventTarget(), { matches: true }))
    );

    const events = await Stream.runCollect(
      systemThemeDependenciesToStream({ isSystemTheme: true }).pipe(
        Stream.take(1)
      )
    ).pipe(Effect.runPromise);

    expect(Array.from(events)).toEqual([
      GotDashboardMessage({ message: ChangedSystemTheme() }),
    ]);
  });
});

describe("chartBrushDependenciesToStream", () => {
  test("is empty while not logged in, so a stroke on a chart nobody can see goes nowhere", async () => {
    const fiber = Effect.runFork(
      Stream.runCollect(
        chartBrushDependenciesToStream({ isLoggedIn: false }).pipe(
          Stream.take(1)
        )
      )
    );
    chartEvents.dispatchEvent(
      new CustomEvent("brush", { detail: { startMs: 1000, endMs: 5000 } })
    );
    const events = await Effect.runPromise(Fiber.join(fiber));

    expect(Array.from(events)).toEqual([]);
  });

  test("wraps each stroke for the dashboard while logged in", async () => {
    const events = await Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        Stream.runCollect(
          chartBrushDependenciesToStream({ isLoggedIn: true }).pipe(
            Stream.take(1)
          )
        )
      );
      yield* Effect.sleep("10 millis");
      chartEvents.dispatchEvent(
        new CustomEvent("brush", { detail: { startMs: 1000, endMs: 5000 } })
      );
      return yield* Fiber.join(fiber);
    }).pipe(Effect.runPromise);

    expect(Array.from(events)).toEqual([
      {
        _tag: "GotDashboardMessage",
        message: { _tag: "BrushedChartRange", startMs: 1000, endMs: 5000 },
      },
    ]);
  });
});

describe("activityModelToDependencies", () => {
  const loggedIn = (isIdle: boolean) =>
    LoggedIn({
      maybeSession: Option.none(),
      dashboard: { ...initDashboardModel(defaultSettings()), isIdle },
    });

  test("is never logged in or idle while Checking or LoggedOut", () => {
    const states = [
      Checking({ maybeToken: Option.none(), settings: defaultSettings() }),
      initLoggedOut(defaultSettings()),
    ];

    for (const state of states) {
      expect(activityModelToDependencies(state)).toEqual({
        isLoggedIn: false,
        isIdle: false,
      });
    }
  });

  test("carries isIdle from the embedded dashboard once LoggedIn", () => {
    expect(activityModelToDependencies(loggedIn(false))).toEqual({
      isLoggedIn: true,
      isIdle: false,
    });
    expect(activityModelToDependencies(loggedIn(true))).toEqual({
      isLoggedIn: true,
      isIdle: true,
    });
  });
});

describe("loggedInModelToDependencies", () => {
  test("ignores pause and idle, so what it gates keeps running through both", () => {
    expect(
      loggedInModelToDependencies(
        LoggedIn({
          maybeSession: Option.none(),
          dashboard: {
            ...initDashboardModel(defaultSettings()),
            isPaused: true,
            isIdle: true,
          },
        })
      )
    ).toEqual({ isLoggedIn: true });
    expect(
      loggedInModelToDependencies(initLoggedOut(defaultSettings()))
    ).toEqual({ isLoggedIn: false });
  });
});

describe("activityDependenciesToStream", () => {
  afterEach(() => vi.restoreAllMocks());

  it.effect.each([false, true])(
    "is empty while not logged in, with isIdle %s",
    (isIdle) =>
      Effect.gen(function* () {
        const add = vi.spyOn(window, "addEventListener");
        const events = yield* Stream.runCollect(
          activityDependenciesToStream({ isLoggedIn: false, isIdle })
        );

        expect(Array.from(events)).toEqual([]);
        expect(add).not.toHaveBeenCalled();
      })
  );

  it.effect("wraps the first activity while idle for the dashboard", () =>
    Effect.gen(function* () {
      const add = vi.spyOn(window, "addEventListener");
      const fiber = yield* Effect.forkChild(
        Stream.runCollect(
          activityDependenciesToStream({ isLoggedIn: true, isIdle: true })
        )
      );
      yield* Effect.yieldNow.pipe(
        Effect.repeat({ until: () => add.mock.calls.length > 0 })
      );
      window.dispatchEvent(new Event("mousemove"));

      expect(Array.from(yield* Fiber.join(fiber))).toEqual([
        GotDashboardMessage({ message: Interacted() }),
      ]);
    })
  );
});

describe("clockModelToDependencies", () => {
  test("is not logged in, counting minutes, while Checking or LoggedOut", () => {
    const states = [
      Checking({ maybeToken: Option.none(), settings: defaultSettings() }),
      initLoggedOut(defaultSettings()),
    ];

    for (const state of states) {
      expect(clockModelToDependencies(state)).toEqual({
        isLoggedIn: false,
        resolution: "minute",
      });
    }
  });

  test("takes the resolution the embedded dashboard needs once LoggedIn, paused or not", () => {
    const dashboard = {
      ...initDashboardModel(defaultSettings()),
      isPaused: true,
      isIdle: true,
      maybeLastUpdatedMs: Option.some(NOW_MS - 1000),
    };

    expect(
      clockModelToDependencies(
        LoggedIn({ maybeSession: Option.none(), dashboard })
      )
    ).toEqual({ isLoggedIn: true, resolution: "second" });
  });
});

describe("clockDependenciesToStream", () => {
  it.effect("is empty while not logged in", () =>
    Effect.gen(function* () {
      const events = yield* Stream.runCollect(
        clockDependenciesToStream({ isLoggedIn: false, resolution: "second" })
      );

      expect(Array.from(events)).toEqual([]);
    })
  );

  it.effect("wraps each tick of the dashboard clock while logged in", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(5000);
      const events = yield* Stream.runCollect(
        clockDependenciesToStream({
          isLoggedIn: true,
          resolution: "second",
        }).pipe(Stream.take(1))
      );

      expect(Array.from(events)).toEqual([
        GotDashboardMessage({ message: TickedClock({ nowMs: 5000 }) }),
      ]);
    })
  );
});
