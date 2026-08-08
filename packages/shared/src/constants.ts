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
 * Granularity used when a request doesn't name one. The connectivity handler
 * and the SQL builder both read it, so the bucket grid coverage is measured
 * against is the grid the query actually sampled over.
 */
export const DEFAULT_GRANULARITY: Granularity = "5m";

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

/** Floor for the live connectivity window, in seconds. */
export const LIVE_WINDOW_MIN_SECONDS = 60;

/** Ping cycles that must be missed before the live window reads as stale. */
export const LIVE_WINDOW_PING_MULTIPLIER = 2;

/**
 * Trailing window the live connectivity indicator looks back over for the most
 * recent ping cycle. Two ping intervals so one dropped or delayed cycle can't
 * flip the indicator to "no data", with a 60s floor so a very fast configured
 * interval doesn't produce a window the dashboard's own poll cadence could
 * step over.
 */
export const liveConnectivityWindowSeconds = (
  pingIntervalSeconds: number
): number =>
  Math.max(
    LIVE_WINDOW_MIN_SECONDS,
    LIVE_WINDOW_PING_MULTIPLIER * pingIntervalSeconds
  );

/**
 * Minimum share of degraded cycles a rollup bucket needs before the bucket
 * itself reads as "degraded" (see `getConnectivityStatusHandler`). Without
 * this floor, a single degraded cycle taints an entire bucket regardless of
 * how many cycles it spans — over a long window with a coarse rollup
 * (hours of 1-minute-interval ping cycles bucketed into one segment), that
 * turns one transient blip into a wide orange region.
 */
export const DEGRADED_BUCKET_MIN_SHARE = 0.05;
