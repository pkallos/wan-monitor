import { describe, expect, it } from "vitest";
import { bucketStatus, summarizeConnectivity } from "@/core/analytics/rollup";
import type { ConnectivityStatusRow } from "@/infrastructure/database/questdb/model";

const SECOND = 1_000_000;

const row = (
  seconds: { up?: number; degraded?: number; down?: number },
  bucket = "2024-01-01T00:00:00Z"
): ConnectivityStatusRow => ({
  bucket,
  up_micros: (seconds.up ?? 0) * SECOND,
  degraded_micros: (seconds.degraded ?? 0) * SECOND,
  down_micros: (seconds.down ?? 0) * SECOND,
});

describe("bucketStatus", () => {
  it("is down when any time in the bucket was down", () => {
    expect(
      bucketStatus({ down: 1, degraded: 0, observed: 3_600 * SECOND })
    ).toBe("down");
  });

  it("is degraded once degraded time reaches the floor share of observed time", () => {
    expect(
      bucketStatus({ down: 0, degraded: 5 * SECOND, observed: 100 * SECOND })
    ).toBe("degraded");
    expect(
      bucketStatus({ down: 0, degraded: 30 * SECOND, observed: 100 * SECOND })
    ).toBe("degraded");
  });

  it("stays up just under the floor share", () => {
    expect(
      bucketStatus({ down: 0, degraded: 4.9 * SECOND, observed: 100 * SECOND })
    ).toBe("up");
  });

  it("is up for a clean bucket", () => {
    expect(bucketStatus({ down: 0, degraded: 0, observed: 100 * SECOND })).toBe(
      "up"
    );
  });
});

describe("summarizeConnectivity", () => {
  const start = Date.parse("2024-01-01T00:00:00Z");
  const hour = 3_600_000;

  it("counts strictly up time for uptime and up plus degraded time for availability", () => {
    const summary = summarizeConnectivity(
      [row({ up: 7, degraded: 2, down: 1 })],
      start,
      start + hour,
      "1h"
    );

    expect(summary.uptimePercentage).toBe(70);
    expect(summary.availabilityPercentage).toBe(90);
    expect(summary.observedSeconds).toBe(10);
  });

  it("weighs buckets by their monitored time, not by their count", () => {
    const summary = summarizeConnectivity(
      [row({ up: 3_600 }), row({ down: 1_800 }, "2024-01-01T01:00:00Z")],
      start,
      start + 2 * hour,
      "1h"
    );

    expect(summary.uptimePercentage).toBeCloseTo((3_600 / 5_400) * 100, 10);
    expect(summary.observedSeconds).toBe(5_400);
  });

  it("reports null percentages, not 0, when nothing was observed", () => {
    const summary = summarizeConnectivity([], start, start + hour, "1h");

    expect(summary.uptimePercentage).toBeNull();
    expect(summary.availabilityPercentage).toBeNull();
    expect(summary.coveragePercentage).toBe(0);
    expect(summary.observedBuckets).toBe(0);
  });

  it("measures coverage as observed over expected buckets", () => {
    const summary = summarizeConnectivity(
      [row({ up: 5 }), row({ up: 5 }, "2024-01-01T02:00:00Z")],
      start,
      start + 4 * hour,
      "1h"
    );

    expect(summary.expectedBuckets).toBe(4);
    expect(summary.observedBuckets).toBe(2);
    expect(summary.coveragePercentage).toBe(50);
  });

  it("clamps coverage at 100 when an inclusive upper bound observes an extra bucket", () => {
    const summary = summarizeConnectivity(
      [
        row({ up: 1 }),
        row({ up: 1 }, "2024-01-01T01:00:00Z"),
        row({ up: 1 }, "2024-01-01T02:00:00Z"),
      ],
      start,
      start + 2 * hour,
      "1h"
    );

    expect(summary.coveragePercentage).toBe(100);
  });

  it("does not let a partial last bucket stand in for a missing interior one", () => {
    const summary = summarizeConnectivity(
      [
        row({ up: 300 }, "2024-01-01T00:00:00Z"),
        row({ up: 120 }, "2024-01-01T00:10:00Z"),
      ],
      start,
      start + 12 * 60_000,
      "5m"
    );

    expect(summary.expectedBuckets).toBe(3);
    expect(summary.observedBuckets).toBe(2);
    expect(summary.coveragePercentage).toBeCloseTo((2 / 3) * 100, 10);
  });

  it("expects exactly the buckets a window that ends on a bucket edge spans", () => {
    const summary = summarizeConnectivity(
      [row({ up: 1 }), row({ up: 1 }, "2024-01-01T01:00:00Z")],
      start,
      start + 2 * hour,
      "1h"
    );

    expect(summary.expectedBuckets).toBe(2);
    expect(summary.coveragePercentage).toBe(100);
  });

  it("expects the bucket a window that starts inside one begins in", () => {
    const summary = summarizeConnectivity(
      [row({ up: 1_800 }), row({ up: 3_600 }, "2024-01-01T01:00:00Z")],
      start + 30 * 60_000,
      start + 2 * hour,
      "1h"
    );

    expect(summary.expectedBuckets).toBe(2);
    expect(summary.coveragePercentage).toBe(100);
  });

  it("expects the current partial bucket when the window is clipped to the present", () => {
    const now = start + 90 * 60_000;
    const summary = summarizeConnectivity(
      [row({ up: 3_600 }), row({ up: 1_800 }, "2024-01-01T01:00:00Z")],
      start,
      now,
      "1h"
    );

    expect(summary.expectedBuckets).toBe(2);
    expect(summary.coveragePercentage).toBe(100);
  });

  it("reads a live trailing day as fully covered when every bucket it touches holds time", () => {
    const now = Date.parse("2024-01-02T12:20:00Z");
    const rows = Array.from({ length: 25 }, (_, i) =>
      row(
        { up: 3_600 },
        new Date(Date.parse("2024-01-01T12:00:00Z") + i * hour).toISOString()
      )
    );

    const summary = summarizeConnectivity(rows, now - 24 * hour, now, "1h");

    expect(summary.expectedBuckets).toBe(25);
    expect(summary.coveragePercentage).toBe(100);
  });

  it("reports zero coverage for an empty window", () => {
    const summary = summarizeConnectivity([row({ up: 1 })], start, start, "1h");

    expect(summary.expectedBuckets).toBe(0);
    expect(summary.coveragePercentage).toBe(0);
  });
});
