import { Effect } from "effect";
import { describe, expect, test } from "vitest";
import { resolveSpeedtestTimelineWindow } from "@/dashboard/charts/command";
import { Custom } from "@/dashboard/dateRange";

// A 24h span lands under the speedtest aggregation threshold, and Custom
// resolves to this window regardless of the real clock.
const ONE_DAY_RANGE = Custom({
  startTime: "2026-07-26T00:00:00.000Z",
  endTime: "2026-07-27T00:00:00.000Z",
});
// A 30-day span lands at/above the speedtest aggregation threshold, and
// Custom resolves to this window regardless of the real clock.
const THIRTY_DAY_RANGE = Custom({
  startTime: "2026-06-27T00:00:00.000Z",
  endTime: "2026-07-27T00:00:00.000Z",
});

describe("resolveSpeedtestTimelineWindow", () => {
  test("resolves no granularity for a range under the aggregation threshold", async () => {
    const result = await Effect.runPromise(
      resolveSpeedtestTimelineWindow(ONE_DAY_RANGE)
    );

    expect(result).toEqual({
      startMs: Date.parse("2026-07-26T00:00:00.000Z"),
      endMs: Date.parse("2026-07-27T00:00:00.000Z"),
      granularity: undefined,
    });
  });

  test("resolves the aggregation granularity for a range at/above the threshold", async () => {
    const result = await Effect.runPromise(
      resolveSpeedtestTimelineWindow(THIRTY_DAY_RANGE)
    );

    expect(result.granularity).toBe("6h");
  });
});
