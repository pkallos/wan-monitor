import type { Granularity } from "@shared/api/routes/metrics";
import { Array as Array_, Option } from "effect";
import type { TimeRange } from "@/dashboard/timeRange";

const GRANULARITY_MS: Record<Granularity, number> = {
  "1m": 60 * 1000,
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
};

export const granularityToMs = (granularity: Granularity): number =>
  GRANULARITY_MS[granularity];

export const alignTimestampToMs = (
  timestampMs: number,
  granularity: Granularity
): number => {
  const intervalMs = granularityToMs(granularity);
  return Math.floor(timestampMs / intervalMs) * intervalMs;
};

/** Matches the current dashboard: only the 1h range buckets tighter than 5m. */
export const getGranularityForTimeRange = (
  timeRange: TimeRange
): Granularity => (timeRange === "1h" ? "1m" : "5m");

export interface TimelineSlot<A> {
  readonly timestamp: number;
  readonly point: Option.Option<A>;
}

/**
 * Buckets sparse, timestamped data into one slot per granularity interval
 * across [startTimeMs, endTimeMs), so a chart can render gaps as nulls
 * instead of connecting distant samples with a misleading line.
 */
export const fillTimeline = <A extends { timestamp: string }>(
  data: ReadonlyArray<A>,
  startTimeMs: number,
  endTimeMs: number,
  granularity: Granularity
): ReadonlyArray<TimelineSlot<A>> => {
  const dataBySlot = new Map(
    Array_.map(
      data,
      (point) =>
        [
          alignTimestampToMs(new Date(point.timestamp).getTime(), granularity),
          point,
        ] as const
    )
  );

  const intervalMs = granularityToMs(granularity);
  const startMs = alignTimestampToMs(startTimeMs, granularity);
  const endMs = alignTimestampToMs(endTimeMs, granularity);
  const slotCount = Math.round((endMs - startMs) / intervalMs);

  // Array.makeBy always returns at least one element, so a non-positive
  // count (an empty or inverted range) has to short-circuit here instead.
  if (slotCount <= 0) return [];

  return Array_.makeBy(slotCount, (i) => {
    const slotMs = startMs + i * intervalMs;
    return {
      timestamp: slotMs,
      point: Option.fromNullishOr(dataBySlot.get(slotMs)),
    };
  });
};
