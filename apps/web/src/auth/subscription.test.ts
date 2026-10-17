import { Effect, Option, Stream } from "effect";
import { afterEach, describe, expect, test, vi } from "vitest";
import { GotDashboardMessage } from "@/auth/message";
import { Checking, initLoggedOut, LoggedIn } from "@/auth/model";
import {
  dependenciesToStream,
  modelToDependencies,
  systemThemeDependenciesToStream,
  systemThemeModelToDependencies,
} from "@/auth/subscription";
import {
  ChangedSystemTheme,
  initModel as initDashboardModel,
} from "@/dashboard";
import { defaultSettings } from "@/storage";

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
