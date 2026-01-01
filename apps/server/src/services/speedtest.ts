import { Context, Effect, Layer, Schema } from "effect";
import speedTest from "speedtest-net";

export class SpeedTestExecutionError {
  readonly _tag = "SpeedTestExecutionError";
  constructor(readonly message: string) {}
}

export class SpeedTestTimeoutError {
  readonly _tag = "SpeedTestTimeoutError";
  constructor(readonly timeoutMs: number) {}
}

export type SpeedTestError = SpeedTestExecutionError | SpeedTestTimeoutError;

export const SpeedTestResult = Schema.Struct({
  timestamp: Schema.Date,
  downloadSpeed: Schema.Number,
  uploadSpeed: Schema.Number,
  latency: Schema.Number,
  jitter: Schema.optional(Schema.Number),
  serverId: Schema.optional(Schema.String),
  serverName: Schema.optional(Schema.String),
  serverLocation: Schema.optional(Schema.String),
  serverCountry: Schema.optional(Schema.String),
  isp: Schema.optional(Schema.String),
  externalIp: Schema.optional(Schema.String),
  internalIp: Schema.optional(Schema.String),
});
export type SpeedTestResult = typeof SpeedTestResult.Type;

export interface SpeedTestServiceInterface {
  readonly runTest: () => Effect.Effect<SpeedTestResult, SpeedTestError, never>;
}

export class SpeedTestService extends Context.Tag("SpeedTestService")<
  SpeedTestService,
  SpeedTestServiceInterface
>() {}

export const SpeedTestServiceLive = Layer.succeed(
  SpeedTestService,
  SpeedTestService.of({
    runTest: () =>
      Effect.gen(function* () {
        yield* Effect.logInfo("Starting speed test...");

        const result = yield* Effect.tryPromise({
          try: async () => {
            const testResult = await speedTest({
              acceptLicense: true,
              acceptGdpr: true,
            });
            return testResult;
          },
          catch: (error) => {
            if (error instanceof Error && error.message.includes("timeout")) {
              return new SpeedTestTimeoutError(30000);
            }
            return new SpeedTestExecutionError(
              error instanceof Error ? error.message : String(error)
            );
          },
        });

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
  })
);
