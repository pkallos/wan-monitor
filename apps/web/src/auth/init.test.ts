import { Option } from "effect";
import { describe, expect, test } from "vitest";
import { FetchAuthStatus } from "@/auth/command";
import { Flags } from "@/auth/flags";
import { init } from "@/auth/init";
import { Checking } from "@/auth/model";

describe("init", () => {
  test("starts Checking with the stored token, if any, and fetches auth status", () => {
    const [model, commands] = init(
      Flags.make({ maybeToken: Option.some("stored-token") })
    );

    expect(model).toEqual(
      Checking({ maybeToken: Option.some("stored-token") })
    );
    expect(commands).toEqual([FetchAuthStatus()]);
  });

  test("starts Checking with no token when none is stored", () => {
    const [model] = init(Flags.make({ maybeToken: Option.none() }));

    expect(model).toEqual(Checking({ maybeToken: Option.none() }));
  });
});
