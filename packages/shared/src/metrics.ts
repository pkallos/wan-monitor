import { Schema } from "effect";

// ============================================================================
// Bandwidth Unit Conversion Helpers
// ============================================================================

/**
 * Convert Megabits per second (Mbps) to bits per second (bps).
 * SpeedTest services typically report in Mbps, but we store in bps for precision.
 *
 * @param mbps - Speed in Megabits per second
 * @returns Speed in bits per second (rounded to nearest integer)
 */
export const mbpsToBps = (mbps: number): number => Math.round(mbps * 1_000_000);

/**
 * Convert bits per second (bps) to Megabits per second (Mbps).
 *
 * @param bps - Speed in bits per second
 * @returns Speed in Megabits per second
 */
export const bpsToMbps = (bps: number): number => bps / 1_000_000;

// ============================================================================
// Schemas
// ============================================================================

// Connectivity status enum
export const ConnectivityStatus = Schema.Literal("up", "down", "degraded");
export type ConnectivityStatus = typeof ConnectivityStatus.Type;

// Network metric schema
export const NetworkMetric = Schema.Struct({
  timestamp: Schema.Date,
  source: Schema.Literal("ping", "speedtest"),
  host: Schema.optional(Schema.String),
  latency: Schema.optional(Schema.Number),
  jitter: Schema.optional(Schema.Number),
  packetLoss: Schema.optional(Schema.Number),
  downloadBandwidth: Schema.optional(Schema.Number),
  uploadBandwidth: Schema.optional(Schema.Number),
  connectivityStatus: Schema.optional(ConnectivityStatus),
  serverLocation: Schema.optional(Schema.String),
  isp: Schema.optional(Schema.String),
  externalIp: Schema.optional(Schema.String),
  internalIp: Schema.optional(Schema.String),
});
export type NetworkMetric = typeof NetworkMetric.Type;

// Database health status
export const DatabaseHealth = Schema.Struct({
  connected: Schema.Boolean,
  version: Schema.optional(Schema.String),
  uptime: Schema.optional(Schema.Number),
});
export type DatabaseHealth = typeof DatabaseHealth.Type;
