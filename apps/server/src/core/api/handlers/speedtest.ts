import { HttpApiBuilder } from "@effect/platform";
import { WanMonitorApi } from "@shared/api";
import type { SpeedTestHistoryQuery } from "@shared/api/routes/speedtest";
import { mbpsToBps } from "@shared/metrics";
import type { SpeedMetricType } from "@wan-monitor/shared";
import { Effect, Ref, type Schema } from "effect";
import { DbUnavailable, QuestDB } from "@/infrastructure/database/questdb";
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
    const isRunning = yield* Ref.get(isRunningRef);

    if (isRunning) {
      return {
        success: false as const,
        timestamp: new Date().toISOString(),
        error: {
          code: SpeedTestErrorCode.ALREADY_RUNNING as SpeedTestErrorCode,
          message: "A speed test is already in progress",
        },
      };
    }

    yield* Ref.set(isRunningRef, true);
    const speedTestService = yield* SpeedTestService;
    const db = yield* QuestDB;

    const result = yield* speedTestService.runTest().pipe(
      Effect.matchEffect({
        onFailure: (error) =>
          Effect.gen(function* () {
            yield* Ref.set(isRunningRef, false);

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
              timestamp: new Date().toISOString(),
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

            yield* Ref.set(isRunningRef, false);

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
      })
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

    const params = {
      startTime: urlParams.startTime
        ? new Date(urlParams.startTime)
        : undefined,
      endTime: urlParams.endTime ? new Date(urlParams.endTime) : undefined,
      limit: urlParams.limit,
    };

    const data = yield* db.querySpeedtests(params).pipe(
      Effect.catchAll((error) => {
        if (error instanceof DbUnavailable) {
          return Effect.fail("Database temporarily unavailable");
        }
        return Effect.fail(`Failed to query speedtest history: ${error}`);
      })
    );

    const speedMetrics: SpeedMetricType[] = data.map((m) => ({
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
          new Date(Date.now() - 3600000).toISOString(),
        endTime: params.endTime?.toISOString() ?? new Date().toISOString(),
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
