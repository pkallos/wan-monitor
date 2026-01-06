export interface PingMetric {
  timestamp: string;
  host: string;
  latency: number;
  packet_loss: number;
  connectivity_status: string;
  jitter?: number;
}

export interface SpeedMetric {
  timestamp: string;
  download_speed: number; // Mbps
  upload_speed: number; // Mbps
  latency: number; // ms
  jitter?: number; // ms
  server_location?: string;
  isp?: string;
  external_ip?: string;
  internal_ip?: string;
}

export interface Metric {
  timestamp: string;
  source: "ping" | "speedtest";
  host?: string;
  latency?: number;
  jitter?: number;
  packet_loss?: number;
  connectivity_status?: string;
  download_speed?: number;
  upload_speed?: number;
  server_location?: string;
  isp?: string;
  external_ip?: string;
  internal_ip?: string;
}

export type Granularity = "1m" | "5m" | "15m" | "1h" | "6h" | "1d";

export const VALID_GRANULARITIES: Granularity[] = [
  "1m",
  "5m",
  "15m",
  "1h",
  "6h",
  "1d",
];

export type ConnectivityStatus = "up" | "down" | "degraded";

export interface ConnectivityStatusPoint {
  timestamp: string;
  status: ConnectivityStatus;
  upPercentage: number;
  downPercentage: number;
  degradedPercentage: number;
}
