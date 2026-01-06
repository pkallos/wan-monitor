import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Authorization } from "@shared/api/middlewares/authorization";
import { Schema } from "effect";

export const ConnectivityStatusSchema = Schema.Literal(
  "up",
  "down",
  "degraded"
);
export type ConnectivityStatus = Schema.Schema.Type<
  typeof ConnectivityStatusSchema
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
  uptimePercentage: Schema.Number,
});

const ConnectivityStatusResponse = Schema.Struct({
  data: Schema.Array(ConnectivityStatusPointSchema),
  meta: ConnectivityStatusMeta,
});

export const GetConnectivityStatusQuery = Schema.Struct({
  startTime: Schema.optional(Schema.String),
  endTime: Schema.optional(Schema.String),
  granularity: Schema.optional(
    Schema.Literal("1m", "5m", "15m", "1h", "6h", "1d")
  ),
});

// Export TypeScript types derived from schemas
export type ConnectivityStatusPoint = Schema.Schema.Type<
  typeof ConnectivityStatusPointSchema
>;
export type ConnectivityStatusResponseType = Schema.Schema.Type<
  typeof ConnectivityStatusResponse
>;

export const ConnectivityStatusApiGroup = HttpApiGroup.make(
  "connectivityStatus"
)
  .prefix("/connectivity-status")
  .add(
    HttpApiEndpoint.get("getConnectivityStatus", "/")
      .setUrlParams(GetConnectivityStatusQuery)
      .addSuccess(ConnectivityStatusResponse)
      .addError(Schema.String)
  )
  .middleware(Authorization);
