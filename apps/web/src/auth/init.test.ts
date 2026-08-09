import { Option } from "effect";
import { describe, expect, test } from "vitest";
import { FetchAuthStatus } from "@/auth/command";
import { Flags } from "@/auth/flags";
import { init } from "@/auth/init";
import { Checking } from "@/auth/model";
import { defaultSettings, type Settings } from "@/storage";

describe("init", () => {
  test("starts Checking with the stored token, if any, and fetches auth status", () => {
    const [model, commands] = init(
      Flags.make({
        maybeToken: Option.some("stored-token"),
        settings: defaultSettings(),
      })
    );

    expect(model).toEqual(
      Checking({
        maybeToken: Option.some("stored-token"),
        settings: defaultSettings(),
      })
    );
    expect(commands).toEqual([FetchAuthStatus()]);
  });

  test("starts Checking with no token when none is stored", () => {
    const [model] = init(
      Flags.make({ maybeToken: Option.none(), settings: defaultSettings() })
    );

    expect(model).toEqual(
      Checking({ maybeToken: Option.none(), settings: defaultSettings() })
    );
  });

  test("threads the hydrated settings through unchanged", () => {
    const settings: Settings = {
      theme: "dark",
      dateRange: defaultSettings().dateRange,
      isPaused: true,
    };

    const [model] = init(Flags.make({ maybeToken: Option.none(), settings }));

    expect(model).toEqual(Checking({ maybeToken: Option.none(), settings }));
  });
});
