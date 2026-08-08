import { Option } from "effect";
import { describe, expect, test } from "vitest";
import {
  buildSegments,
  CONNECTIVITY_LABELS,
  formatSegmentLabel,
  formatUptimeSummary,
  mergeSegments,
} from "@/dashboard/connectivity";

describe("buildSegments", () => {
  const startMs = Date.parse("2026-07-26T10:00:00.000Z");
  const endMs = Date.parse("2026-07-26T10:15:00.000Z");

  test("fills gaps in the window with noInfo segments", () => {
    const result = buildSegments([], startMs, endMs, "5m", Option.none());

    expect(result).toEqual([
      { timestampMs: startMs, status: "noInfo", count: 1 },
      { timestampMs: startMs + 300_000, status: "noInfo", count: 1 },
      { timestampMs: startMs + 600_000, status: "noInfo", count: 1 },
    ]);
  });

  test("passes through the server's down status unchanged", () => {
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
      "5m",
      Option.none()
    );

    expect(result[0]).toEqual({
      timestampMs: startMs,
      status: "down",
      count: 1,
    });
  });

  test("passes through the server's degraded status unchanged", () => {
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
      "5m",
      Option.none()
    );

    expect(result[0]).toEqual({
      timestampMs: startMs,
      status: "degraded",
      count: 1,
    });
  });

  test("passes through the server's up status unchanged", () => {
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
      "5m",
      Option.none()
    );

    expect(result[0]).toEqual({ timestampMs: startMs, status: "up", count: 1 });
  });

  test("marks slots before the first ever sample as notMonitored", () => {
    // Monitoring began in the third slot, so the two before it describe a
    // period nobody was watching, not a period the monitor went quiet.
    const result = buildSegments(
      [],
      startMs,
      endMs,
      "5m",
      Option.some(startMs + 600_000)
    );

    expect(result).toEqual([
      { timestampMs: startMs, status: "notMonitored", count: 1 },
      { timestampMs: startMs + 300_000, status: "notMonitored", count: 1 },
      { timestampMs: startMs + 600_000, status: "noInfo", count: 1 },
    ]);
  });

  test("counts the slot holding the first sample as monitored", () => {
    // The first sample landed mid-slot; that slot was monitored, so it reads
    // as a gap in monitoring rather than as pre-history.
    const result = buildSegments(
      [],
      startMs,
      endMs,
      "5m",
      Option.some(startMs + 120_000)
    );

    expect(result[0].status).toBe("noInfo");
  });

  test("treats gaps after monitoring started as noInfo, not notMonitored", () => {
    const result = buildSegments(
      [],
      startMs,
      endMs,
      "5m",
      Option.some(startMs - 86_400_000)
    );

    expect(result.map((segment) => segment.status)).toEqual([
      "noInfo",
      "noInfo",
      "noInfo",
    ]);
  });

  test("falls back to noInfo for every slot when nothing was ever recorded", () => {
    const result = buildSegments([], startMs, endMs, "5m", Option.none());

    expect(result.every((segment) => segment.status === "noInfo")).toBe(true);
  });

  test("never overrides a real reading with notMonitored", () => {
    const result = buildSegments(
      [
        {
          timestamp: "2026-07-26T10:00:00.000Z",
          status: "down",
          upPercentage: 0,
          downPercentage: 100,
          degradedPercentage: 0,
        },
      ],
      startMs,
      endMs,
      "5m",
      Option.some(startMs + 600_000)
    );

    expect(result[0].status).toBe("down");
  });
});

describe("formatUptimeSummary", () => {
  test("says there is no data rather than reporting 0% uptime", () => {
    expect(
      formatUptimeSummary({
        maybeUptimePercentage: Option.none(),
        coveragePercentage: 0,
      })
    ).toBe("Uptime: no data for this period");
  });

  test("reports uptime alone when the window was fully covered", () => {
    expect(
      formatUptimeSummary({
        maybeUptimePercentage: Option.some(99.94),
        coveragePercentage: 100,
      })
    ).toBe("Uptime: 99.9%");
  });

  test("qualifies uptime with coverage when the monitor missed part of the window", () => {
    expect(
      formatUptimeSummary({
        maybeUptimePercentage: Option.some(100),
        coveragePercentage: 4.1666,
      })
    ).toBe("Uptime: 100.0% — over 4.2% of the window");
  });

  test("suppresses the suffix when coverage rounds to a full window", () => {
    // 99.96% renders as "100.0%", so claiming a shortfall would contradict the
    // number shown next to it.
    expect(
      formatUptimeSummary({
        maybeUptimePercentage: Option.some(100),
        coveragePercentage: 99.96,
      })
    ).toBe("Uptime: 100.0%");
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
