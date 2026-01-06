import type { Granularity } from "@shared/api";

export interface MetricRow {
  readonly timestamp: string;
  readonly source: "ping" | "speedtest";
  readonly host?: string;
  readonly latency?: number;
  readonly jitter?: number;
  readonly packet_loss?: number;
  readonly connectivity_status?: string;
  readonly download_speed?: number;
  readonly upload_speed?: number;
  readonly server_location?: string;
  readonly isp?: string;
  readonly external_ip?: string;
  readonly internal_ip?: string;
}

export interface ConnectivityStatusRow {
  readonly timestamp: string;
  readonly up_count: number;
  readonly down_count: number;
  readonly degraded_count: number;
  readonly total_count: number;
}

export interface QueryMetricsParams {
  readonly startTime?: Date;
  readonly endTime?: Date;
  readonly host?: string;
  readonly limit?: number;
  readonly granularity?: Granularity;
}

export interface QuerySpeedtestsParams {
  readonly startTime?: Date;
  readonly endTime?: Date;
  readonly limit?: number;
}
