import { Schema } from 'effect';

// Connectivity status enum
export const ConnectivityStatus = Schema.Literal('up', 'down', 'degraded');
export type ConnectivityStatus = typeof ConnectivityStatus.Type;

// Network metric schema
export const NetworkMetric = Schema.Struct({
  timestamp: Schema.Date,
  source: Schema.Literal('ping', 'speedtest'),
  host: Schema.optional(Schema.String),
  latency: Schema.optional(Schema.Number),
  jitter: Schema.optional(Schema.Number),
  packetLoss: Schema.optional(Schema.Number),
  downloadBandwidth: Schema.optional(Schema.Number),
  uploadBandwidth: Schema.optional(Schema.Number),
  connectivityStatus: Schema.optional(ConnectivityStatus),
  serverLocation: Schema.optional(Schema.String),
  isp: Schema.optional(Schema.String),
});
export type NetworkMetric = typeof NetworkMetric.Type;

// Database health status
export const DatabaseHealth = Schema.Struct({
  connected: Schema.Boolean,
  version: Schema.optional(Schema.String),
  uptime: Schema.optional(Schema.Number),
});
export type DatabaseHealth = typeof DatabaseHealth.Type;
