import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Authorization } from "@shared/api/middlewares/authorization";
import { Schema } from "effect";

const ConnectivityStatus = Schema.Literal("up", "down", "degraded");

const ConnectivityStatusPoint = Schema.Struct({
  timestamp: Schema.String,
  status: ConnectivityStatus,
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
  data: Schema.Array(ConnectivityStatusPoint),
  meta: ConnectivityStatusMeta,
});

const Granularity = Schema.Literal("1m", "5m", "15m", "1h", "6h", "1d");

const GetConnectivityStatusQuery = Schema.Struct({
  startTime: Schema.optional(Schema.String),
  endTime: Schema.optional(Schema.String),
  granularity: Schema.optional(Granularity),
});

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
