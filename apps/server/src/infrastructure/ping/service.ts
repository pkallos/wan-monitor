import { Context, Data, Effect, Layer, Schema } from "effect";
import ping from "ping";
import { ConfigService } from "@/infrastructure/config/config";

// ============================================================================
// Error Types
// ============================================================================

export class PingNetworkError extends Data.TaggedError("PingNetworkError")<{
  readonly host: string;
  readonly message: string;
}> {}

export class PingTimeoutError extends Data.TaggedError("PingTimeoutError")<{
  readonly host: string;
  readonly timeoutMs: number;
}> {}

export class PingHostUnreachableError extends Data.TaggedError(
  "PingHostUnreachableError"
)<{
  readonly host: string;
  readonly message: string;
}> {}

export type PingError =
  | PingNetworkError
  | PingTimeoutError
  | PingHostUnreachableError;

// ============================================================================
// Schemas
// ============================================================================

export const PingResult = Schema.Struct({
  host: Schema.String,
  alive: Schema.Boolean,
  latency: Schema.optional(Schema.Number),
  packetLoss: Schema.Number,
  min: Schema.optional(Schema.Number),
  max: Schema.optional(Schema.Number),
  avg: Schema.optional(Schema.Number),
  stddev: Schema.optional(Schema.Number),
});
export type PingResult = typeof PingResult.Type;

export const PingConfig = Schema.Struct({
  timeout: Schema.Number,
  trainCount: Schema.Number,
});
export type PingConfig = typeof PingConfig.Type;

// ============================================================================
// Service Interface
// ============================================================================

export interface PingServiceInterface {
  /**
   * Ping a single host and return the result
   */
  readonly ping: (host: string) => Effect.Effect<PingResult, PingError, never>;

  /**
   * Ping a host with custom configuration
   */
  readonly pingWithConfig: (
    host: string,
    config: PingConfig
  ) => Effect.Effect<PingResult, PingError, never>;

  /**
   * Check if a host is reachable (simple boolean check)
   */
  readonly isReachable: (
    host: string
  ) => Effect.Effect<boolean, PingError, never>;
}

// ============================================================================
// Service Tag
// ============================================================================

export class PingService extends Context.Service<
  PingService,
  PingServiceInterface
>()("PingService") {}

// ============================================================================
// Service Implementation
// ============================================================================

const DEFAULT_TIMEOUT = 5; // seconds
const DEFAULT_TRAIN_COUNT = 10; // packets per train

export const PingServiceLive = Layer.effect(
  PingService,
  Effect.gen(function* () {
    const config = yield* ConfigService;

    const pingWithConfig = (
      host: string,
      pingConfig: PingConfig
    ): Effect.Effect<PingResult, PingError, never> =>
      Effect.tryPromise({
        try: async () => {
          // Bounds total train wall time: `timeout` alone is per-packet (-W), so
          // without a deadline a lossy host can stall the train far past the
          // scheduled cycle interval while individual packets each wait it out.
          const deadline = Math.ceil(
            pingConfig.trainCount * 0.25 + pingConfig.timeout
          );
          const result = await ping.promise.probe(host, {
            timeout: pingConfig.timeout,
            deadline,
            extra: ["-c", String(pingConfig.trainCount), "-i", "0.25"],
          });

          if (!result.alive) {
            throw new PingHostUnreachableError({
              host,
              message: result.output || "Host unreachable",
            });
          }

          // Parse numeric value that might be 'unknown' string at runtime
          const parseNumeric = (
            val: string | number | undefined
          ): number | undefined => {
            if (val === undefined || val === "unknown") return undefined;
            return typeof val === "number" ? val : Number.parseFloat(val);
          };

          return {
            host: result.host,
            alive: result.alive,
            // Average, not `result.time` (the first packet's RTT) — the first
            // packet of a train is systematically the worst one (ARP/route-cache
            // miss), so it biases latency high and hides real average behavior.
            latency: parseNumeric(result.avg),
            packetLoss: parseNumeric(result.packetLoss) ?? 100,
            min: parseNumeric(result.min),
            max: parseNumeric(result.max),
            avg: parseNumeric(result.avg),
            stddev: parseNumeric(result.stddev),
          } satisfies PingResult;
        },
        catch: (error) => {
          if (error instanceof PingHostUnreachableError) {
            return error;
          }
          if (error instanceof Error && error.message.includes("timeout")) {
            return new PingTimeoutError({
              host,
              timeoutMs: pingConfig.timeout * 1000,
            });
          }
          return new PingNetworkError({
            host,
            message: error instanceof Error ? error.message : String(error),
          });
        },
      }).pipe(
        Effect.flatMap((result) => {
          // If the result is an error (from the catch block), fail with it
          if (result instanceof PingHostUnreachableError) {
            return Effect.fail(result);
          }
          return Effect.succeed(result);
        })
      );

    const pingHost = (
      host: string
    ): Effect.Effect<PingResult, PingError, never> =>
      pingWithConfig(host, {
        timeout: config.ping?.timeout ?? DEFAULT_TIMEOUT,
        trainCount: config.ping?.trainCount ?? DEFAULT_TRAIN_COUNT,
      });

    const isReachable = (
      host: string
    ): Effect.Effect<boolean, PingError, never> =>
      pingHost(host).pipe(
        Effect.map((result) => result.alive),
        Effect.catch(() => Effect.succeed(false))
      );

    return {
      ping: pingHost,
      pingWithConfig,
      isReachable,
    };
  })
);
