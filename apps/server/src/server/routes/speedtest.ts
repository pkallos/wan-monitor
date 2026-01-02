import { mbpsToBps, type SpeedMetric } from "@wan-monitor/shared";
import { Cause, Effect, Either, Exit, Option } from "effect";
import { DbUnavailable } from "@/database/questdb";
import type { AppContext, AppInstance } from "@/server/types";
import {
  SpeedTestExecutionError,
  SpeedTestTimeoutError,
} from "@/services/speedtest-errors";

// Module-level mutex for speed test concurrency control
let isSpeedTestRunning = false;

// Structured error codes for speed test failures
export const SpeedTestErrorCode = {
  ALREADY_RUNNING: "SPEED_TEST_ALREADY_RUNNING",
  EXECUTION_FAILED: "SPEED_TEST_EXECUTION_FAILED",
  TIMEOUT: "SPEED_TEST_TIMEOUT",
} as const;

export type SpeedTestErrorCode =
  (typeof SpeedTestErrorCode)[keyof typeof SpeedTestErrorCode];

interface SpeedTestErrorResponse {
  success: false;
  timestamp: string;
  error: {
    code: SpeedTestErrorCode;
    message: string;
  };
}

interface SpeedTestSuccessResponse {
  success: true;
  timestamp: string;
  result: {
    downloadMbps: number;
    uploadMbps: number;
    pingMs: number;
    jitter?: number;
    server?: string;
    isp?: string;
    externalIp?: string;
  };
}

type SpeedTestResponse = SpeedTestSuccessResponse | SpeedTestErrorResponse;

/**
 * Speed test related routes
 *
 * Note: Authentication is handled globally by the app's onRequest hook
 * when authRequired is true. All /api/* routes (except public paths)
 * require a valid JWT token.
 */
export async function speedtestRoutes(
  app: AppInstance,
  context: AppContext
): Promise<void> {
  // Speed test trigger endpoint - run a speed test and write to database
  app.post<{ Reply: SpeedTestResponse }>(
    "/trigger",
    async (_request, reply) => {
      // Concurrency guard: prevent overlapping speed tests
      if (isSpeedTestRunning) {
        return reply.code(409).send({
          success: false,
          timestamp: new Date().toISOString(),
          error: {
            code: SpeedTestErrorCode.ALREADY_RUNNING,
            message:
              "A speed test is already in progress. Please wait for it to complete.",
          },
        });
      }

      isSpeedTestRunning = true;

      try {
        // Use runPromiseExit to properly extract typed errors from Effect
        const exit = await Effect.runPromiseExit(
          context.speedTestService.runTest()
        );

        if (Exit.isFailure(exit)) {
          // Extract the error from the Cause using Effect's Option type
          const failureOption = Cause.failureOption(exit.cause);

          let errorCode: SpeedTestErrorCode =
            SpeedTestErrorCode.EXECUTION_FAILED;
          let errorMessage = "Speed test failed";

          if (Option.isSome(failureOption)) {
            const error = failureOption.value;
            if (error instanceof SpeedTestTimeoutError) {
              errorCode = SpeedTestErrorCode.TIMEOUT;
              errorMessage = "Speed test timed out";
            } else if (error instanceof SpeedTestExecutionError) {
              errorMessage = error.message;
            }
          }

          return reply.code(500).send({
            success: false,
            timestamp: new Date().toISOString(),
            error: {
              code: errorCode,
              message: errorMessage,
            },
          });
        }

        const result = exit.value;

        // Write speed test result to database (same as network-monitor does)
        await Effect.runPromise(
          context.db
            .writeMetric({
              timestamp: result.timestamp,
              source: "speedtest" as const,
              latency: result.latency,
              jitter: result.jitter,
              downloadBandwidth: mbpsToBps(result.downloadSpeed),
              uploadBandwidth: mbpsToBps(result.uploadSpeed),
              serverLocation: result.serverLocation,
              isp: result.isp,
              externalIp: result.externalIp,
              internalIp: result.internalIp,
            })
            .pipe(
              Effect.catchAll((error) =>
                Effect.logError(
                  `Speed test DB write failed: ${error._tag} - ${error.message}`
                )
              )
            )
        );

        // Use result.timestamp for consistency between stored and returned data
        return reply.code(200).send({
          success: true,
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
        });
      } finally {
        isSpeedTestRunning = false;
      }
    }
  );

  // Status endpoint to check if a speed test is currently running
  app.get("/status", async (_request, reply) => {
    return reply.code(200).send({
      isRunning: isSpeedTestRunning,
    });
  });

  // History endpoint - returns all speedtest results without aggregation
  app.get("/history", async (request, reply) => {
    try {
      const query = request.query as {
        startTime?: string;
        endTime?: string;
        limit?: string;
      };

      const params = {
        startTime: query.startTime ? new Date(query.startTime) : undefined,
        endTime: query.endTime ? new Date(query.endTime) : undefined,
        limit: query.limit ? Number.parseInt(query.limit, 10) : undefined,
      };

      const result = await Effect.runPromise(
        context.db.querySpeedtests(params).pipe(Effect.either)
      );

      return Either.match(result, {
        onLeft: (error) => {
          if (error instanceof DbUnavailable) {
            return reply.code(503).send({
              error: "DB_UNAVAILABLE",
              message: "Database temporarily unavailable",
              timestamp: new Date().toISOString(),
            });
          }
          return reply.code(500).send({
            error: "Failed to query speedtest history",
            message: String(error),
          });
        },
        onRight: (data) => {
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

          return reply.code(200).send({
            data: speedMetrics,
            meta: {
              startTime:
                params.startTime?.toISOString() ??
                new Date(Date.now() - 3600000).toISOString(),
              endTime:
                params.endTime?.toISOString() ?? new Date().toISOString(),
              count: data.length,
            },
          });
        },
      });
    } catch (error) {
      return reply.code(500).send({
        error: "Failed to query speedtest history",
        message: String(error),
      });
    }
  });
}
