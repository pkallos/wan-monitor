import { Effect, Stream } from "effect";
import { describe, expect, test } from "vitest";
import { initModel } from "@/dashboard/model";
import {
  dependenciesToStream,
  modelToDependencies,
} from "@/dashboard/subscription";

describe("modelToDependencies", () => {
  test("derives isPaused from the Model", () => {
    expect(modelToDependencies(initModel())).toEqual({ isPaused: false });
    expect(modelToDependencies({ ...initModel(), isPaused: true })).toEqual({
      isPaused: true,
    });
  });
});

describe("dependenciesToStream", () => {
  test("is empty while paused, so no refresh tick can ever fire", async () => {
    const events = await Stream.runCollect(
      dependenciesToStream({ isPaused: true })
    ).pipe(Effect.runPromise);

    expect(Array.from(events)).toEqual([]);
  });
});
