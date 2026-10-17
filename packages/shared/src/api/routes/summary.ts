import { DbUnavailableErrorSchema, InvalidTimeRange } from "@shared/api/errors";
import { Authorization } from "@shared/api/middlewares/authorization";
import { ConnectivityStatusSchema } from "@shared/api/routes/connectivity-status";
import { IsoTimestampSchema } from "@shared/api/schemas";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";

const NullableNumber = Schema.NullOr(Schema.Number);

export const GetSummaryQuery = Schema.Struct({
  startTime: Schema.optional(IsoTimestampSchema),
  endTime: Schema.optional(IsoTimestampSchema),
});

const RangeSummarySchema = Schema.Struct({
  /** Percentiles of per-cycle latency (mean across hosts); null with no data. */
  latencyP50: NullableNumber,
  latencyP95: NullableNumber,
  avgPacketLoss: NullableNumber,
  avgJitter: NullableNumber,
  /** Same definitions as `/connectivity-status`'s meta; null with no ping cycles. */
  uptimePercentage: NullableNumber,
  availabilityPercentage: NullableNumber,
  coveragePercentage: Schema.Number,
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
   * Share of this host's ping samples that were answered, as a percentage. One
   * sample is written per host per cycle, and a lossy but answered sample
   * counts as answered.
   */
  availabilityPercentage: NullableNumber,
  /** The host's newest sample in the range: down, lossy (degraded), or up. */
  lastStatus: ConnectivityStatusSchema,
});

/** Speed figures are Mbps over successful tests; a stored 0 is a failed test. */
const SpeedSummarySchema = Schema.Struct({
  downloadMedian: NullableNumber,
  uploadMedian: NullableNumber,
  /** Tests in the range with a successful download or upload measurement. */
  count: Schema.Number,
});

const GetSummaryResponse = Schema.Struct({
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
      error: [
        InvalidTimeRange,
        HttpApiSchema.status(503)(DbUnavailableErrorSchema),
        Schema.String,
      ],
    })
  )
  .middleware(Authorization);
