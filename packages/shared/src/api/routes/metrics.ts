import { DbUnavailableErrorSchema, InvalidTimeRange } from "@shared/api/errors";
import { Authorization } from "@shared/api/middlewares/authorization";
import {
  IsoTimestampSchema,
  PositiveIntFromStringSchema,
} from "@shared/api/schemas";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";

export const GranularitySchema = Schema.Literals([
  "1m",
  "5m",
  "15m",
  "1h",
  "6h",
  "1d",
]);
export type Granularity = Schema.Schema.Type<typeof GranularitySchema>;

const MetricSourceSchema = Schema.Literals(["ping", "speedtest"]);
export type MetricSource = Schema.Schema.Type<typeof MetricSourceSchema>;

const PercentilesSchema = Schema.Literals(["p50", "p50-p95"]);

export const MetricSchema = Schema.Struct({
  timestamp: Schema.String,
  source: MetricSourceSchema,
  host: Schema.optional(Schema.String),
  latency: Schema.optional(Schema.Number),
  /** Per-bucket percentiles of latency, present on aggregated rows only. */
  latency_p50: Schema.optional(Schema.Number),
  latency_p95: Schema.optional(Schema.Number),
  jitter: Schema.optional(Schema.Number),
  packet_loss: Schema.optional(Schema.Number),
  connectivity_status: Schema.optional(Schema.String),
  download_speed: Schema.optional(Schema.Number),
  upload_speed: Schema.optional(Schema.Number),
  server_location: Schema.optional(Schema.String),
  isp: Schema.optional(Schema.String),
  external_ip: Schema.optional(Schema.String),
  internal_ip: Schema.optional(Schema.String),
});

const MetaSchema = Schema.Struct({
  startTime: Schema.String,
  endTime: Schema.String,
  count: Schema.Number,
});

export const GetMetricsQueryParams = Schema.Struct({
  startTime: Schema.optional(IsoTimestampSchema),
  endTime: Schema.optional(IsoTimestampSchema),
  host: Schema.optional(Schema.String),
  limit: Schema.optional(PositiveIntFromStringSchema),
  granularity: Schema.optional(GranularitySchema),
  // Aggregated queries need this to get one row per bucket. See
  // `buildQueryMetrics`.
  source: Schema.optional(MetricSourceSchema),
  // `p50-p95` (the default) is the all-hosts band; `p50` skips the 95th
  // percentile for callers that draw only the median.
  percentiles: Schema.optional(PercentilesSchema),
});

const GetMetricsResponse = Schema.Struct({
  data: Schema.Array(MetricSchema),
  meta: MetaSchema,
});

const GetEarliestTimestampResponse = Schema.Struct({
  timestamp: Schema.NullOr(Schema.String),
});

// Export TypeScript types derived from schemas
export type Metric = Schema.Schema.Type<typeof MetricSchema>;
export type GetMetricsResponseType = Schema.Schema.Type<
  typeof GetMetricsResponse
>;
export type GetEarliestTimestampResponseType = Schema.Schema.Type<
  typeof GetEarliestTimestampResponse
>;

export const MetricsApiGroup = HttpApiGroup.make("metrics")
  .prefix("/metrics")
  .add(
    HttpApiEndpoint.get("getMetrics", "/", {
      query: GetMetricsQueryParams,
      success: GetMetricsResponse,
      error: [
        InvalidTimeRange,
        HttpApiSchema.status(503)(DbUnavailableErrorSchema),
        Schema.String,
      ],
    })
  )
  .add(
    HttpApiEndpoint.get("getEarliestTimestamp", "/earliest", {
      success: GetEarliestTimestampResponse,
      error: [
        HttpApiSchema.status(503)(DbUnavailableErrorSchema),
        Schema.String,
      ],
    })
  )
  .middleware(Authorization);
