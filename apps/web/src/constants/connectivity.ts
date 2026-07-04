import { PACKET_LOSS_THRESHOLDS } from "@wan-monitor/shared";

/**
 * Connectivity status colors
 * Using Chakra UI color values for consistency
 */
export const CONNECTIVITY_COLORS = {
  up: "#38a169", // green.500
  degraded: "#d69e2e", // yellow.500
  down: "#e53e3e", // red.500
  noInfo: "#718096", // gray.500
} as const;

/**
 * Connectivity status labels
 */
export const CONNECTIVITY_LABELS = {
  up: "Up",
  degraded: "Degraded",
  down: "Down",
  noInfo: "No Data",
} as const;

/**
 * Thresholds for determining connectivity status
 */
export const CONNECTIVITY_THRESHOLDS = {
  /** Percentage threshold for considering a status dominant */
  dominantStatusPercentage: 50,
  /** Packet loss percentage threshold for degraded status */
  degradedPacketLoss: PACKET_LOSS_THRESHOLDS.degradedFloor,
  /** Maximum packet loss percentage for degraded status */
  maxDegradedPacketLoss: PACKET_LOSS_THRESHOLDS.degradedCeiling,
  /** Gap detection multiplier (gaps larger than this * interval are filled) */
  gapDetectionMultiplier: 1.5,
} as const;

export type ConnectivityStatus = keyof typeof CONNECTIVITY_COLORS;
