import type { Granularity } from "@wan-monitor/shared";
import { granularityToMs } from "@/utils/granularity";

/**
 * Align a timestamp to the nearest granularity interval boundary
 * For example, with 5m granularity:
 * - 10:03:00 -> 10:00:00
 * - 10:07:00 -> 10:05:00
 */
export function alignTimestampToGranularity(
  timestamp: Date,
  granularity: Granularity
): number {
  const intervalMs = granularityToMs(granularity);
  const timestampMs = timestamp.getTime();
  return Math.floor(timestampMs / intervalMs) * intervalMs;
}
