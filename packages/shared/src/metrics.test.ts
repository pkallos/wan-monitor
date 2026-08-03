import { mbpsToBps } from "@shared/metrics";
import { describe, expect, it } from "vitest";

describe("mbpsToBps", () => {
  it("scales Mbps to bps by 1e6", () => {
    expect(mbpsToBps(100.5)).toBe(100_500_000);
  });

  it("rounds sub-bit fractions to the nearest whole bit", () => {
    expect(mbpsToBps(1.2345678)).toBe(1_234_568);
    expect(mbpsToBps(0.0000004)).toBe(0);
    expect(mbpsToBps(0.0000005)).toBe(1);
  });

  it("maps zero to zero", () => {
    expect(mbpsToBps(0)).toBe(0);
  });
});
