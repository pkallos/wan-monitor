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
        Effect.flatMap((result) => {
          const metric = pingResultToMetric(result, timestamp);
          return db.writeMetric(metric).pipe(
            Effect.map(
              (): PingExecutionResult => ({
                host,
                success: true,
                result,
              })
            ),
            Effect.catch((writeError) =>
              Effect.succeed({
                host,
                success: false,
                result,
                error: `Database write failed: ${writeError.message}`,
              })
            )
          );
        }),
        // Failure path - write "down" metric with no latency (NULL in DB)
        // Omitting latency ensures avg() aggregations aren't skewed by failures
        Effect.catch((pingError) => {
          const errorMetric: NetworkMetric = {
            timestamp,
            source: "ping",
            host,
            // latency omitted - no measurement available on failure
            packetLoss: 100,
            connectivityStatus: "down",
          };

          return db.writeMetric(errorMetric).pipe(
            Effect.ignore,
            Effect.map(
              (): PingExecutionResult => ({
                host,
                success: false,
                error: pingError._tag,
              })
            )
          );
        })
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
