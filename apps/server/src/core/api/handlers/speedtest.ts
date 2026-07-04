import { HttpApiBuilder } from "@effect/platform";
import { WanMonitorApi } from "@shared/api";
import type { SpeedTestHistoryQuery } from "@shared/api/routes/speedtest";
import { mbpsToBps } from "@shared/metrics";
import type { SpeedMetric } from "@wan-monitor/shared";
import { Clock, Effect, Ref, type Schema } from "effect";
import { mapQueryError } from "@/core/api/handlers/db-error";
import { QuestDB } from "@/infrastructure/database/questdb";
import {
  SpeedTestExecutionError,
  SpeedTestTimeoutError,
} from "@/infrastructure/speedtest/errors";
import { SpeedTestService } from "@/infrastructure/speedtest/service";

const SpeedTestErrorCode = {
  ALREADY_RUNNING: "SPEED_TEST_ALREADY_RUNNING",
  EXECUTION_FAILED: "SPEED_TEST_EXECUTION_FAILED",
  TIMEOUT: "SPEED_TEST_TIMEOUT",
} as const;

type SpeedTestErrorCode =
  (typeof SpeedTestErrorCode)[keyof typeof SpeedTestErrorCode];

export const triggerSpeedTestHandler = (isRunningRef: Ref.Ref<boolean>) =>
  Effect.gen(function* () {
    const acquired = yield* Ref.modify(isRunningRef, (running) =>
      running ? [false, true] : [true, true]
    );

    if (!acquired) {
      const now = yield* Clock.currentTimeMillis;
      return {
        success: false as const,
        timestamp: new Date(now).toISOString(),
        error: {
          code: SpeedTestErrorCode.ALREADY_RUNNING as SpeedTestErrorCode,
          message: "A speed test is already in progress",
        },
      };
    }

    const speedTestService = yield* SpeedTestService;
    const db = yield* QuestDB;

    const result = yield* speedTestService.runTest().pipe(
      Effect.matchEffect({
        onFailure: (error) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            let errorCode: SpeedTestErrorCode =
              SpeedTestErrorCode.EXECUTION_FAILED;
            let errorMessage = "Speed test execution failed";

            if (error instanceof SpeedTestTimeoutError) {
              errorCode = SpeedTestErrorCode.TIMEOUT;
              errorMessage = `Speed test timed out after ${error.timeoutMs}ms`;
            } else if (error instanceof SpeedTestExecutionError) {
              errorMessage = error.message;
            }

            return {
              success: false as const,
              timestamp: new Date(now).toISOString(),
              error: {
                code: errorCode,
                message: errorMessage,
              },
            };
          }),
        onSuccess: (testResult) =>
          Effect.gen(function* () {
            yield* db
              .writeMetric({
                timestamp: testResult.timestamp,
                source: "speedtest" as const,
                latency: testResult.latency,
                jitter: testResult.jitter,
                downloadBandwidth: mbpsToBps(testResult.downloadSpeed),
                uploadBandwidth: mbpsToBps(testResult.uploadSpeed),
                serverLocation: testResult.serverLocation,
                isp: testResult.isp,
                externalIp: testResult.externalIp,
                internalIp: testResult.internalIp,
              })
              .pipe(
                Effect.catchAll((dbError) =>
                  Effect.logError(
                    `Speed test DB write failed: ${dbError._tag} - ${dbError.message}`
                  )
                )
              );

            return {
              success: true as const,
              timestamp: testResult.timestamp.toISOString(),
              result: {
                downloadMbps: testResult.downloadSpeed,
                uploadMbps: testResult.uploadSpeed,
                pingMs: testResult.latency,
                jitter: testResult.jitter,
                server: testResult.serverLocation,
                isp: testResult.isp,
                externalIp: testResult.externalIp,
              },
            };
          }),
      }),
      Effect.ensuring(Ref.set(isRunningRef, false))
    );

    return result;
  });

export const getSpeedTestHistoryHandler = ({
  urlParams,
}: {
  urlParams: Schema.Schema.Type<typeof SpeedTestHistoryQuery>;
}) =>
  Effect.gen(function* () {
    const db = yield* QuestDB;
    const now = yield* Clock.currentTimeMillis;

    const params = {
      startTime: urlParams.startTime
        ? new Date(urlParams.startTime)
        : undefined,
      endTime: urlParams.endTime ? new Date(urlParams.endTime) : undefined,
      limit: urlParams.limit,
    };

    const data = yield* db
      .querySpeedtests(params)
      .pipe(
        Effect.catchAll(mapQueryError("Failed to query speedtest history"))
      );

    const speedMetrics: SpeedMetric[] = data.map((m) => ({
      timestamp: m.timestamp,
      download_speed: m.download_speed ?? 0,
      upload_speed: m.upload_speed ?? 0,
      latency: m.latency ?? 0,
      jitter: m.jitter ?? undefined,
      server_location: m.server_location ?? undefined,
      isp: m.isp ?? undefined,
      external_ip: m.external_ip ?? undefined,
      internal_ip: m.internal_ip ?? undefined,
    }));

    return {
      data: speedMetrics,
      meta: {
        startTime:
          params.startTime?.toISOString() ??
          new Date(now - 3600000).toISOString(),
        endTime: params.endTime?.toISOString() ?? new Date(now).toISOString(),
        count: data.length,
      },
    };
  });

export const SpeedTestGroupLive = HttpApiBuilder.group(
  WanMonitorApi,
  "speedtest",
  (handlers) =>
    Effect.gen(function* () {
      const isRunningRef = yield* Ref.make(false);

      return handlers
        .handle("triggerSpeedTest", () => triggerSpeedTestHandler(isRunningRef))
        .handle("getSpeedTestStatus", () =>
          Effect.gen(function* () {
            const isRunning = yield* Ref.get(isRunningRef);
            return { isRunning };
          })
        )
        .handle("getSpeedTestHistory", getSpeedTestHistoryHandler);
    })
);
