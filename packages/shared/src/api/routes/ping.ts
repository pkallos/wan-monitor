import { Authorization } from "@shared/api/middlewares/authorization";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

const PingResult = Schema.Struct({
  host: Schema.String,
  alive: Schema.Boolean,
  latency: Schema.optional(Schema.Number),
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
  /** Set when the result row could not be stored; independent of `success`. */
  writeError: Schema.optional(Schema.String),
});

const TriggerPingRequest = Schema.Struct({
  hosts: Schema.optional(Schema.Array(Schema.String)),
});

export const TriggerPingResponse = Schema.Struct({
  success: Schema.Boolean,
  timestamp: Schema.String,
  results: Schema.Array(PingExecutionResult),
});

export const GetHostsResponse = Schema.Struct({
  hosts: Schema.Array(Schema.String),
  /** Configured seconds between ping rounds. */
  pingIntervalSeconds: Schema.Number,
  /** Configured seconds between scheduled speed tests. */
  speedtestIntervalSeconds: Schema.Number,
});

export const PingApiGroup = HttpApiGroup.make("ping")
  .prefix("/ping")
  .add(
    HttpApiEndpoint.post("triggerPing", "/trigger", {
      payload: Schema.NullOr(TriggerPingRequest),
      success: TriggerPingResponse,
    })
  )
  .add(
    HttpApiEndpoint.get("getHosts", "/hosts", {
      success: GetHostsResponse,
    })
  )
  .middleware(Authorization);

export type GetHostsResponseType = Schema.Schema.Type<typeof GetHostsResponse>;
