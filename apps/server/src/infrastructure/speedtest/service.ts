import { Duration, Effect, Layer } from "effect";
import speedTest from "speedtest-net";
import { ConfigService } from "@/infrastructure/config/config";
import {
  SpeedTestExecutionError,
  SpeedTestTimeoutError,
} from "@/infrastructure/speedtest/errors";

// Re-export from separate modules (avoids native module load in tests)
export type { SpeedTestError } from "@/infrastructure/speedtest/errors";
export {
  SpeedTestExecutionError,
  SpeedTestTimeoutError,
} from "@/infrastructure/speedtest/errors";
export {
  type SpeedTestResult,
  SpeedTestService,
  type SpeedTestServiceInterface,
} from "@/infrastructure/speedtest/types";

// Import for internal use
import {
  type SpeedTestResult,
  SpeedTestService,
  type SpeedTestServiceInterface,
} from "@/infrastructure/speedtest/types";

export const DEFAULT_SPEEDTEST_TIMEOUT_SECONDS = 120;

/** Runs one test; aborting `signal` must stop the underlying CLI. */
export type SpeedTestExecutor = (
  signal: AbortSignal
) => ReturnType<typeof speedTest>;

/** A bandwidth of 0 or none is no reading, so it has no Mbps figure. */
const bandwidthToMbps = (
  bytesPerSecond: number | undefined
): number | undefined =>
  bytesPerSecond ? (bytesPerSecond * 8) / 1_000_000 : undefined;

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
          try: (signal) => executor(signal),
          catch: (error) => {
            return new SpeedTestExecutionError({
              message: error instanceof Error ? error.message : String(error),
            });
          },
        });

        const result = yield* executeSpeedTest.pipe(
          Effect.timeout(Duration.millis(timeoutMs)),
          Effect.catchTag("TimeoutError", () =>
            Effect.gen(function* () {
              yield* Effect.logWarning(
                `Speed test timed out after ${timeoutSeconds}s`
              );
              return yield* Effect.fail(
                new SpeedTestTimeoutError({ timeoutMs })
              );
            })
          )
        );

        const downloadSpeedMbps = bandwidthToMbps(result.download?.bandwidth);
        const uploadSpeedMbps = bandwidthToMbps(result.upload?.bandwidth);

        const speedTestResult: SpeedTestResult = {
          timestamp: new Date(),
          downloadSpeed: downloadSpeedMbps,
          uploadSpeed: uploadSpeedMbps,
          latency: result.ping?.latency,
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
            `  Download: ${downloadSpeedMbps?.toFixed(2) ?? "N/A"} Mbps\n` +
            `  Upload: ${uploadSpeedMbps?.toFixed(2) ?? "N/A"} Mbps\n` +
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

/**
 * Build a SpeedTestService layer around a given executor, resolving the timeout
 * from `ConfigService` (`speedtest.timeoutSeconds`).
 *
 * The executor is a parameter so tests can supply a deterministic stand-in and
 * exercise the config -> effective-timeout wiring without the native module or
 * a real network round-trip.
 */
export const makeSpeedTestServiceLayer = (executor: SpeedTestExecutor) =>
  Layer.effect(
    SpeedTestService,
    Effect.gen(function* () {
      const config = yield* ConfigService;
      const timeoutSeconds = config.speedtest.timeoutSeconds;

      return makeSpeedTestService(executor, timeoutSeconds);
    })
  );

// speedtest-net cannot cancel during its first-run binary download (#416).
export const liveExecutor: SpeedTestExecutor = (signal) => {
  const cancel = speedTest.makeCancel();
  signal.addEventListener("abort", () => cancel(), { once: true });
  return speedTest({
    acceptLicense: true,
    acceptGdpr: true,
    cancel,
  });
};

export const SpeedTestServiceLive = makeSpeedTestServiceLayer(liveExecutor);
