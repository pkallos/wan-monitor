import {
  DbUnavailable,
  InternalError,
  InvalidTimeRange,
} from "@shared/api/errors";
import { Authorization } from "@shared/api/middlewares/authorization";
import { IsoTimestampSchema } from "@shared/api/schemas";
import { ConnectivityStatusSchema } from "@shared/metrics";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

const NullableNumber = Schema.NullOr(Schema.Number);

export const GetSummaryQuery = Schema.Struct({
  startTime: Schema.optional(IsoTimestampSchema),
  endTime: Schema.optional(IsoTimestampSchema),
});

const RangeSummarySchema = Schema.Struct({
  /** Approximate percentiles of latency over every ping in the range; null with no data. */
  latencyP50: NullableNumber,
  latencyP95: NullableNumber,
  avgPacketLoss: NullableNumber,
  avgJitter: NullableNumber,
});

const UptimeWindowSchema = Schema.Struct({
  uptimePercentage: NullableNumber,
});

const HostSummarySchema = Schema.Struct({
  host: Schema.String,
  latencyP50: NullableNumber,
  latencyP95: NullableNumber,
  avgPacketLoss: NullableNumber,
  avgJitter: NullableNumber,
  /**
   * Share of this host's pings that were answered, as a percentage. A lossy
   * but answered ping counts as answered.
   */
  availabilityPercentage: NullableNumber,
  /** The host's newest ping in the range: down, lossy (degraded), or up. */
  lastStatus: ConnectivityStatusSchema,
});

/** Speed figures are Mbps over the tests that took a reading. */
const SpeedSummarySchema = Schema.Struct({
  downloadMedian: NullableNumber,
  uploadMedian: NullableNumber,
  /** Tests in the range with a successful download or upload measurement. */
  count: Schema.Number,
});

export const GetSummaryResponse = Schema.Struct({
  range: RangeSummarySchema,
  windows: Schema.Struct({
    last24h: UptimeWindowSchema,
    last7d: UptimeWindowSchema,
    last30d: UptimeWindowSchema,
  }),
  hosts: Schema.Array(HostSummarySchema),
  speed: SpeedSummarySchema,
  meta: Schema.Struct({
    startTime: Schema.String,
    endTime: Schema.String,
  }),
});

export type RangeSummary = Schema.Schema.Type<typeof RangeSummarySchema>;
export type HostSummary = Schema.Schema.Type<typeof HostSummarySchema>;
export type SpeedSummary = Schema.Schema.Type<typeof SpeedSummarySchema>;
export type GetSummaryResponseType = Schema.Schema.Type<
  typeof GetSummaryResponse
>;

export const SummaryApiGroup = HttpApiGroup.make("summary")
  .prefix("/summary")
  .add(
    HttpApiEndpoint.get("getSummary", "/", {
      query: GetSummaryQuery,
      success: GetSummaryResponse,
      error: [InvalidTimeRange, DbUnavailable, InternalError],
    })
  )
  .middleware(Authorization);
