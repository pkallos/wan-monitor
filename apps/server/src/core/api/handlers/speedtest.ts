import { WanMonitorApi } from "@shared/api";
import type { SpeedTestHistoryQuery } from "@shared/api/routes/speedtest";
import type { SpeedMetric } from "@wan-monitor/shared";
import { Clock, Effect, Option, Result, type Schema } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import {
  resolveWindow,
  type TimeWindow,
  validateWindow,
} from "@/core/analytics/window";
import { mapQueryError } from "@/core/api/handlers/db-error";
import {
  SpeedTestRunner,
  type SpeedTestRunnerInterface,
} from "@/core/monitoring/speed-test-runner";
import { QuestDB } from "@/infrastructure/database/questdb";
import { SpeedTestTimeoutError } from "@/infrastructure/speedtest/errors";

const SpeedTestErrorCode = {
  ALREADY_RUNNING: "SPEED_TEST_ALREADY_RUNNING",
  EXECUTION_FAILED: "SPEED_TEST_EXECUTION_FAILED",
  TIMEOUT: "SPEED_TEST_TIMEOUT",
} as const;

type SpeedTestErrorCode =
  (typeof SpeedTestErrorCode)[keyof typeof SpeedTestErrorCode];

const failedResponse = (
  nowMs: number,
  code: SpeedTestErrorCode,
  message: string
) => ({
  success: false as const,
  timestamp: new Date(nowMs).toISOString(),
  error: { code, message },
});

export const triggerSpeedTestHandler = (runner: SpeedTestRunnerInterface) =>
  Effect.gen(function* () {
    const outcome = yield* runner.runIfIdle().pipe(Effect.result);
    const now = yield* Clock.currentTimeMillis;

    if (Result.isFailure(outcome)) {
      const error = outcome.failure;
      return error instanceof SpeedTestTimeoutError
        ? failedResponse(
            now,
            SpeedTestErrorCode.TIMEOUT,
            `Speed test timed out after ${error.timeoutMs}ms`
          )
        : failedResponse(
            now,
            SpeedTestErrorCode.EXECUTION_FAILED,
            error.message
          );
    }

    if (Option.isNone(outcome.success)) {
      return failedResponse(
        now,
        SpeedTestErrorCode.ALREADY_RUNNING,
        "A speed test is already in progress"
      );
    }

    const { result } = outcome.success.value;
    return {
      success: true as const,
      timestamp: result.timestamp.toISOString(),
      result: {
        downloadMbps: result.downloadSpeed,
        uploadMbps: result.uploadSpeed,
        pingMs: result.latency,
        jitter: result.jitter,
        server: result.serverLocation,
        isp: result.isp,
        externalIp: result.externalIp,
      },
    };
  });

const DEFAULT_HISTORY_SPAN_MS = 60 * 60 * 1000;

const loadSpeedTestHistory = (
  query: Schema.Schema.Type<typeof SpeedTestHistoryQuery>,
  { startMs, endMs }: TimeWindow
) =>
  Effect.gen(function* () {
    const db = yield* QuestDB;

    const startTime = new Date(startMs);
    const endTime = new Date(endMs);
    const data = yield* db.querySpeedtests({
      startTime,
      endTime,
      limit: query.limit,
      granularity: query.granularity,
    });

    const speedMetrics: SpeedMetric[] = data.map((m) => ({
      timestamp: m.timestamp,
      // Passed through as-is: a missing measurement stays missing so callers
      // can exclude it, rather than becoming a 0 that drags averages down.
      download_speed: m.download_speed,
      upload_speed: m.upload_speed,
      latency: m.latency,
      jitter: m.jitter ?? undefined,
      server_location: m.server_location ?? undefined,
      isp: m.isp ?? undefined,
      external_ip: m.external_ip ?? undefined,
      internal_ip: m.internal_ip ?? undefined,
    }));

    return {
      data: speedMetrics,
      meta: {
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        count: data.length,
      },
    };
  }).pipe(Effect.catch(mapQueryError("Failed to query speedtest history")));

export const getSpeedTestHistoryHandler = ({
  query,
}: {
  query: Schema.Schema.Type<typeof SpeedTestHistoryQuery>;
}) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const window = yield* validateWindow(
      resolveWindow(query, now, DEFAULT_HISTORY_SPAN_MS)
    );
    return yield* loadSpeedTestHistory(query, window);
  });

export const getSpeedTestStatusHandler = (runner: SpeedTestRunnerInterface) =>
  Effect.gen(function* () {
    const isRunning = yield* runner.isRunning();
    return { isRunning };
  });

export const SpeedTestGroupLive = HttpApiBuilder.group(
  WanMonitorApi,
  "speedtest",
  (handlers) =>
    Effect.gen(function* () {
      const runner = yield* SpeedTestRunner;

      return handlers
        .handle("triggerSpeedTest", () => triggerSpeedTestHandler(runner))
        .handle("getSpeedTestStatus", () => getSpeedTestStatusHandler(runner))
        .handle("getSpeedTestHistory", getSpeedTestHistoryHandler);
    })
);
