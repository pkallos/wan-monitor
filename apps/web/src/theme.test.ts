import { describe, expect, it } from "vitest";
import { theme } from "@/theme";

describe("theme config", () => {
  it("defaults the first visit to the OS colour preference", () => {
    expect(theme.config.initialColorMode).toBe("system");
  });

  it("keeps useSystemColorMode false so a manual toggle persists across reload", () => {
    // With useSystemColorMode:true Chakra re-syncs to the OS preference on every
    // load and discards the stored selection. It must stay false for PHI-102's
    // persistence requirement to hold.
    expect(theme.config.useSystemColorMode).toBe(false);
  });
});
