import {
  DbUnavailable,
  InternalError,
  InvalidTimeRange,
} from "@shared/api/errors";
import { Authorization } from "@shared/api/middlewares/authorization";
import { GranularitySchema } from "@shared/api/routes/metrics";
import {
  IsoTimestampSchema,
  PositiveIntFromStringSchema,
} from "@shared/api/schemas";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

const SpeedTestResult = Schema.Struct({
  downloadMbps: Schema.optional(Schema.Number),
  uploadMbps: Schema.optional(Schema.Number),
  pingMs: Schema.optional(Schema.Number),
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
  startTime: Schema.optional(IsoTimestampSchema),
  endTime: Schema.optional(IsoTimestampSchema),
  limit: Schema.optional(PositiveIntFromStringSchema),
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
    })
  )
  .add(
    HttpApiEndpoint.get("getSpeedTestStatus", "/status", {
      success: SpeedTestStatusResponse,
    })
  )
  .add(
    HttpApiEndpoint.get("getSpeedTestHistory", "/history", {
      query: SpeedTestHistoryQuery,
      success: SpeedTestHistoryResponse,
      error: [InvalidTimeRange, DbUnavailable, InternalError],
    })
  )
  .middleware(Authorization);
