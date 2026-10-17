import { describe, expect, it } from "vitest";
import { bucketStatus, summarizeConnectivity } from "@/core/analytics/rollup";
import type { ConnectivityStatusRow } from "@/infrastructure/database/questdb/model";

const row = (
  counts: Partial<
    Pick<ConnectivityStatusRow, "up_count" | "degraded_count" | "down_count">
  >,
  timestamp = "2024-01-01T00:00:00Z"
): ConnectivityStatusRow => {
  const up_count = counts.up_count ?? 0;
  const degraded_count = counts.degraded_count ?? 0;
  const down_count = counts.down_count ?? 0;
  return {
    timestamp,
    up_count,
    degraded_count,
    down_count,
    total_count: up_count + degraded_count + down_count,
  };
};

describe("bucketStatus", () => {
  it("is down when any cycle was down", () => {
    expect(bucketStatus({ down: 1, degraded: 0, total: 120 })).toBe("down");
  });

  it("is degraded once the degraded share reaches the floor", () => {
    expect(bucketStatus({ down: 0, degraded: 3, total: 10 })).toBe("degraded");
    expect(bucketStatus({ down: 0, degraded: 6, total: 120 })).toBe("degraded");
  });

  it("stays up for a lone degraded cycle in a large bucket", () => {
    expect(bucketStatus({ down: 0, degraded: 1, total: 120 })).toBe("up");
  });

  it("is up for a clean bucket", () => {
    expect(bucketStatus({ down: 0, degraded: 0, total: 10 })).toBe("up");
  });
});

describe("summarizeConnectivity", () => {
  const start = Date.parse("2024-01-01T00:00:00Z");
  const hour = 3_600_000;

  it("counts strictly up cycles for uptime and up plus degraded for availability", () => {
    const summary = summarizeConnectivity(
      [row({ up_count: 7, degraded_count: 2, down_count: 1 })],
      start,
      start + hour,
      "1h"
    );

    expect(summary.uptimePercentage).toBe(70);
    expect(summary.availabilityPercentage).toBe(90);
    expect(summary.observedCycles).toBe(10);
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
      [row({ up_count: 5 }), row({ up_count: 5 }, "2024-01-01T02:00:00Z")],
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
        row({ up_count: 1 }),
        row({ up_count: 1 }, "2024-01-01T01:00:00Z"),
        row({ up_count: 1 }, "2024-01-01T02:00:00Z"),
      ],
      start,
      start + 2 * hour,
      "1h"
    );

    expect(summary.coveragePercentage).toBe(100);
  });

  it("reports zero coverage for an empty window", () => {
    const summary = summarizeConnectivity(
      [row({ up_count: 1 })],
      start,
      start,
      "1h"
    );

    expect(summary.expectedBuckets).toBe(0);
    expect(summary.coveragePercentage).toBe(0);
  });
});
