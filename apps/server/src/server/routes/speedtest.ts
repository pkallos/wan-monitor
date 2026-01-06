import { HttpApiBuilder } from "@effect/platform";
import type { SpeedMetric } from "@shared/api";
import { WanMonitorApi } from "@shared/api/main";
import { mbpsToBps } from "@shared/metrics";
import { Cause, Effect, Option, Ref } from "effect";
import { DbUnavailable, QuestDB } from "@/database/questdb";
import { SpeedTestService } from "@/services/speedtest";
import {
  SpeedTestExecutionError,
  SpeedTestTimeoutError,
} from "@/services/speedtest-errors";

const SpeedTestErrorCode = {
  ALREADY_RUNNING: "SPEED_TEST_ALREADY_RUNNING",
  EXECUTION_FAILED: "SPEED_TEST_EXECUTION_FAILED",
  TIMEOUT: "SPEED_TEST_TIMEOUT",
} as const;

type SpeedTestErrorCode =
  (typeof SpeedTestErrorCode)[keyof typeof SpeedTestErrorCode];

export const SpeedTestGroupLive = HttpApiBuilder.group(
  WanMonitorApi,
  "speedtest",
  (handlers) =>
    Effect.gen(function* () {
      const isRunningRef = yield* Ref.make(false);

      return handlers
        .handle("triggerSpeedTest", () =>
          Effect.gen(function* () {
            const isRunning = yield* Ref.get(isRunningRef);

            if (isRunning) {
              return {
                success: false as const,
                timestamp: new Date().toISOString(),
                error: {
                  code: SpeedTestErrorCode.ALREADY_RUNNING,
                  message:
                    "A speed test is already in progress. Please wait for it to complete.",
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

                    const failureOption = Cause.failureOption(
                      Cause.fail(error)
                    );
                    let errorCode: SpeedTestErrorCode =
                      SpeedTestErrorCode.EXECUTION_FAILED;
                    let errorMessage = "Speed test failed";

                    if (Option.isSome(failureOption)) {
                      const err = failureOption.value;
                      if (err instanceof SpeedTestTimeoutError) {
                        errorCode = SpeedTestErrorCode.TIMEOUT;
                        errorMessage = "Speed test timed out";
                      } else if (err instanceof SpeedTestExecutionError) {
                        errorMessage = err.message;
                      }
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
          })
        )
        .handle("getSpeedTestStatus", () =>
          Effect.gen(function* () {
            const isRunning = yield* Ref.get(isRunningRef);
            return { isRunning };
          })
        )
        .handle("getSpeedTestHistory", ({ urlParams }) =>
          Effect.gen(function* () {
            const db = yield* QuestDB;

            const params = {
              startTime: urlParams.startTime
                ? new Date(urlParams.startTime)
                : undefined,
              endTime: urlParams.endTime
                ? new Date(urlParams.endTime)
                : undefined,
              limit: urlParams.limit,
            };

            const data = yield* db.querySpeedtests(params).pipe(
              Effect.catchAll((error) => {
                if (error instanceof DbUnavailable) {
                  return Effect.fail("Database temporarily unavailable");
                }
                return Effect.fail(
                  `Failed to query speedtest history: ${error}`
                );
              })
            );

            const speedMetrics: SpeedMetric[] = data.map((m) => ({
              timestamp: m.timestamp,
              download_speed: m.download_speed ?? 0,
              upload_speed: m.upload_speed ?? 0,
              latency: m.latency ?? 0,
              jitter: m.jitter,
              server_location: m.server_location,
              isp: m.isp,
              external_ip: m.external_ip,
              internal_ip: m.internal_ip,
            }));

            return {
              data: speedMetrics,
              meta: {
                startTime:
                  params.startTime?.toISOString() ??
                  new Date(Date.now() - 3600000).toISOString(),
                endTime:
                  params.endTime?.toISOString() ?? new Date().toISOString(),
                count: data.length,
              },
            };
          })
        );
    })
);
