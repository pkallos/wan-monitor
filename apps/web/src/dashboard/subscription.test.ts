import { Effect, Stream } from "effect";
import { describe, expect, test } from "vitest";
import { initModel } from "@/dashboard/model";
import {
  dependenciesToStream,
  modelToDependencies,
} from "@/dashboard/subscription";

describe("modelToDependencies", () => {
  test("derives isPaused and isIdle from the Model", () => {
    expect(modelToDependencies(initModel())).toEqual({
      isPaused: false,
      isIdle: false,
    });
    expect(
      modelToDependencies({ ...initModel(), isPaused: true, isIdle: true })
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
