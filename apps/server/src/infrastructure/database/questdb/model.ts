import {
  type ConnectivityStatus,
  ConnectivityStatusSchema,
  type MetricSource,
  MetricSourceSchema,
} from "@shared/metrics";
import type { Granularity } from "@wan-monitor/shared";
import { Schema, SchemaGetter } from "effect";

// pg hands LONG (int8) results, which include count() and SUM(), back as
// strings and DOUBLE results as numbers, so every numeric column accepts both.
const PgNumber = Schema.Union([Schema.Finite, Schema.FiniteFromString]);
const NullableNumber = Schema.NullOr(PgNumber);
const OptionalNumber = Schema.optional(NullableNumber);
const OptionalText = Schema.optional(Schema.NullOr(Schema.String));

const PgFlag = PgNumber.pipe(
  Schema.decodeTo(Schema.Boolean, {
    decode: SchemaGetter.transform((value) => value > 0),
    encode: SchemaGetter.transform((flag) => (flag ? 1 : 0)),
  })
);

/** A metric row from the raw or aggregated queries; a column the query does not project is absent. */
export const MetricRowSchema = Schema.Struct({
  timestamp: Schema.String,
  source: MetricSourceSchema,
  host: OptionalText,
  latency: OptionalNumber,
  latency_p50: OptionalNumber,
  latency_p95: OptionalNumber,
  jitter: OptionalNumber,
  packet_loss: OptionalNumber,
  connectivity_status: Schema.optional(Schema.NullOr(ConnectivityStatusSchema)),
  download_bandwidth: OptionalNumber,
  upload_bandwidth: OptionalNumber,
  server_location: OptionalText,
  isp: OptionalText,
  external_ip: OptionalText,
  internal_ip: OptionalText,
});

export const ConnectivityStatusRowSchema = Schema.Struct({
  timestamp: Schema.String,
  up_count: PgNumber,
  down_count: PgNumber,
  degraded_count: PgNumber,
  total_count: PgNumber,
});
export type ConnectivityStatusRow = typeof ConnectivityStatusRowSchema.Type;

export type CycleStatus = ConnectivityStatus;

export const LiveConnectivityRowSchema = Schema.Struct({
  timestamp: Schema.String,
  cycle_status: ConnectivityStatusSchema,
});
export type LiveConnectivityRow = typeof LiveConnectivityRowSchema.Type;

/** Latency, loss and jitter over every ping cycle in a window; null with no cycles. */
export const SummaryStatsRowSchema = Schema.Struct({
  latency_p50: NullableNumber,
  latency_p95: NullableNumber,
  avg_packet_loss: NullableNumber,
  avg_jitter: NullableNumber,
});
export type SummaryStatsRow = typeof SummaryStatsRowSchema.Type;

export const HostStatsRowSchema = Schema.Struct({
  host: Schema.String,
  latency_p50: NullableNumber,
  latency_p95: NullableNumber,
  avg_packet_loss: NullableNumber,
  avg_jitter: NullableNumber,
  /** Samples whose `connectivity_status` was not `down`. */
  answered_count: PgNumber,
  total_count: PgNumber,
  last_status: ConnectivityStatusSchema,
});
export type HostStatsRow = typeof HostStatsRowSchema.Type;

/**
 * A maximal run of non-up ping cycles, as numbered by `buildQueryOutageRuns`.
 * Times are those of the first and last non-up cycle in the run.
 */
export const OutageRunRowSchema = Schema.Struct({
  run_id: PgNumber,
  start_time: Schema.String,
  last_time: Schema.String,
  /** The up cycle recorded within the merge gap after the run, if there was one. */
  recovered_time: Schema.NullOr(Schema.String),
  /** True when any cycle in the run was down rather than merely degraded. */
  had_down: PgFlag,
  max_packet_loss: NullableNumber,
  peak_latency: NullableNumber,
});
export type OutageRunRow = typeof OutageRunRowSchema.Type;

/** A host that was down or at or over the loss floor somewhere in an outage run. */
export const OutageHostRowSchema = Schema.Struct({
  run_id: PgNumber,
  host: Schema.String,
});
export type OutageHostRow = typeof OutageHostRowSchema.Type;

/** An outage run with the hosts that were down or at or over the loss floor in it. */
export interface OutageRun extends OutageRunRow {
  readonly affected_hosts: readonly string[];
}

/** The median gap between ping cycles; null when the window holds fewer than two. */
export const CyclePeriodRowSchema = Schema.Struct({
  period_micros: NullableNumber,
});

/** A single timestamp aggregate, null when no row matched. */
export const TimestampRowSchema = Schema.Struct({
  timestamp: Schema.NullOr(Schema.String),
});

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

export interface QueryMetricsParams extends QueryWindowParams {
  readonly host?: string;
  readonly limit?: number;
  readonly granularity?: Granularity;
  readonly source?: MetricSource;
  /** `p50` leaves the 95th percentile out of aggregated rows, which is a pass over the window of its own. */
  readonly percentiles?: "p50" | "p50-p95";
}

export interface QuerySpeedtestsParams extends QueryWindowParams {
  readonly limit?: number;
  readonly granularity?: Granularity;
}
