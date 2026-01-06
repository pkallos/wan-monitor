import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Schema } from "effect";

const HealthStatus = Schema.Struct({
  status: Schema.String,
  timestamp: Schema.DateTimeUtc,
});

export const HealthApiGroup = HttpApiGroup.make("health")
  .add(
    HttpApiEndpoint.get("getReady")`/ready`
      .addError(Schema.String)
      .addSuccess(HealthStatus)
  )
  .add(
    HttpApiEndpoint.get("getLive")`/live`
      .addError(Schema.String)
      .addSuccess(HealthStatus)
  );
