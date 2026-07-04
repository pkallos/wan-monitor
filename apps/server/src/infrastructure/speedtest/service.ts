import { Config, Duration, Effect, Layer } from "effect";
import speedTest from "speedtest-net";
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
            return new SpeedTestExecutionError({
              message: error instanceof Error ? error.message : String(error),
            });
          },
        });

        const result = yield* executeSpeedTest.pipe(
          Effect.timeout(Duration.millis(timeoutMs)),
          Effect.catchTag("TimeoutException", () =>
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

// Deterministic values returned by the stub executor. Chosen well outside the
// E2E seed ranges (100-125 Mbps down, 10-20 Mbps up) so a stubbed result is
// unambiguously distinguishable in the UI and in assertions.
export const STUB_SPEEDTEST_DOWNLOAD_MBPS = 500;
export const STUB_SPEEDTEST_UPLOAD_MBPS = 100;

/**
 * A deterministic, offline speed test executor for test/E2E mode.
 *
 * Returns fixed results without touching the network so `pnpm test:e2e` and
 * `SPEEDTEST_STUB=true` runs are fast and reproducible. `bandwidth` is in
 * bytes/sec (the speedtest-net contract): Mbps = bandwidth * 8 / 1_000_000.
 */
export const createStubSpeedTestExecutor = (): SpeedTestExecutor => () =>
  Promise.resolve({
    type: "result",
    timestamp: new Date(),
    download: {
      bandwidth: (STUB_SPEEDTEST_DOWNLOAD_MBPS * 1_000_000) / 8,
      bytes: 0,
      elapsed: 0,
    },
    upload: {
      bandwidth: (STUB_SPEEDTEST_UPLOAD_MBPS * 1_000_000) / 8,
      bytes: 0,
      elapsed: 0,
    },
    ping: { latency: 12.5, jitter: 1.5 },
    server: {
      id: 1,
      name: "E2E Stub Server",
      location: "Test City, TC",
      country: "Testland",
      host: "stub.speedtest.local",
      port: 8080,
      ip: "203.0.113.10",
    },
    isp: "E2E Stub ISP",
    interface: {
      externalIp: "203.0.113.10",
      internalIp: "192.168.1.50",
      isVpn: false,
      macAddr: "00:00:00:00:00:00",
      name: "eth0",
    },
    packetLoss: 0,
    result: {
      id: "e2e-stub",
      url: "https://stub.speedtest.local/result/e2e-stub",
    },
  }) as ReturnType<typeof speedTest>;

export const SpeedTestServiceLive = Layer.effect(
  SpeedTestService,
  Effect.gen(function* () {
    const timeoutSeconds = yield* Config.number(
      "SPEEDTEST_TIMEOUT_SECONDS"
    ).pipe(Config.withDefault(DEFAULT_SPEEDTEST_TIMEOUT_SECONDS));

    // Test/E2E hook: when set, return deterministic offline results instead of
    // invoking the native speedtest-net binary against the real network.
    const useStub = yield* Config.boolean("SPEEDTEST_STUB").pipe(
      Config.withDefault(false)
    );

    if (useStub) {
      yield* Effect.logWarning(
        "SPEEDTEST_STUB enabled: returning deterministic stub speed test results"
      );
    }

    const executor: SpeedTestExecutor = useStub
      ? createStubSpeedTestExecutor()
      : () =>
          speedTest({
            acceptLicense: true,
            acceptGdpr: true,
          });

    return makeSpeedTestService(executor, timeoutSeconds);
  })
);
