import type { ConnectivityStatus } from "@shared/metrics";
import {
  DEGRADED_BUCKET_MIN_SHARE,
  type Granularity,
  granularityToMs,
} from "@wan-monitor/shared";
import type { ConnectivityStatusRow } from "@/infrastructure/database/questdb/model";

const MICROS_PER_SECOND = 1_000_000;

/**
 * Status of a rollup bucket from the time spent in each state inside it. Any
 * down time makes the bucket down; degraded needs a meaningful share of the
 * bucket's observed time, not the first second at or above the packet-loss
 * floor, so one blip in a coarse bucket does not paint the whole bucket. Durations are
 * microseconds.
 */
export const bucketStatus = ({
  down,
  degraded,
  observed,
}: {
  readonly down: number;
  readonly degraded: number;
  readonly observed: number;
}): ConnectivityStatus => {
  if (down > 0) {
    return "down";
  }
  return observed > 0 && degraded / observed >= DEGRADED_BUCKET_MIN_SHARE
    ? "degraded"
    : "up";
};

export interface ConnectivitySummary {
  readonly uptimePercentage: number | null;
  readonly availabilityPercentage: number | null;
  readonly expectedBuckets: number;
  readonly observedBuckets: number;
  readonly coveragePercentage: number;
  readonly observedSeconds: number;
}

/**
 * Number of buckets the half-open range [startMs, endMs) touches, including a
 * partial first or last bucket, since the ribbon holds time in those too.
 */
const bucketsTouched = (
  startMs: number,
  endMs: number,
  granularity: Granularity
): number => {
  if (endMs <= startMs) {
    return 0;
  }
  const widthMs = granularityToMs(granularity);
  return Math.floor((endMs - 1) / widthMs) - Math.floor(startMs / widthMs) + 1;
};

/**
 * Uptime, availability and coverage for a window from its connectivity rollup
 * rows.
 *
 * Uptime is up time over observed time, and availability is up plus degraded
 * time over observed time. Both are P(state | a host was being watched): time with no
 * standing ping leaves the denominator and shows up as lower coverage instead.
 * With no observed time the ratios are null, because nothing observed is not
 * the same as observing a total outage.
 *
 * A bucket is present in `rows` when it holds observed time. `endMs` is the
 * window's end clipped to the present. Coverage counts every bucket the
 * half-open [start, end) touches, partial first and last ones included, and is
 * clamped to 100 as a guard.
 */
export const summarizeConnectivity = (
  rows: readonly ConnectivityStatusRow[],
  startMs: number,
  endMs: number,
  granularity: Granularity
): ConnectivitySummary => {
  const upMicros = rows.reduce((sum, row) => sum + row.up_micros, 0);
  const degradedMicros = rows.reduce(
    (sum, row) => sum + row.degraded_micros,
    0
  );
  const downMicros = rows.reduce((sum, row) => sum + row.down_micros, 0);
  const observedMicros = upMicros + degradedMicros + downMicros;
  const expectedBuckets = bucketsTouched(startMs, endMs, granularity);
  const observedBuckets = rows.length;

  return {
    uptimePercentage:
      observedMicros > 0 ? (upMicros / observedMicros) * 100 : null,
    availabilityPercentage:
      observedMicros > 0
        ? ((upMicros + degradedMicros) / observedMicros) * 100
        : null,
    expectedBuckets,
    observedBuckets,
    coveragePercentage:
      expectedBuckets > 0
        ? Math.min(100, (observedBuckets / expectedBuckets) * 100)
        : 0,
    observedSeconds: observedMicros / MICROS_PER_SECOND,
  };
};
