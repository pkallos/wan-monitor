import { describe, expect, it } from "vitest";
import { cyclePeriodMs } from "@/core/analytics/period";

describe("cyclePeriodMs", () => {
  it("uses the measured period when the window had one", () => {
    expect(cyclePeriodMs(40_500, 30)).toBe(40_500);
  });

  it("falls back to the configured interval when there are too few cycles to measure", () => {
    expect(cyclePeriodMs(null, 30)).toBe(30_000);
  });
});
