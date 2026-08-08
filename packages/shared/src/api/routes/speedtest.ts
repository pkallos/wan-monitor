import { DbUnavailableErrorSchema } from "@shared/api/errors";
import { Authorization } from "@shared/api/middlewares/authorization";
import { GranularitySchema } from "@shared/api/routes/metrics";
import { Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/unstable/httpapi";

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

const SpeedTestErrorCode = Schema.Literals([
  "SPEED_TEST_ALREADY_RUNNING",
  "SPEED_TEST_EXECUTION_FAILED",
  "SPEED_TEST_TIMEOUT",
]);

const SpeedTestErrorResponse = Schema.Struct({
  success: Schema.Literal(false),
  timestamp: Schema.String,
  error: Schema.Struct({
    code: SpeedTestErrorCode,
    message: Schema.String,
  }),
});

const SpeedTestResponse = Schema.Union([
  SpeedTestSuccessResponse,
  SpeedTestErrorResponse,
]);

const SpeedTestStatusResponse = Schema.Struct({
  isRunning: Schema.Boolean,
});

/**
 * A stored speed test reading. The three measurements are optional because a
 * partial result is a real thing to record: absent means the value was never
 * measured, which is distinct from a measured 0.
 */
export const SpeedMetricSchema = Schema.Struct({
  timestamp: Schema.String,
  download_speed: Schema.optional(Schema.Number),
  upload_speed: Schema.optional(Schema.Number),
  latency: Schema.optional(Schema.Number),
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
  granularity: Schema.optional(GranularitySchema),
});

const SpeedTestHistoryResponse = Schema.Struct({
  data: Schema.Array(SpeedMetricSchema),
  meta: Schema.Struct({
    startTime: Schema.String,
    endTime: Schema.String,
    count: Schema.Number,
  }),
});

// Export TypeScript types derived from schemas
export type SpeedMetric = Schema.Schema.Type<typeof SpeedMetricSchema>;
export type SpeedTestResponseType = Schema.Schema.Type<
  typeof SpeedTestResponse
>;
export type SpeedTestHistoryResponseType = Schema.Schema.Type<
  typeof SpeedTestHistoryResponse
>;

export const SpeedTestApiGroup = HttpApiGroup.make("speedtest")
  .prefix("/speedtest")
  .add(
    HttpApiEndpoint.post("triggerSpeedTest", "/trigger", {
      success: SpeedTestResponse,
      error: Schema.String,
    })
  )
  .add(
    HttpApiEndpoint.get("getSpeedTestStatus", "/status", {
      success: SpeedTestStatusResponse,
      error: Schema.String,
    })
  )
  .add(
    HttpApiEndpoint.get("getSpeedTestHistory", "/history", {
      query: SpeedTestHistoryQuery,
      success: SpeedTestHistoryResponse,
      error: [
        HttpApiSchema.status(503)(DbUnavailableErrorSchema),
        Schema.String,
      ],
    })
  )
  .middleware(Authorization);
