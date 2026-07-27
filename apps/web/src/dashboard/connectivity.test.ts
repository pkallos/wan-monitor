import { describe, expect, test } from "vitest";
import {
  buildSegments,
  CONNECTIVITY_LABELS,
  formatSegmentLabel,
  mergeSegments,
} from "@/dashboard/connectivity";

describe("buildSegments", () => {
  const startMs = Date.parse("2026-07-26T10:00:00.000Z");
  const endMs = Date.parse("2026-07-26T10:15:00.000Z");

  test("fills gaps in the window with noInfo segments", () => {
    const result = buildSegments([], startMs, endMs, "5m");

    expect(result).toEqual([
      { timestampMs: startMs, status: "noInfo", count: 1 },
      { timestampMs: startMs + 300_000, status: "noInfo", count: 1 },
      { timestampMs: startMs + 600_000, status: "noInfo", count: 1 },
    ]);
  });

  test("classifies a point as down once downPercentage passes the dominant threshold", () => {
    const result = buildSegments(
      [
        {
          timestamp: "2026-07-26T10:00:00.000Z",
          status: "down",
          upPercentage: 0,
          downPercentage: 80,
          degradedPercentage: 20,
        },
      ],
      startMs,
      endMs,
      "5m"
    );

    expect(result[0]).toEqual({
      timestampMs: startMs,
      status: "down",
      count: 1,
    });
  });

  test("classifies a point as degraded once degradedPercentage passes the dominant threshold", () => {
    const result = buildSegments(
      [
        {
          timestamp: "2026-07-26T10:00:00.000Z",
          status: "degraded",
          upPercentage: 20,
          downPercentage: 20,
          degradedPercentage: 60,
        },
      ],
      startMs,
      endMs,
      "5m"
    );

    expect(result[0]).toEqual({
      timestampMs: startMs,
      status: "degraded",
      count: 1,
    });
  });

  test("classifies a point as up when neither down nor degraded is dominant", () => {
    const result = buildSegments(
      [
        {
          timestamp: "2026-07-26T10:00:00.000Z",
          status: "up",
          upPercentage: 100,
          downPercentage: 0,
          degradedPercentage: 0,
        },
      ],
      startMs,
      endMs,
      "5m"
    );

    expect(result[0]).toEqual({ timestampMs: startMs, status: "up", count: 1 });
  });
});

describe("mergeSegments", () => {
  test("collapses consecutive segments sharing a status into one, summing their counts", () => {
    const result = mergeSegments([
      { timestampMs: 0, status: "up", count: 1 },
      { timestampMs: 300_000, status: "up", count: 1 },
      { timestampMs: 600_000, status: "down", count: 1 },
      { timestampMs: 900_000, status: "up", count: 1 },
    ]);

    expect(result).toEqual([
      { timestampMs: 0, status: "up", count: 2 },
      { timestampMs: 600_000, status: "down", count: 1 },
      { timestampMs: 900_000, status: "up", count: 1 },
    ]);
  });

  test("is empty for an empty input", () => {
    expect(mergeSegments([])).toEqual([]);
  });

  test("passes through a single segment unchanged", () => {
    const segment = { timestampMs: 0, status: "noInfo" as const, count: 1 };
    expect(mergeSegments([segment])).toEqual([segment]);
  });
});

describe("formatSegmentLabel", () => {
  test("labels a single-slot segment with its own timestamp", () => {
    const segment = {
      timestampMs: Date.parse("2026-07-26T10:00:00.000Z"),
      status: "up" as const,
      count: 1,
    };

    const label = formatSegmentLabel(segment, "5m");

    expect(label).toContain(CONNECTIVITY_LABELS.up);
    expect(label).not.toContain(" - ");
  });

  test("labels a merged segment with a start-end range", () => {
    const segment = {
      timestampMs: Date.parse("2026-07-26T10:00:00.000Z"),
      status: "down" as const,
      count: 3,
    };

    const label = formatSegmentLabel(segment, "5m");

    expect(label).toContain(CONNECTIVITY_LABELS.down);
    expect(label).toContain(" - ");
  });
});
