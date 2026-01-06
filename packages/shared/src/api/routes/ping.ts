import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Authorization } from "@shared/api/middlewares/authorization";
import { Schema } from "effect";

const PingResult = Schema.Struct({
  host: Schema.String,
  alive: Schema.Boolean,
  latency: Schema.Number,
  packetLoss: Schema.Number,
  min: Schema.optional(Schema.Number),
  max: Schema.optional(Schema.Number),
  avg: Schema.optional(Schema.Number),
  stddev: Schema.optional(Schema.Number),
});

const PingExecutionResult = Schema.Struct({
  host: Schema.String,
  success: Schema.Boolean,
  result: Schema.optional(PingResult),
  error: Schema.optional(Schema.String),
});

const TriggerPingRequest = Schema.Struct({
  hosts: Schema.optional(Schema.Array(Schema.String)),
});

const TriggerPingResponse = Schema.Struct({
  success: Schema.Boolean,
  timestamp: Schema.String,
  results: Schema.Array(PingExecutionResult),
});

const GetHostsResponse = Schema.Struct({
  hosts: Schema.Array(Schema.String),
});

export const PingApiGroup = HttpApiGroup.make("ping")
  .prefix("/ping")
  .add(
    HttpApiEndpoint.post("triggerPing", "/trigger")
      .setPayload(Schema.NullOr(TriggerPingRequest))
      .addSuccess(TriggerPingResponse)
      .addError(Schema.String)
  )
  .add(
    HttpApiEndpoint.get("getHosts", "/hosts")
      .addSuccess(GetHostsResponse)
      .addError(Schema.String)
  )
  .middleware(Authorization);
