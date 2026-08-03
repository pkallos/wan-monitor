import type { Granularity } from "@shared/api/routes/metrics";

export const VALID_GRANULARITIES: Granularity[] = [
  "1m",
  "5m",
  "15m",
  "1h",
  "6h",
  "1d",
];

export const isValidGranularity = (value: string): value is Granularity =>
  VALID_GRANULARITIES.some((granularity) => granularity === value);

/**
 * Packet-loss classification thresholds (percentages).
 *
 * Single source of truth for connectivity classification. The backend SQL in
 * `buildQueryConnectivityStatus` reads these directly, so the percentages the
 * API returns already carry this classification and the frontend renders them
 * as-is.
 */
export const PACKET_LOSS_THRESHOLDS = {
  /**
   * Packet loss % at or above which a sample is considered degraded. Matches
   * the ping train's own quantization (`PING_TRAIN_COUNT` default 10 packets,
   * so loss lands on 10% steps) — anything smaller wouldn't be expressible.
   */
  degradedFloor: 10,
  /** Packet loss % below which a sample is still degraded (upper bound). */
  degradedCeiling: 50,
} as const;

/**
 * Minimum share of degraded cycles a rollup bucket needs before the bucket
 * itself reads as "degraded" (see `getConnectivityStatusHandler`). Without
 * this floor, a single degraded cycle taints an entire bucket regardless of
 * how many cycles it spans — over a long window with a coarse rollup
 * (hours of 1-minute-interval ping cycles bucketed into one segment), that
 * turns one transient blip into a wide orange region.
 */
export const DEGRADED_BUCKET_MIN_SHARE = 0.05;
