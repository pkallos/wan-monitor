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

/**
 * WAN state codes the SQL pipeline computes. Numeric because `lag()` rejects
 * STRING columns; 0 means no host has a standing ping.
 */
export const WAN_STATE = {
  noData: 0,
  up: 1,
  degraded: 2,
  down: 3,
} as const;

/** The status a state code names; null for no data. */
export const stateOf = (code: number): ConnectivityStatus | null => {
  switch (code) {
    case WAN_STATE.up:
      return "up";
    case WAN_STATE.degraded:
      return "degraded";
    case WAN_STATE.down:
      return "down";
    default:
      return null;
  }
};

/** Time spent in each state inside one ribbon bucket, in microseconds. */
export const ConnectivityStatusRowSchema = Schema.Struct({
  bucket: Schema.String,
  up_micros: PgNumber,
  degraded_micros: PgNumber,
  down_micros: PgNumber,
});
export type ConnectivityStatusRow = typeof ConnectivityStatusRowSchema.Type;

/** The state code at the query's `now`. */
export const LiveConnectivityRowSchema = Schema.Struct({
  state: PgNumber,
});
export type LiveConnectivityRow = typeof LiveConnectivityRowSchema.Type;

/** Latency, loss and jitter over every ping in a window; null with no pings. */
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
 * One host's contribution to a maximal run of degraded or down time, as
 * returned by `buildQueryOutageRuns`. The run's `start_time` and `end_time`
 * are unclipped state edges; a row exists for every host with a ping paired
 * with the run, and `affected` says whether a qualifying ping of that host
 * failed or lost packets.
 */
export const OutageRunHostRowSchema = Schema.Struct({
  run_id: PgNumber,
  start_time: Schema.String,
  end_time: Schema.String,
  /** True when any state in the run was down rather than merely degraded. */
  had_down: PgFlag,
  host: Schema.String,
  /** True when a qualifying ping of the host was down or lossy. */
  affected: PgFlag,
  max_packet_loss: NullableNumber,
  peak_latency: NullableNumber,
});
export type OutageRunHostRow = typeof OutageRunHostRowSchema.Type;

/** An outage run with the hosts that failed or lost packets in it. */
export interface OutageRun {
  readonly run_id: number;
  readonly start_time: string;
  readonly end_time: string;
  readonly had_down: boolean;
  readonly max_packet_loss: number | null;
  readonly peak_latency: number | null;
  readonly affected_hosts: readonly string[];
}

/** The column holding `kind` time for the `index`th window of `buildQueryWindowUptime`. */
export const windowColumn = (kind: "up" | "observed", index: number): string =>
  `${kind}_${index}`;

/** The one row of `buildQueryWindowUptime`: `up_<i>` and `observed_<i>` microseconds per window. */
export const WindowUptimeRowSchema = Schema.Record(
  Schema.String,
  NullableNumber
);
export type WindowUptimeRow = typeof WindowUptimeRowSchema.Type;

/** Time a trailing window spent up, and time it was observed at all, in microseconds. */
export interface WindowUptime {
  readonly up_micros: number;
  readonly observed_micros: number;
}

/** A single timestamp aggregate, null when no row matched. */
export const TimestampRowSchema = Schema.Struct({
  timestamp: Schema.NullOr(Schema.String),
});

export interface QueryWindowParams {
  readonly startTime: Date;
  readonly endTime: Date;
}

/** A window together with what the WAN state pipeline needs to read it. */
export interface QueryStateParams extends QueryWindowParams {
  /** The reading clock: nothing is observed past it. */
  readonly nowMs: number;
  readonly intervalMs: number;
  /** `PING_HOSTS`: hosts whose missing round is bridged. */
  readonly hosts: readonly string[];
}

export interface QueryConnectivityParams extends QueryStateParams {
  readonly granularity: Granularity;
}

export interface QueryWindowUptimeParams
  extends Omit<QueryStateParams, "startTime"> {
  /** Start of each trailing window; `endTime` is shared. */
  readonly windowStartTimes: readonly Date[];
}

export interface QueryMetricsParams extends QueryWindowParams {
  readonly host?: string;
  readonly limit?: number;
  readonly granularity?: Granularity;
  readonly source?: MetricSource;
  /** `p50` leaves the 95th percentile out of aggregated rows, since computing it takes a pass over the window of its own. */
  readonly percentiles?: "p50" | "p50-p95";
}

export interface QuerySpeedtestsParams extends QueryWindowParams {
  readonly limit?: number;
  readonly granularity?: Granularity;
}
