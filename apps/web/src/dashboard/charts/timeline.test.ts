import { Option } from "effect";
import { describe, expect, test } from "vitest";
import {
  alignTimestampToMs,
  fillTimeline,
  getGranularityForTimeRange,
  granularityToMs,
} from "@/dashboard/charts/timeline";

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

describe("getGranularityForTimeRange", () => {
  test("uses 1-minute buckets for the 1 hour range", () => {
    expect(getGranularityForTimeRange("1h")).toBe("1m");
  });

  test("uses 5-minute buckets for longer ranges", () => {
    expect(getGranularityForTimeRange("24h")).toBe("5m");
    expect(getGranularityForTimeRange("7d")).toBe("5m");
    expect(getGranularityForTimeRange("30d")).toBe("5m");
  });
});

describe("alignTimestampToMs", () => {
  test("floors to the granularity boundary", () => {
    const t = Date.parse("2026-07-26T10:03:00.000Z");
    expect(alignTimestampToMs(t, "5m")).toBe(
      Date.parse("2026-07-26T10:00:00.000Z")
    );

    const t2 = Date.parse("2026-07-26T10:07:00.000Z");
    expect(alignTimestampToMs(t2, "5m")).toBe(
      Date.parse("2026-07-26T10:05:00.000Z")
    );
  });
});

describe("fillTimeline", () => {
  const startMs = Date.parse("2026-07-26T10:00:00.000Z");
  const endMs = Date.parse("2026-07-26T10:15:00.000Z");

  test("produces one slot per granularity interval across the range", () => {
    const result = fillTimeline([], startMs, endMs, "5m");

    expect(result.map((slot) => slot.timestamp)).toEqual([
      Date.parse("2026-07-26T10:00:00.000Z"),
      Date.parse("2026-07-26T10:05:00.000Z"),
      Date.parse("2026-07-26T10:10:00.000Z"),
    ]);
    expect(result.every((slot) => Option.isNone(slot.point))).toBe(true);
  });

  test("places data into the slot matching its aligned timestamp", () => {
    const point = { timestamp: "2026-07-26T10:06:30.000Z", latency: 12.5 };

    const result = fillTimeline([point], startMs, endMs, "5m");

    expect(result[0].point).toEqual(Option.none());
    expect(result[1].point).toEqual(Option.some(point));
    expect(result[2].point).toEqual(Option.none());
  });

  test("is empty when the range doesn't span a full interval", () => {
    const result = fillTimeline([], startMs, startMs, "5m");
    expect(result).toEqual([]);
  });
});
