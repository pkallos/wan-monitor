import type { MetricSource } from "@wan-monitor/shared";

export interface MetricRow {
  readonly timestamp: string;
  readonly source: MetricSource;
  readonly host?: string;
  readonly latency?: number;
  /** Per bucket, in aggregated queries only. */
  readonly latency_p50?: number;
  readonly latency_p95?: number;
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

export type CycleStatus = "up" | "down" | "degraded";

export interface LiveConnectivityRow {
  readonly timestamp: string;
  readonly cycle_status: CycleStatus;
}

/** Latency, loss and jitter over every ping cycle in a window; null with no cycles. */
export interface SummaryStatsRow {
  readonly latency_p50: number | null;
  readonly latency_p95: number | null;
  readonly avg_packet_loss: number | null;
  readonly avg_jitter: number | null;
}

export interface HostStatsRow {
  readonly host: string;
  readonly latency_p50: number | null;
  readonly latency_p95: number | null;
  readonly avg_packet_loss: number | null;
  readonly avg_jitter: number | null;
  /** Samples whose `connectivity_status` was not `down`. */
  readonly answered_count: number;
  readonly total_count: number;
  readonly last_status: CycleStatus;
}

/**
 * A maximal run of non-up ping cycles, as numbered by `buildQueryOutageRuns`.
 * Times are those of the first and last non-up cycle in the run.
 */
export interface OutageRunRow {
  readonly run_id: number;
  readonly start_time: string;
  readonly last_time: string;
  /** True when any cycle in the run was down rather than merely degraded. */
  readonly had_down: boolean;
  readonly max_packet_loss: number | null;
  readonly peak_latency: number | null;
}

/** A host that was down or at or over the loss floor somewhere in an outage run. */
export interface OutageHostRow {
  readonly run_id: number;
  readonly host: string;
}

/** An outage run with the hosts that were down or at or over the loss floor in it. */
export interface OutageRun extends OutageRunRow {
  readonly affected_hosts: readonly string[];
}

export interface QueryWindowParams {
  readonly startTime: Date;
  readonly endTime: Date;
}

export interface QueryOutageParams extends QueryWindowParams {
  /**
   * Longest time between two non-up cycles that still reads as one outage;
   * an up cycle between them always splits it.
   */
  readonly mergeGapMs: number;
}

export interface QueryMetricsParams {
  readonly startTime?: Date;
  readonly endTime?: Date;
  readonly host?: string;
  readonly limit?: number;
  readonly granularity?: string;
  readonly source?: MetricSource;
  /** `p50` leaves the 95th percentile out of aggregated rows, which is a pass over the window of its own. */
  readonly percentiles?: "p50" | "p50-p95";
}

export interface QuerySpeedtestsParams {
  readonly startTime?: Date;
  readonly endTime?: Date;
  readonly limit?: number;
  readonly granularity?: string;
}
