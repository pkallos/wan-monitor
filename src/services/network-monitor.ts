import { Config, Context, Effect, Layer, Schedule } from 'effect';
import { QuestDB } from '@/database/questdb';
import { PingExecutor } from '@/services/ping-executor';
import { SpeedTestService } from '@/services/speedtest';

// ============================================================================
// Types
// ============================================================================

export interface MonitorStats {
  readonly uptime: number;
  readonly lastPingTime: Date | null;
  readonly lastSpeedTestTime: Date | null;
  readonly successfulPings: number;
  readonly failedPings: number;
  readonly successfulSpeedTests: number;
  readonly failedSpeedTests: number;
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
    const speedTestService = yield* SpeedTestService;
    const db = yield* QuestDB;

    // Read intervals from config
    const pingIntervalSeconds = yield* Config.number(
      'PING_INTERVAL_SECONDS'
    ).pipe(Config.withDefault(60));

    const speedTestIntervalSeconds = yield* Config.number(
      'SPEEDTEST_INTERVAL_SECONDS'
    ).pipe(Config.withDefault(3600)); // Default: 1 hour

    // Stats tracking
    let startTime: Date | null = null;
    let lastPingTime: Date | null = null;
    let lastSpeedTestTime: Date | null = null;
    let successfulPings = 0;
    let failedPings = 0;
    let successfulSpeedTests = 0;
    let failedSpeedTests = 0;

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
     * Execute a single speed test cycle and update stats
     */
    const executeSpeedTestCycle = Effect.gen(function* () {
      const timestamp = new Date();

      yield* speedTestService.runTest().pipe(
        Effect.flatMap((speedResult) =>
          db.writeMetric({
            timestamp: speedResult.timestamp,
            source: 'speedtest',
            latency: speedResult.latency,
            jitter: speedResult.jitter,
            downloadBandwidth: speedResult.downloadSpeed,
            uploadBandwidth: speedResult.uploadSpeed,
            serverLocation: speedResult.serverLocation,
            isp: speedResult.isp,
          })
        ),
        Effect.catchAll((error) => {
          failedSpeedTests += 1;
          const errorMsg =
            error && typeof error === 'object'
              ? JSON.stringify(error)
              : String(error);
          return Effect.logError(`Speed test failed: ${errorMsg}`).pipe(
            Effect.flatMap(() => Effect.fail(error))
          );
        })
      );

      lastSpeedTestTime = timestamp;
      successfulSpeedTests += 1;
    });

    /**
     * Start periodic monitoring
     */
    const start = () =>
      Effect.gen(function* () {
        startTime = new Date();

        yield* Effect.logInfo(
          `Starting network monitor (ping interval: ${pingIntervalSeconds}s, speed test interval: ${speedTestIntervalSeconds}s)`
        );

        // Run initial ping
        yield* executePingCycle;

        // Start ping monitoring (every 60s by default)
        const pingSchedule = Schedule.spaced(`${pingIntervalSeconds} seconds`);
        yield* executePingCycle.pipe(
          Effect.repeat(pingSchedule),
          Effect.catchAll((error) =>
            Effect.logError(`Ping cycle error: ${error}`).pipe(
              Effect.flatMap(() => Effect.void)
            )
          ),
          Effect.fork
        );

        // Start speed test monitoring (every 1 hour by default)
        const speedTestSchedule = Schedule.spaced(
          `${speedTestIntervalSeconds} seconds`
        );
        yield* executeSpeedTestCycle.pipe(
          Effect.repeat(speedTestSchedule),
          Effect.catchAll((error) =>
            Effect.logError(`Speed test cycle error: ${error}`).pipe(
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
        lastSpeedTestTime,
        successfulPings,
        failedPings,
        successfulSpeedTests,
        failedSpeedTests,
      } satisfies MonitorStats);

    return {
      start,
      getStats,
    };
  })
);
