import { Context, Effect, Layer } from 'effect';
import { QuestDB } from '@/database/questdb';
import { ConfigService } from '@/services/config';
import { type PingResult, PingService } from '@/services/ping';
import type { NetworkMetric } from '@/types/metrics';

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

export class PingExecutor extends Context.Tag('PingExecutor')<
  PingExecutor,
  PingExecutorInterface
>() {}

// ============================================================================
// Helper: Convert PingResult to NetworkMetric
// ============================================================================

const pingResultToMetric = (result: PingResult): NetworkMetric => ({
  timestamp: new Date(),
  source: 'ping' as const,
  host: result.host,
  latency: result.latency,
  packetLoss: result.packetLoss,
  jitter: result.stddev,
  connectivityStatus: result.alive ? 'up' : 'down',
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

    const executePing = (
      host: string
    ): Effect.Effect<PingExecutionResult, never> =>
      pingService.ping(host).pipe(
        // Success path - write metric to database
        Effect.flatMap((result) => {
          const metric = pingResultToMetric(result);
          return db.writeMetric(metric).pipe(
            Effect.map(
              (): PingExecutionResult => ({
                host,
                success: true,
                result,
              })
            ),
            Effect.catchAll((writeError) =>
              Effect.succeed({
                host,
                success: false,
                result,
                error: `Database write failed: ${writeError.message}`,
              })
            )
          );
        }),
        // Failure path - write "down" metric
        Effect.catchAll((pingError) => {
          const errorMetric: NetworkMetric = {
            timestamp: new Date(),
            source: 'ping',
            host,
            latency: -1,
            packetLoss: 100,
            connectivityStatus: 'down',
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

    const executeHosts = (
      hosts: readonly string[]
    ): Effect.Effect<readonly PingExecutionResult[]> =>
      Effect.all(hosts.map(executePing), { concurrency: 'unbounded' });

    const executeAll = (): Effect.Effect<readonly PingExecutionResult[]> =>
      executeHosts(config.ping.hosts);

    return {
      executePing,
      executeAll,
      executeHosts,
    };
  })
);
