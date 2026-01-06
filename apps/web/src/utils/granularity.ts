import type { Granularity } from "@shared/api";

/**
 * Calculate appropriate granularity based on time range
 * - 1hr or less: 1-minute buckets (~60 points)
 * - All other ranges: 5-minute buckets
 */
export function getGranularityForRange(
  startTime?: Date,
  endTime?: Date
): Granularity | undefined {
  if (!startTime || !endTime) return undefined;

  const rangeMs = endTime.getTime() - startTime.getTime();
  const rangeHours = rangeMs / (1000 * 60 * 60);

  // 1h or less: 1-minute buckets (~60 points)
  if (rangeHours <= 1) return "1m";
  // All other ranges: 5-minute buckets
  return "5m";
}

/**
 * Convert granularity string to milliseconds
 */
export function granularityToMs(granularity: Granularity): number {
  switch (granularity) {
    case "1m":
      return 60 * 1000;
    case "5m":
      return 5 * 60 * 1000;
    case "15m":
      return 15 * 60 * 1000;
    case "1h":
      return 60 * 60 * 1000;
    case "6h":
      return 6 * 60 * 60 * 1000;
    case "1d":
      return 24 * 60 * 60 * 1000;
    default:
      return 5 * 60 * 1000; // Default to 5 minutes
  }
}
