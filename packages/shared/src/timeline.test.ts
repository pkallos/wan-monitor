import type { Granularity } from "@shared/api/routes/metrics";
import {
  alignTimestampToMs,
  expectedBucketCount,
  granularityToMs,
} from "@shared/timeline";
import { describe, expect, test } from "vitest";

const ALL_GRANULARITIES: ReadonlyArray<Granularity> = [
  "1m",
  "5m",
  "15m",
  "1h",
  "6h",
  "1d",
];

describe("granularityToMs", () => {
  test("converts every granularity to milliseconds", () => {
    expect(granularityToMs("1m")).toBe(60_000);
    expect(granularityToMs("5m")).toBe(300_000);
    expect(granularityToMs("15m")).toBe(900_000);
    expect(granularityToMs("1h")).toBe(3_600_000);
    expect(granularityToMs("6h")).toBe(21_600_000);
    expect(granularityToMs("1d")).toBe(86_400_000);
  });
});

describe("alignTimestampToMs", () => {
  test("floors to the granularity boundary", () => {
    expect(
      alignTimestampToMs(Date.parse("2026-07-26T10:03:00.000Z"), "5m")
    ).toBe(Date.parse("2026-07-26T10:00:00.000Z"));
    expect(
      alignTimestampToMs(Date.parse("2026-07-26T10:07:00.000Z"), "5m")
    ).toBe(Date.parse("2026-07-26T10:05:00.000Z"));
  });

  test("leaves a timestamp already on a boundary untouched", () => {
    const onBoundary = Date.parse("2026-07-26T10:00:00.000Z");
    expect(alignTimestampToMs(onBoundary, "5m")).toBe(onBoundary);
  });
});

describe("expectedBucketCount", () => {
  test("counts whole buckets across an exact multiple of the interval", () => {
    const start = Date.parse("2026-07-26T10:00:00.000Z");
    expect(expectedBucketCount(start, start + 15 * 60_000, "5m")).toBe(3);
    expect(expectedBucketCount(start, start + 24 * 3_600_000, "1h")).toBe(24);
  });

  test("ignores a partial trailing bucket, matching the half-open range", () => {
    const start = Date.parse("2026-07-26T10:00:00.000Z");
    // 12 minutes spans two whole 5m buckets plus a 2-minute remainder.
    expect(expectedBucketCount(start, start + 12 * 60_000, "5m")).toBe(2);
  });

  test("counts from the aligned start when the range begins mid-bucket", () => {
    const start = Date.parse("2026-07-26T10:03:00.000Z");
    const end = Date.parse("2026-07-26T10:12:00.000Z");
    // Aligned to 10:00 and 10:10, so two buckets, not the 1.8 the raw span
    // would suggest.
    expect(expectedBucketCount(start, end, "5m")).toBe(2);
  });

  test("is 0 for an empty range", () => {
    const start = Date.parse("2026-07-26T10:00:00.000Z");
    expect(expectedBucketCount(start, start, "5m")).toBe(0);
  });

  test("is 0 for an inverted range rather than a negative count", () => {
    const start = Date.parse("2026-07-26T10:00:00.000Z");
    expect(expectedBucketCount(start, start - 60 * 60_000, "5m")).toBe(0);
  });

  test("is 0 when the range is narrower than a single bucket", () => {
    const start = Date.parse("2026-07-26T10:00:00.000Z");
    expect(expectedBucketCount(start, start + 60_000, "5m")).toBe(0);
  });

  test("counts a whole day correctly at every granularity", () => {
    const start = Date.parse("2026-07-26T00:00:00.000Z");
    const dayMs = 86_400_000;

    for (const granularity of ALL_GRANULARITIES) {
      expect(expectedBucketCount(start, start + dayMs, granularity)).toBe(
        dayMs / granularityToMs(granularity)
      );
    }
  });
});
