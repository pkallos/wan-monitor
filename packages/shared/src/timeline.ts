import type { Granularity } from "@shared/api/routes/metrics";

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

/**
 * Number of granularity buckets the half-open range [startMs, endMs) covers.
 *
 * Shares alignment math with `fillTimeline`'s slot grid, so the server's
 * expected-bucket count and the chart's own slot count are always the same
 * number. Coverage is the ratio between expected and observed buckets, so any
 * drift between the two would push coverage past 100%.
 */
export const expectedBucketCount = (
  startMs: number,
  endMs: number,
  granularity: Granularity
): number => {
  const intervalMs = granularityToMs(granularity);
  const alignedStart = alignTimestampToMs(startMs, granularity);
  const alignedEnd = alignTimestampToMs(endMs, granularity);
  const count = Math.round((alignedEnd - alignedStart) / intervalMs);
  return count > 0 ? count : 0;
};
