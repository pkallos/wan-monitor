import type { Granularity } from "@shared/api/routes/metrics";

/**
 * Granularity used when a request doesn't name one. The connectivity handler
 * resolves it once and passes it to both the query and the coverage
 * calculation, so the two use the same bucket grid.
 */
export const DEFAULT_GRANULARITY: Granularity = "5m";

/**
 * Packet-loss classification thresholds (percentages).
 *
 * Single source of truth for connectivity classification. The backend state
 * pipeline (`wan-state.ts`) reads `degradedFloor` directly, so the percentages
 * the API returns already carry this classification and the frontend renders
 * them as-is.
 */
export const PACKET_LOSS_THRESHOLDS = {
  /**
   * Packet loss % at or above which a sample is considered degraded. Matches
   * the ping train's own quantization (`PING_TRAIN_COUNT` default 10 packets,
   * so loss lands on 10% steps) — anything smaller wouldn't be expressible.
   */
  degradedFloor: 10,
} as const;

/** Floor for the live connectivity window, in seconds. */
export const LIVE_WINDOW_MIN_SECONDS = 60;

/**
 * The number of ping intervals the newest ping may stand before it lapses. It
 * equals the state pipeline's hold bound when a host's spacing is the
 * configured interval.
 */
export const LIVE_WINDOW_PING_MULTIPLIER = 2.5;

/**
 * Seconds the newest ping may stand before the live status stops reporting it.
 * The dashboard also uses this window as the slack before an open incident
 * reads as ended.
 */
export const liveConnectivityWindowSeconds = (
  pingIntervalSeconds: number
): number =>
  Math.max(
    LIVE_WINDOW_MIN_SECONDS,
    LIVE_WINDOW_PING_MULTIPLIER * pingIntervalSeconds
  );

/**
 * Minimum share of a rollup bucket's monitored time that must be degraded
 * before the bucket itself reads as "degraded" (see
 * `getConnectivityStatusHandler`). Without this floor, a few seconds of
 * degraded time taints an entire bucket regardless of how much time it spans,
 * which over a coarse rollup turns one transient blip into a wide orange
 * region.
 */
export const DEGRADED_BUCKET_MIN_SHARE = 0.05;

/**
 * Widest window, in days, the outage log accepts. The log reads every ping
 * row in its window, so this bounds the query; a wider request is a 400.
 */
export const MAX_OUTAGE_SPAN_DAYS = 90;
