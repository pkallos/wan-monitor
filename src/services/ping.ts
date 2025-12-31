import { Context, Effect, Layer, Schema } from 'effect';
import ping from 'ping';
import { ConfigService } from '@/services/config.js';

// ============================================================================
// Error Types
// ============================================================================

export class PingNetworkError {
  readonly _tag = 'PingNetworkError';
  constructor(
    readonly host: string,
    readonly message: string
  ) {}
}

export class PingTimeoutError {
  readonly _tag = 'PingTimeoutError';
  constructor(
    readonly host: string,
    readonly timeoutMs: number
  ) {}
}

export class PingHostUnreachableError {
  readonly _tag = 'PingHostUnreachableError';
  constructor(
    readonly host: string,
    readonly message: string
  ) {}
}

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
  latency: Schema.Number,
  packetLoss: Schema.Number,
  min: Schema.optional(Schema.Number),
  max: Schema.optional(Schema.Number),
  avg: Schema.optional(Schema.Number),
  stddev: Schema.optional(Schema.Number),
});
export type PingResult = typeof PingResult.Type;

export const PingConfig = Schema.Struct({
  timeout: Schema.Number,
  retries: Schema.Number,
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

export class PingService extends Context.Tag('PingService')<
  PingService,
  PingServiceInterface
>() {}

// ============================================================================
// Service Implementation
// ============================================================================

const DEFAULT_TIMEOUT = 5; // seconds
const DEFAULT_RETRIES = 1;

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
          const result = await ping.promise.probe(host, {
            timeout: pingConfig.timeout,
            extra: ['-c', String(pingConfig.retries + 1)], // +1 because we want at least 1 ping
          });

          if (!result.alive) {
            throw new PingHostUnreachableError(
              host,
              result.output || 'Host unreachable'
            );
          }

          // Parse numeric value that might be 'unknown' string at runtime
          const parseNumeric = (
            val: string | number | undefined
          ): number | undefined => {
            if (val === undefined || val === 'unknown') return undefined;
            return typeof val === 'number' ? val : Number.parseFloat(val);
          };

          return {
            host: result.host,
            alive: result.alive,
            latency: parseNumeric(result.time) ?? -1,
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
          if (error instanceof Error && error.message.includes('timeout')) {
            return new PingTimeoutError(host, pingConfig.timeout * 1000);
          }
          return new PingNetworkError(
            host,
            error instanceof Error ? error.message : String(error)
          );
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
        retries: config.ping?.retries ?? DEFAULT_RETRIES,
      });

    const isReachable = (
      host: string
    ): Effect.Effect<boolean, PingError, never> =>
      pingHost(host).pipe(
        Effect.map((result) => result.alive),
        Effect.catchAll(() => Effect.succeed(false))
      );

    return {
      ping: pingHost,
      pingWithConfig,
      isReachable,
    };
  })
);
