import { describe, expect, it } from "vitest";
import { max, median, percentile } from "@/core/analytics/stats";

describe("max", () => {
  it("is null for no values", () => {
    expect(max([])).toBeNull();
  });

  it("finds the largest value, including negatives", () => {
    expect(max([3, 9, 1])).toBe(9);
    expect(max([-5, -2])).toBe(-2);
  });

  it("handles a series too long to spread into Math.max", () => {
    expect(max(Array.from({ length: 500_000 }, (_, i) => i))).toBe(499_999);
  });
});

describe("percentile", () => {
  it("is null for no values", () => {
    expect(percentile([], 0.5)).toBeNull();
  });

  it("returns the only value for any percentile", () => {
    expect(percentile([42], 0.1)).toBe(42);
    expect(percentile([42], 0.99)).toBe(42);
  });

  it("interpolates linearly between the two nearest ranks", () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
    expect(percentile([0, 100], 0.1)).toBe(10);
  });

  it("hits the extremes at 0 and 1", () => {
    expect(percentile([3, 9, 27], 0)).toBe(3);
    expect(percentile([3, 9, 27], 1)).toBe(27);
  });

  it("sorts its input and leaves the caller's array untouched", () => {
    const values = [30, 10, 20];

    expect(percentile(values, 0.5)).toBe(20);
    expect(values).toEqual([30, 10, 20]);
  });
});

describe("median", () => {
  it("is null for no values", () => {
    expect(median([])).toBeNull();
  });

  it("averages the middle pair of an even count", () => {
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });

  it("picks the middle of an odd count", () => {
    expect(median([5, 1, 3])).toBe(3);
  });
});
