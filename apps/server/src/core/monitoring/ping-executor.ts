import type { NetworkMetric } from "@shared/metrics";
import { Context, Effect, Layer } from "effect";
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

const pingResultToMetric = (
  result: PingResult,
  timestamp: Date
): NetworkMetric => ({
  timestamp,
  source: "ping" as const,
  host: result.host,
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

    // `timestamp` is shared across every host in one cycle (see `executeHosts`)
    // rather than stamped per-host at completion, so quorum queries can group
    // a cycle's rows by exact timestamp equality instead of a fragile
    // read-time time-window heuristic that a slow DNS lookup could break.
    const executePingAt = (
      host: string,
      timestamp: Date
    ): Effect.Effect<PingExecutionResult, never> =>
      pingService.ping(host).pipe(
        // Success path - write metric to database
        Effect.flatMap((result) =>
          persist(host, pingResultToMetric(result, timestamp)).pipe(
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
          persist(host, {
            timestamp,
            source: "ping",
            host,
            // latency omitted - no measurement available on failure
            packetLoss: 100,
            connectivityStatus: "down",
          }).pipe(
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

    const executePing = (
      host: string
    ): Effect.Effect<PingExecutionResult, never> =>
      executePingAt(host, new Date());

    const executeHosts = (
      hosts: readonly string[]
    ): Effect.Effect<readonly PingExecutionResult[]> =>
      Effect.sync(() => new Date()).pipe(
        Effect.flatMap((cycleTimestamp) =>
          Effect.all(
            hosts.map((host) => executePingAt(host, cycleTimestamp)),
            { concurrency: "unbounded" }
          )
        )
      );

    const executeAll = (): Effect.Effect<readonly PingExecutionResult[]> =>
      executeHosts(config.ping.hosts);

    return {
      executePing,
      executeAll,
      executeHosts,
    };
  })
);
