import { Config, Context, Effect, Layer, Schedule } from 'effect';
import { PingExecutor } from '@/services/ping-executor';

// ============================================================================
// Types
// ============================================================================

export interface MonitorStats {
  readonly uptime: number;
  readonly lastPingTime: Date | null;
  readonly successfulPings: number;
  readonly failedPings: number;
}

// ============================================================================
// Service Interface
// ============================================================================

export interface NetworkMonitorInterface {
  /**
   * Start the periodic monitoring (ping every 60s by default)
   */
  readonly start: () => Effect.Effect<void, never>;

  /**
   * Get current monitoring statistics
   */
  readonly getStats: () => Effect.Effect<MonitorStats, never>;
}

// ============================================================================
// Service Tag
// ============================================================================

export class NetworkMonitor extends Context.Tag('NetworkMonitor')<
  NetworkMonitor,
  NetworkMonitorInterface
>() {}

// ============================================================================
// Service Implementation
// ============================================================================

export const NetworkMonitorLive = Layer.effect(
  NetworkMonitor,
  Effect.gen(function* () {
    const pingExecutor = yield* PingExecutor;

    // Read ping interval from config (default: 60 seconds)
    const pingIntervalSeconds = yield* Config.number(
      'PING_INTERVAL_SECONDS'
    ).pipe(Config.withDefault(60));

    // Stats tracking
    let startTime: Date | null = null;
    let lastPingTime: Date | null = null;
    let successfulPings = 0;
    let failedPings = 0;

    /**
     * Execute a single ping cycle and update stats
     */
    const executePingCycle = Effect.gen(function* () {
      const timestamp = new Date();

      Effect.logInfo('Starting ping cycle').pipe(Effect.runSync);

      const results = yield* pingExecutor.executeAll();

      lastPingTime = timestamp;
      const successCount = results.filter((r) => r.success).length;
      const failCount = results.filter((r) => !r.success).length;

      successfulPings += successCount;
      failedPings += failCount;

      yield* Effect.logInfo(
        `Ping cycle completed: ${successCount} successful, ${failCount} failed`
      );
    });

    /**
     * Start periodic monitoring
     */
    const start = () =>
      Effect.gen(function* () {
        startTime = new Date();

        yield* Effect.logInfo(
          `Starting network monitor (ping interval: ${pingIntervalSeconds}s)`
        );

        // Run initial ping immediately
        yield* executePingCycle;

        // Schedule periodic pings
        const schedule = Schedule.spaced(`${pingIntervalSeconds} seconds`);

        yield* executePingCycle.pipe(
          Effect.repeat(schedule),
          Effect.catchAll((error) =>
            Effect.logError(`Ping cycle error: ${error}`).pipe(
              Effect.flatMap(() => Effect.void)
            )
          ),
          Effect.fork
        );

        yield* Effect.logInfo('Network monitor started successfully');
      });

    /**
     * Get monitoring statistics
     */
    const getStats = () =>
      Effect.succeed({
        uptime: startTime ? Date.now() - startTime.getTime() : 0,
        lastPingTime,
        successfulPings,
        failedPings,
      } satisfies MonitorStats);

    return {
      start,
      getStats,
    };
  })
);
