import {
  DEGRADED_BUCKET_MIN_SHARE,
  expectedBucketCount,
  type Granularity,
} from "@wan-monitor/shared";
import type {
  ConnectivityStatusRow,
  CycleStatus,
} from "@/infrastructure/database/questdb/model";

/**
 * Status of a rollup bucket from the cycle counts inside it. Any down cycle
 * makes the bucket down; degraded needs a meaningful share of degraded cycles,
 * not the instant a single cycle crosses the packet-loss floor, so one blip in
 * a coarse bucket doesn't paint the whole bucket.
 */
export const bucketStatus = ({
  down,
  degraded,
  total,
}: {
  readonly down: number;
  readonly degraded: number;
  readonly total: number;
}): CycleStatus => {
  if (down > 0) {
    return "down";
  }
  return total > 0 && degraded / total >= DEGRADED_BUCKET_MIN_SHARE
    ? "degraded"
    : "up";
};

export interface ConnectivitySummary {
  readonly uptimePercentage: number | null;
  readonly availabilityPercentage: number | null;
  readonly expectedBuckets: number;
  readonly observedBuckets: number;
  readonly coveragePercentage: number;
  readonly observedCycles: number;
}

/**
 * Uptime, availability and coverage for a window from its connectivity rollup
 * rows.
 *
 * Uptime counts strictly `up` cycles and availability counts `up` plus
 * `degraded`. Both are P(state | the collector was running): unmonitored
 * stretches leave the denominator and show up as lower coverage instead. With
 * no cycles the ratios are null, because nothing observed is not the same as
 * observing a total outage.
 *
 * A failed ping still writes a row, so an empty bucket means the collector
 * wasn't running, and every bucket with cycles is present in `rows`. The
 * query's upper bound is inclusive while `expectedBucketCount` counts the
 * half-open [start, end), so a window ending on a boundary can observe one
 * bucket more than expected; clamping keeps coverage a percentage.
 */
export const summarizeConnectivity = (
  rows: readonly ConnectivityStatusRow[],
  startMs: number,
  endMs: number,
  granularity: Granularity
): ConnectivitySummary => {
  const observedCycles = rows.reduce((sum, row) => sum + row.total_count, 0);
  const upCycles = rows.reduce((sum, row) => sum + row.up_count, 0);
  const degradedCycles = rows.reduce((sum, row) => sum + row.degraded_count, 0);
  const expectedBuckets = expectedBucketCount(startMs, endMs, granularity);
  const observedBuckets = rows.length;

  return {
    uptimePercentage:
      observedCycles > 0 ? (upCycles / observedCycles) * 100 : null,
    availabilityPercentage:
      observedCycles > 0
        ? ((upCycles + degradedCycles) / observedCycles) * 100
        : null,
    expectedBuckets,
    observedBuckets,
    coveragePercentage:
      expectedBuckets > 0
        ? Math.min(100, (observedBuckets / expectedBuckets) * 100)
        : 0,
    observedCycles,
  };
};
