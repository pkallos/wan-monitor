import { DbUnavailableErrorSchema } from "@shared/api/errors";
import { Authorization } from "@shared/api/middlewares/authorization";
import { Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/unstable/httpapi";

export const ConnectivityStatusSchema = Schema.Literals([
  "up",
  "down",
  "degraded",
]);
export type ConnectivityStatus = Schema.Schema.Type<
  typeof ConnectivityStatusSchema
>;

/**
 * States the live indicator can report. Extends the historical
 * `up`/`down`/`degraded` classification with `noInfo`, which means the monitor
 * itself reported nothing inside the trailing window — silence about the WAN,
 * not an outage.
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
   * Strictly `up` cycles over all cycles; degraded cycles count against it.
   * Null when the window contains no ping cycles at all: nothing was watching,
   * so the question is unanswerable rather than answered with 0%.
   */
  uptimePercentage: Schema.NullOr(Schema.Number),
  /**
   * `up` + `degraded` cycles over all cycles — reachable-but-lossy counts as
   * available. Null under the same no-data condition as `uptimePercentage`.
   */
  availabilityPercentage: Schema.NullOr(Schema.Number),
  /** Buckets the requested window spans at the requested granularity. */
  expectedBuckets: Schema.Number,
  /** Buckets that actually contain ping cycles. Never exceeds `expectedBuckets`. */
  observedBuckets: Schema.Number,
  /**
   * `observedBuckets` over `expectedBuckets`, as a percentage. How much of the
   * window the monitor was running for, which is the denominator the uptime
   * figure is conditional on.
   */
  coveragePercentage: Schema.Number,
  /** Ping cycles observed across the window — the uptime denominator. */
  observedCycles: Schema.Number,
  /** Configured seconds between ping cycles, so callers can judge the gap size. */
  expectedSampleIntervalSeconds: Schema.Number,
});

const ConnectivityStatusResponse = Schema.Struct({
  data: Schema.Array(ConnectivityStatusPointSchema),
  meta: ConnectivityStatusMeta,
});

const GetLiveConnectivityResponse = Schema.Struct({
  status: LiveConnectivityStatusSchema,
  /** Timestamp of the newest ping cycle, or of the last one ever recorded when
   *  the window is empty. Null only when the monitor has never written a ping. */
  lastSampleAt: Schema.NullOr(Schema.String),
  /** Width of the trailing window the status was derived from, in seconds. */
  windowSeconds: Schema.Number,
});

export const GetConnectivityStatusQuery = Schema.Struct({
  startTime: Schema.optional(Schema.String),
  endTime: Schema.optional(Schema.String),
  granularity: Schema.optional(
    Schema.Literals(["1m", "5m", "15m", "1h", "6h", "1d"])
  ),
});

// Export TypeScript types derived from schemas
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
      error: [
        HttpApiSchema.status(503)(DbUnavailableErrorSchema),
        Schema.String,
      ],
    })
  )
  .add(
    HttpApiEndpoint.get("getLiveConnectivity", "/live", {
      success: GetLiveConnectivityResponse,
      error: [
        HttpApiSchema.status(503)(DbUnavailableErrorSchema),
        Schema.String,
      ],
    })
  )
  .middleware(Authorization);
