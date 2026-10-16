import { Effect, Fiber, Stream } from "effect";
import { afterEach, describe, expect, test, vi } from "vitest";
import { initModel } from "@/dashboard/model";
import {
  dependenciesToStream,
  modelToDependencies,
  systemThemeDependenciesToStream,
  systemThemeModelToDependencies,
} from "@/dashboard/subscription";
import { defaultSettings } from "@/storage";

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

describe("systemThemeModelToDependencies", () => {
  test("is active only for the system preference", () => {
    const base = initModel(defaultSettings());

    expect(
      systemThemeModelToDependencies({ ...base, theme: "system" })
    ).toEqual({ isSystemTheme: true });
    expect(systemThemeModelToDependencies({ ...base, theme: "dark" })).toEqual({
      isSystemTheme: false,
    });
    expect(systemThemeModelToDependencies({ ...base, theme: "light" })).toEqual(
      { isSystemTheme: false }
    );
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
