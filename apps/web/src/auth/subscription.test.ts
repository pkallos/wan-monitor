import { Effect, Option, Stream } from "effect";
import { describe, expect, test } from "vitest";
import { Checking, initLoggedOut, LoggedIn } from "@/auth/model";
import { dependenciesToStream, modelToDependencies } from "@/auth/subscription";
import { initModel as initDashboardModel } from "@/dashboard";

describe("modelToDependencies", () => {
  test("is never logged in while Checking or LoggedOut", () => {
    expect(
      modelToDependencies(Checking({ maybeToken: Option.none() }))
    ).toEqual({ isPaused: true, isIdle: false, isLoggedIn: false });
    expect(modelToDependencies(initLoggedOut())).toEqual({
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
          dashboard: { ...initDashboardModel(), isPaused: true, isIdle: true },
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
