import { HealthUnhealthy } from "@shared/api/errors";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";

const HealthStatus = Schema.Struct({
  status: Schema.String,
  timestamp: Schema.DateTimeUtc,
});

export const HealthApiGroup = HttpApiGroup.make("health")
  .add(
    HttpApiEndpoint.get("getReady", "/ready", {
      success: HealthStatus,
      error: HealthUnhealthy,
    })
  )
  .add(
    HttpApiEndpoint.get("getLive", "/live", {
      success: HealthStatus,
      error: Schema.String,
    })
  );
