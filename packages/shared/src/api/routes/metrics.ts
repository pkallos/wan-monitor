import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Authorization } from "@shared/api/middlewares/authorization";
import { Schema } from "effect";

const GranularitySchema = Schema.Literal("1m", "5m", "15m", "1h", "6h", "1d");

const MetricSchema = Schema.Struct({
  timestamp: Schema.String,
  source: Schema.Literal("ping", "speedtest"),
  host: Schema.optional(Schema.NullOr(Schema.String)),
  latency: Schema.optional(Schema.NullOr(Schema.Number)),
  jitter: Schema.optional(Schema.NullOr(Schema.Number)),
  packet_loss: Schema.optional(Schema.NullOr(Schema.Number)),
  connectivity_status: Schema.optional(Schema.NullOr(Schema.String)),
  download_speed: Schema.optional(Schema.NullOr(Schema.Number)),
  upload_speed: Schema.optional(Schema.NullOr(Schema.Number)),
  server_location: Schema.optional(Schema.NullOr(Schema.String)),
  isp: Schema.optional(Schema.NullOr(Schema.String)),
  external_ip: Schema.optional(Schema.NullOr(Schema.String)),
  internal_ip: Schema.optional(Schema.NullOr(Schema.String)),
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

export const MetricsApiGroup = HttpApiGroup.make("metrics")
  .prefix("/metrics")
  .add(
    HttpApiEndpoint.get("getMetrics", "/")
      .setUrlParams(GetMetricsQueryParams)
      .addSuccess(GetMetricsResponse)
      .addError(Schema.String)
  )
  .middleware(Authorization);
