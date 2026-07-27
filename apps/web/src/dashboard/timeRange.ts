import { Schema as S } from "effect";

export const TimeRange = S.Literals(["1h", "24h", "7d", "30d"]);
export type TimeRange = typeof TimeRange.Type;

export const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  "1h": "1 Hour",
  "24h": "24 Hours",
  "7d": "7 Days",
  "30d": "30 Days",
};

const RANGE_MS: Record<TimeRange, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

/**
 * Pure given `nowMs` explicitly, rather than reading the clock itself, so it
 * stays usable from `update` (which must not call Date.now()) as well as
 * from a Command that reads Clock.currentTimeMillis.
 */
export const getTimeRangeWindow = (
  range: TimeRange,
  nowMs: number
): { startTime: string; endTime: string } => ({
  startTime: new Date(nowMs - RANGE_MS[range]).toISOString(),
  endTime: new Date(nowMs).toISOString(),
});
