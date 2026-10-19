import {
  DbUnavailable,
  InternalError,
  InvalidTimeRange,
} from "@shared/api/errors";
import { Authorization } from "@shared/api/middlewares/authorization";
import { GranularitySchema } from "@shared/api/routes/metrics";
import { IsoTimestampSchema } from "@shared/api/schemas";
import { ConnectivityStatusSchema } from "@shared/metrics";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

/**
 * The states the live indicator can report: `up`, `down` and `degraded`, plus
 * `noInfo`, which means no host has a standing ping. It signals silence about
 * the WAN, not an outage.
 */
export const LiveConnectivityStatusSchema = Schema.Literals([
  "up",
  "down",
  "degraded",
  "noInfo",
]);
export type LiveConnectivityStatus = Schema.Schema.Type<
  typeof LiveConnectivityStatusSchema
>;

export const ConnectivityStatusPointSchema = Schema.Struct({
  timestamp: Schema.String,
  status: ConnectivityStatusSchema,
  upPercentage: Schema.Number,
  downPercentage: Schema.Number,
  degradedPercentage: Schema.Number,
});

const ConnectivityStatusMeta = Schema.Struct({
  startTime: Schema.String,
  endTime: Schema.String,
  count: Schema.Number,
  /**
   * Time that was up over the window's monitored time; degraded time counts
   * against it. Null when the window holds no monitored time at all: nothing
   * was watching, so the question is unanswerable rather than answered with 0%.
   */
  uptimePercentage: Schema.NullOr(Schema.Number),
  /**
   * Up plus degraded time over monitored time: reachable-but-lossy counts as
   * available. Null under the same no-data condition as `uptimePercentage`.
   */
  availabilityPercentage: Schema.NullOr(Schema.Number),
  /** Number of buckets the requested window touches at the requested granularity, partial first and last buckets included. */
  expectedBuckets: Schema.Number,
  /** Buckets that hold monitored time. */
  observedBuckets: Schema.Number,
  /**
   * `observedBuckets` over `expectedBuckets`, as a percentage capped at 100.
   * How much of the window the monitor held data for. The uptime figure covers
   * only that time.
   */
  coveragePercentage: Schema.Number,
  /** Seconds of the window with ping data: the uptime denominator. */
  observedSeconds: Schema.Number,
  /** Configured seconds between ping rounds, so callers can judge the gap size. */
  expectedSampleIntervalSeconds: Schema.Number,
});

const OutageSchema = Schema.Struct({
  start: Schema.String,
  end: Schema.String,
  durationSeconds: Schema.Number,
  /** Worst state in the outage: `down` if any of its time was down. */
  status: Schema.Literals(["down", "degraded"]),
  /** Hosts that failed or lost packets for a meaningful part of the outage. */
  affectedHosts: Schema.Array(Schema.String),
  maxPacketLoss: Schema.Number,
  /** Highest latency reading during the outage; null when every ping failed. */
  peakLatency: Schema.NullOr(Schema.Number),
});

export const GetOutagesResponse = Schema.Struct({
  /** Newest first, capped at a server-side maximum. */
  data: Schema.Array(OutageSchema),
  meta: Schema.Struct({
    startTime: Schema.String,
    endTime: Schema.String,
    count: Schema.Number,
    /** Outages found before the cap was applied. */
    totalCount: Schema.Number,
  }),
});

const ConnectivityStatusResponse = Schema.Struct({
  data: Schema.Array(ConnectivityStatusPointSchema),
  meta: ConnectivityStatusMeta,
});

const GetLiveConnectivityResponse = Schema.Struct({
  status: LiveConnectivityStatusSchema,
  /** Timestamp of the newest ping row ever recorded. Null only when the
   *  monitor has never written a ping. */
  lastSampleAt: Schema.NullOr(Schema.String),
  /** How long the newest ping stands with no newer one, at the configured
   *  interval, in seconds. */
  windowSeconds: Schema.Number,
});

export const GetConnectivityStatusQuery = Schema.Struct({
  startTime: Schema.optional(IsoTimestampSchema),
  endTime: Schema.optional(IsoTimestampSchema),
  granularity: Schema.optional(GranularitySchema),
});

export const GetOutagesQuery = Schema.Struct({
  startTime: Schema.optional(IsoTimestampSchema),
  endTime: Schema.optional(IsoTimestampSchema),
});

// Export TypeScript types derived from schemas
export type Outage = Schema.Schema.Type<typeof OutageSchema>;
export type GetOutagesResponseType = Schema.Schema.Type<
  typeof GetOutagesResponse
>;
export type ConnectivityStatusPoint = Schema.Schema.Type<
  typeof ConnectivityStatusPointSchema
>;
export type ConnectivityStatusResponseType = Schema.Schema.Type<
  typeof ConnectivityStatusResponse
>;
export type GetLiveConnectivityResponseType = Schema.Schema.Type<
  typeof GetLiveConnectivityResponse
>;

export const ConnectivityStatusApiGroup = HttpApiGroup.make(
  "connectivityStatus"
)
  .prefix("/connectivity-status")
  .add(
    HttpApiEndpoint.get("getConnectivityStatus", "/", {
      query: GetConnectivityStatusQuery,
      success: ConnectivityStatusResponse,
      error: [InvalidTimeRange, DbUnavailable, InternalError],
    })
  )
  .add(
    HttpApiEndpoint.get("getLiveConnectivity", "/live", {
      success: GetLiveConnectivityResponse,
      error: [DbUnavailable, InternalError],
    })
  )
  .add(
    HttpApiEndpoint.get("getOutages", "/outages", {
      query: GetOutagesQuery,
      success: GetOutagesResponse,
      error: [InvalidTimeRange, DbUnavailable, InternalError],
    })
  )
  .middleware(Authorization);
