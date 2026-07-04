import type { Granularity } from "@shared/api/routes/metrics";

export const VALID_GRANULARITIES: Granularity[] = [
  "1m",
  "5m",
  "15m",
  "1h",
  "6h",
  "1d",
];

/**
 * Packet-loss classification thresholds (percentages).
 *
 * Single source of truth shared between the backend SQL classification
 * (see `buildQueryConnectivityStatus`) and the frontend status logic
 * (see `CONNECTIVITY_THRESHOLDS`). Keeping these in one place prevents
 * backend/frontend classification drift.
 */
export const PACKET_LOSS_THRESHOLDS = {
  /** Packet loss % at or above which a sample is considered degraded. */
  degradedFloor: 5,
  /** Packet loss % below which a sample is still degraded (upper bound). */
  degradedCeiling: 50,
} as const;
