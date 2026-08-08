import { Option } from "effect";
import { describe, expect, test } from "vitest";
import {
  alignTimestampToMs,
  fillTimeline,
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

  // Aggregated metrics arrive filtered to ping rows, so an interval whose
  // only samples were speedtests reaches here with nothing in it and has to
  // render as a gap rather than borrowing a speedtest's latency.
  test("leaves an interval with no ping sample as a gap", () => {
    const pingBefore = {
      timestamp: "2026-07-26T10:02:00.000Z",
      source: "ping" as const,
      latency: 11.1,
    };
    const pingAfter = {
      timestamp: "2026-07-26T10:11:00.000Z",
      source: "ping" as const,
      latency: 9.4,
    };

    const result = fillTimeline([pingBefore, pingAfter], startMs, endMs, "5m");

    expect(result[0].point).toEqual(Option.some(pingBefore));
    expect(result[1].point).toEqual(Option.none());
    expect(result[2].point).toEqual(Option.some(pingAfter));
  });

  // A Map keyed on the aligned timestamp keeps only the last row for a slot,
  // so two rows sharing a bucket silently drop one. Only single-source data
  // reaches this function for that reason.
  test("keeps the last of two rows sharing a slot", () => {
    const first = { timestamp: "2026-07-26T10:01:00.000Z", latency: 11.1 };
    const second = { timestamp: "2026-07-26T10:04:00.000Z", latency: 3.4 };

    const result = fillTimeline([first, second], startMs, endMs, "5m");

    expect(result[0].point).toEqual(Option.some(second));
  });

  test("is empty when the range doesn't span a full interval", () => {
    const result = fillTimeline([], startMs, startMs, "5m");
    expect(result).toEqual([]);
  });
});
