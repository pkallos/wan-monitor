import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Authorization } from "@shared/api/middlewares/authorization";
import { Schema } from "effect";

const SpeedTestResult = Schema.Struct({
  downloadMbps: Schema.Number,
  uploadMbps: Schema.Number,
  pingMs: Schema.Number,
  jitter: Schema.optional(Schema.Number),
  server: Schema.optional(Schema.String),
  isp: Schema.optional(Schema.String),
  externalIp: Schema.optional(Schema.String),
});

const SpeedTestSuccessResponse = Schema.Struct({
  success: Schema.Literal(true),
  timestamp: Schema.String,
  result: SpeedTestResult,
});

const SpeedTestErrorCode = Schema.Literal(
  "SPEED_TEST_ALREADY_RUNNING",
  "SPEED_TEST_EXECUTION_FAILED",
  "SPEED_TEST_TIMEOUT"
);

const SpeedTestErrorResponse = Schema.Struct({
  success: Schema.Literal(false),
  timestamp: Schema.String,
  error: Schema.Struct({
    code: SpeedTestErrorCode,
    message: Schema.String,
  }),
});

const SpeedTestResponse = Schema.Union(
  SpeedTestSuccessResponse,
  SpeedTestErrorResponse
);

const SpeedTestStatusResponse = Schema.Struct({
  isRunning: Schema.Boolean,
});

export const SpeedMetric = Schema.Struct({
  timestamp: Schema.String,
  download_speed: Schema.Number,
  upload_speed: Schema.Number,
  latency: Schema.Number,
  jitter: Schema.optional(Schema.Number),
  server_location: Schema.optional(Schema.String),
  isp: Schema.optional(Schema.String),
  external_ip: Schema.optional(Schema.String),
  internal_ip: Schema.optional(Schema.String),
});

export const SpeedTestHistoryQuery = Schema.Struct({
  startTime: Schema.optional(Schema.String),
  endTime: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString),
});

const SpeedTestHistoryResponse = Schema.Struct({
  data: Schema.Array(SpeedMetric),
  meta: Schema.Struct({
    startTime: Schema.String,
    endTime: Schema.String,
    count: Schema.Number,
  }),
});

// Export TypeScript types derived from schemas
export type SpeedMetricFromSchema = Schema.Schema.Type<typeof SpeedMetric>;
export type SpeedTestResponseType = Schema.Schema.Type<
  typeof SpeedTestResponse
>;
export type SpeedTestHistoryResponseType = Schema.Schema.Type<
  typeof SpeedTestHistoryResponse
>;

export const SpeedTestApiGroup = HttpApiGroup.make("speedtest")
  .prefix("/speedtest")
  .add(
    HttpApiEndpoint.post("triggerSpeedTest", "/trigger")
      .addSuccess(SpeedTestResponse)
      .addError(Schema.String)
  )
  .add(
    HttpApiEndpoint.get("getSpeedTestStatus", "/status")
      .addSuccess(SpeedTestStatusResponse)
      .addError(Schema.String)
  )
  .add(
    HttpApiEndpoint.get("getSpeedTestHistory", "/history")
      .setUrlParams(SpeedTestHistoryQuery)
      .addSuccess(SpeedTestHistoryResponse)
      .addError(Schema.String)
  )
  .middleware(Authorization);
