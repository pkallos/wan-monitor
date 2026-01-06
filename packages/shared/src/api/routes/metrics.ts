import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Authorization } from "@shared/api/middlewares/authorization";
import { Schema } from "effect";

export const GranularitySchema = Schema.Literal(
  "1m",
  "5m",
  "15m",
  "1h",
  "6h",
  "1d"
);
export type Granularity = Schema.Schema.Type<typeof GranularitySchema>;

export const MetricSchema = Schema.Struct({
  timestamp: Schema.String,
  source: Schema.Literal("ping", "speedtest"),
  host: Schema.optional(Schema.String),
  latency: Schema.optional(Schema.Number),
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
  startTime: Schema.optional(Schema.String),
  endTime: Schema.optional(Schema.String),
  host: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString),
  granularity: Schema.optional(GranularitySchema),
});

const GetMetricsResponse = Schema.Struct({
  data: Schema.Array(MetricSchema),
  meta: MetaSchema,
});

// Export TypeScript types derived from schemas
export type Metric = Schema.Schema.Type<typeof MetricSchema>;
export type GetMetricsResponseType = Schema.Schema.Type<
  typeof GetMetricsResponse
>;

export const MetricsApiGroup = HttpApiGroup.make("metrics")
  .prefix("/metrics")
  .add(
    HttpApiEndpoint.get("getMetrics", "/")
      .setUrlParams(GetMetricsQueryParams)
      .addSuccess(GetMetricsResponse)
      .addError(Schema.String)
  )
  .middleware(Authorization);
