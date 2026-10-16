import { InvalidTimeRange } from "@shared/api/errors";
import type { Granularity } from "@shared/api/routes/metrics";
import { Effect } from "effect";

export interface TimeWindow {
  readonly startMs: number;
  readonly endMs: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Trailing windows, anchored at the summary's end time, that the summary
 * endpoint reports uptime for.
 */
export const SUMMARY_WINDOWS_MS = {
  last24h: DAY_MS,
  last7d: 7 * DAY_MS,
  last30d: 30 * DAY_MS,
} as const;

const FINE_COVERAGE_MAX_SPAN_MS = 2 * DAY_MS;

/**
 * Bucket width used to measure how much of a window the monitor observed. The
 * dashboard's default (5m) for short windows; hourly beyond two days so a
 * 30-day window reads 720 rows rather than 8640.
 */
export const coverageGranularity = (spanMs: number): Granularity =>
  spanMs <= FINE_COVERAGE_MAX_SPAN_MS ? "5m" : "1h";

/**
 * The window of equal length that ends 1ms before [startMs, endMs] begins.
 * Deltas compare a range against this window, so both span the same duration.
 * Queries bound a window inclusively at both ends, so the gap keeps a cycle
 * stamped exactly on `startMs` out of the previous window.
 */
export const previousWindow = (startMs: number, endMs: number): TimeWindow => ({
  startMs: startMs - 1 - (endMs - startMs),
  endMs: startMs - 1,
});

/**
 * Resolves an optional ISO start and end into a window. A missing end is
 * `nowMs`; a missing start trails the end by `defaultSpanMs`.
 */
export const resolveWindow = (
  query: { readonly startTime?: string; readonly endTime?: string },
  nowMs: number,
  defaultSpanMs: number
): TimeWindow => {
  const endMs = query.endTime ? Date.parse(query.endTime) : nowMs;
  const startMs = query.startTime
    ? Date.parse(query.startTime)
    : endMs - defaultSpanMs;
  return { startMs, endMs };
};

/**
 * Fails with `InvalidTimeRange` (a 400) for a window whose start is after its
 * end, or that spans more than `maxSpanDays` when a cap is given. Checking
 * before any query runs is what lets the cap bound the database work.
 */
export const validateWindow = (
  window: TimeWindow,
  maxSpanDays?: number
): Effect.Effect<TimeWindow, InvalidTimeRange> => {
  if (window.startMs > window.endMs) {
    return Effect.fail(
      new InvalidTimeRange({ message: "startTime must not be after endTime" })
    );
  }
  if (
    maxSpanDays !== undefined &&
    window.endMs - window.startMs > maxSpanDays * DAY_MS
  ) {
    return Effect.fail(
      new InvalidTimeRange({
        message: `The time range must not exceed ${maxSpanDays} days`,
      })
    );
  }
  return Effect.succeed(window);
};

/**
 * Fails with `InvalidTimeRange` (a 400) when the window that `previousWindow`
 * derives would begin before the Unix epoch. QuestDB cannot convert timestamps
 * that far back, so the comparison query would otherwise fail with a 500.
 */
export const validatePreviousWindow = (
  window: TimeWindow
): Effect.Effect<TimeWindow, InvalidTimeRange> =>
  previousWindow(window.startMs, window.endMs).startMs < 0
    ? Effect.fail(
        new InvalidTimeRange({
          message:
            "The time range and the equal-length window before it must not begin before 1970-01-01",
        })
      )
    : Effect.succeed(window);
