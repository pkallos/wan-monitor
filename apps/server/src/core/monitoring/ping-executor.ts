import type { NetworkMetric } from "@shared/metrics";
import { Clock, Context, Effect, Layer } from "effect";
import { ConfigService } from "@/infrastructure/config/config";
import { QuestDB } from "@/infrastructure/database/questdb";
import { type PingResult, PingService } from "@/infrastructure/ping/service";

// ============================================================================
// Types
// ============================================================================

export interface PingExecutionResult {
  readonly host: string;
  readonly success: boolean;
  readonly result?: PingResult;
  readonly error?: string;
  /** Set when the result row could not be stored; independent of `success`. */
  readonly writeError?: string;
}

// ============================================================================
// Service Interface
// ============================================================================

export interface PingExecutorInterface {
  /**
   * Execute ping for a single host and write result to database
   */
  readonly executePing: (
    host: string
  ) => Effect.Effect<PingExecutionResult, never>;

  /**
   * Execute pings for all configured hosts and write results to database
   */
  readonly executeAll: () => Effect.Effect<readonly PingExecutionResult[]>;

  /**
   * Execute pings for specific hosts and write results to database
   */
  readonly executeHosts: (
    hosts: readonly string[]
  ) => Effect.Effect<readonly PingExecutionResult[]>;
}

// ============================================================================
// Service Tag
// ============================================================================

export class PingExecutor extends Context.Service<
  PingExecutor,
  PingExecutorInterface
>()("PingExecutor") {}

// ============================================================================
// Helper: Convert PingResult to NetworkMetric
// ============================================================================

/**
 * What the writer records about a ping besides its result: the configured host
 * it was requested for (a resolved name is never stored), the instant the ping
 * started, and how long it ran.
 */
interface PingStamp {
  readonly host: string;
  readonly timestamp: Date;
  readonly durationMs: number;
}

const pingResultToMetric = (
  result: PingResult,
  { host, timestamp, durationMs }: PingStamp
): NetworkMetric => ({
  timestamp,
  source: "ping" as const,
  host,
  durationMs,
  latency: result.latency,
  packetLoss: result.packetLoss,
  jitter: result.stddev,
  connectivityStatus: result.alive ? "up" : "down",
});

// ============================================================================
// Service Implementation
// ============================================================================

export const PingExecutorLive = Layer.effect(
  PingExecutor,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const pingService = yield* PingService;
    const db = yield* QuestDB;

    const persist = (
      host: string,
      metric: NetworkMetric
    ): Effect.Effect<{ readonly writeError?: string }> =>
      db.writeMetric(metric).pipe(
        Effect.as({}),
        Effect.catch((error) =>
          Effect.logError(
            `Failed to store ping result for ${host}: ${error._tag} - ${error.message}`
          ).pipe(Effect.as({ writeError: error.message }))
        )
      );

    const executePing = (
      host: string
    ): Effect.Effect<PingExecutionResult, never> =>
      Effect.gen(function* () {
        const startMs = yield* Clock.currentTimeMillis;
        const stamp = (endMs: number): PingStamp => ({
          host,
          timestamp: new Date(startMs),
          // A wall clock that steps back mid-ping must not record a negative run.
          durationMs: Math.max(0, endMs - startMs),
        });

        return yield* pingService.ping(host).pipe(
          // Success path - write metric to database
          Effect.flatMap((result) =>
            Clock.currentTimeMillis.pipe(
              Effect.flatMap((endMs) =>
                persist(host, pingResultToMetric(result, stamp(endMs)))
              ),
              Effect.map(
                (write): PingExecutionResult => ({
                  host,
                  success: true,
                  result,
                  ...write,
                })
              )
            )
          ),
          // Failure path - write "down" metric with no latency (NULL in DB)
          // Omitting latency ensures avg() aggregations aren't skewed by failures
          Effect.catch((pingError) =>
            Clock.currentTimeMillis.pipe(
              Effect.flatMap((endMs) => {
                const { timestamp, durationMs } = stamp(endMs);
                return persist(host, {
                  timestamp,
                  source: "ping",
                  host,
                  packetLoss: 100,
                  connectivityStatus: "down",
                  durationMs,
                });
              }),
              Effect.map(
                (write): PingExecutionResult => ({
                  host,
                  success: false,
                  error: pingError._tag,
                  ...write,
                })
              )
            )
          )
        );
      });

    const executeHosts = (
      hosts: readonly string[]
    ): Effect.Effect<readonly PingExecutionResult[]> =>
      Effect.all(hosts.map(executePing), { concurrency: "unbounded" });

    const executeAll = (): Effect.Effect<readonly PingExecutionResult[]> =>
      executeHosts(config.ping.hosts);

    return {
      executePing,
      executeAll,
      executeHosts,
    };
  })
);
