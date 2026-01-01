import { Config, Duration, Effect, Layer } from "effect";
import speedTest from "speedtest-net";
import {
  SpeedTestExecutionError,
  SpeedTestTimeoutError,
} from "@/services/speedtest-errors";

// Re-export from separate modules (avoids native module load in tests)
export type { SpeedTestError } from "@/services/speedtest-errors";
export {
  SpeedTestExecutionError,
  SpeedTestTimeoutError,
} from "@/services/speedtest-errors";
export {
  type SpeedTestResult,
  SpeedTestService,
  type SpeedTestServiceInterface,
} from "@/services/speedtest-service";

// Import for internal use
import {
  type SpeedTestResult,
  SpeedTestService,
  type SpeedTestServiceInterface,
} from "@/services/speedtest-service";

export const DEFAULT_SPEEDTEST_TIMEOUT_SECONDS = 120;

export type SpeedTestExecutor = () => ReturnType<typeof speedTest>;

export const makeSpeedTestService = (
  executor: SpeedTestExecutor,
  timeoutSeconds: number
): SpeedTestServiceInterface => {
  const timeoutMs = timeoutSeconds * 1000;

  return {
    runTest: () =>
      Effect.gen(function* () {
        yield* Effect.logInfo(
          `Starting speed test (timeout: ${timeoutSeconds}s)...`
        );

        const executeSpeedTest = Effect.tryPromise({
          try: () => executor(),
          catch: (error) => {
            return new SpeedTestExecutionError(
              error instanceof Error ? error.message : String(error)
            );
          },
        });

        const result = yield* executeSpeedTest.pipe(
          Effect.timeout(Duration.millis(timeoutMs)),
          Effect.catchTag("TimeoutException", () =>
            Effect.gen(function* () {
              yield* Effect.logWarning(
                `Speed test timed out after ${timeoutSeconds}s`
              );
              return yield* Effect.fail(new SpeedTestTimeoutError(timeoutMs));
            })
          )
        );

        const downloadSpeedMbps = result.download.bandwidth
          ? (result.download.bandwidth * 8) / 1_000_000
          : 0;
        const uploadSpeedMbps = result.upload.bandwidth
          ? (result.upload.bandwidth * 8) / 1_000_000
          : 0;

        const speedTestResult: SpeedTestResult = {
          timestamp: new Date(),
          downloadSpeed: downloadSpeedMbps,
          uploadSpeed: uploadSpeedMbps,
          latency: result.ping?.latency ?? 0,
          jitter: result.ping?.jitter,
          serverId: result.server?.id?.toString(),
          serverName: result.server?.name,
          serverLocation: result.server?.location,
          serverCountry: result.server?.country,
          isp: result.isp,
          externalIp: result.interface?.externalIp,
          internalIp: result.interface?.internalIp,
        };

        yield* Effect.logInfo(
          `Speed test complete:\n` +
            `  Download: ${downloadSpeedMbps.toFixed(2)} Mbps\n` +
            `  Upload: ${uploadSpeedMbps.toFixed(2)} Mbps\n` +
            `  Latency: ${result.ping?.latency?.toFixed(2) ?? "N/A"} ms\n` +
            `  Jitter: ${result.ping?.jitter?.toFixed(2) ?? "N/A"} ms\n` +
            `  Server: ${result.server?.name ?? "Unknown"} (${result.server?.location ?? "Unknown"})\n` +
            `  ISP: ${result.isp ?? "Unknown"}\n` +
            `  External IP: ${result.interface?.externalIp ?? "Unknown"}`
        );

        return speedTestResult;
      }),
  };
};

export const SpeedTestServiceLive = Layer.effect(
  SpeedTestService,
  Effect.gen(function* () {
    const timeoutSeconds = yield* Config.number(
      "SPEEDTEST_TIMEOUT_SECONDS"
    ).pipe(Config.withDefault(DEFAULT_SPEEDTEST_TIMEOUT_SECONDS));

    const executor: SpeedTestExecutor = () =>
      speedTest({
        acceptLicense: true,
        acceptGdpr: true,
      });

    return makeSpeedTestService(executor, timeoutSeconds);
  })
);
