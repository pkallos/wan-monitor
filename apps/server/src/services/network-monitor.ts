import { mbpsToBps } from "@wan-monitor/shared";
import { Config, Context, Effect, Layer, Schedule } from "effect";
import { QuestDB } from "@/database/questdb";
import { PingExecutor } from "@/services/ping-executor";
// Import from speedtest-service to avoid native module loading in tests
import { SpeedTestService } from "@/services/speedtest-service";

// ============================================================================
// Types
// ============================================================================

export interface MonitorStats {
  readonly uptime: number;
  readonly lastPingTime: Date | null;
  readonly successfulPings: number;
  readonly failedPings: number;
  readonly lastSpeedTestTime: Date | null;
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

export class NetworkMonitor extends Context.Tag("NetworkMonitor")<
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

    // Read ping interval from config (default: 60 seconds)
    const pingIntervalSeconds = yield* Config.number(
      "PING_INTERVAL_SECONDS"
    ).pipe(Config.withDefault(60));

    // Read speedtest interval from config (default: 1 hour = 3600 seconds)
    const speedTestIntervalSeconds = yield* Config.number(
      "SPEEDTEST_INTERVAL_SECONDS"
    ).pipe(Config.withDefault(3600));

    // Stats tracking
    let startTime: Date | null = null;
    let lastPingTime: Date | null = null;
    let successfulPings = 0;
    let failedPings = 0;
    let lastSpeedTestTime: Date | null = null;
    let successfulSpeedTests = 0;
    let failedSpeedTests = 0;

    /**
     * Execute a single ping cycle and update stats
     */
    const executePingCycle = Effect.gen(function* () {
      const timestamp = new Date();

      yield* Effect.logInfo("Starting ping cycle");

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
     * Execute a single speedtest cycle and update stats
     */
    const executeSpeedTestCycle = Effect.gen(function* () {
      const timestamp = new Date();

      const result = yield* speedTestService.runTest().pipe(
        Effect.catchAll((error) => {
          failedSpeedTests++;
          const errorMessage =
            error._tag === "SpeedTestExecutionError"
              ? error.message
              : error._tag === "SpeedTestTimeoutError"
                ? `Timeout after ${error.timeoutMs}ms`
                : String(error);
          return Effect.flatMap(
            Effect.logError(
              `Speed test failed: ${error._tag} - ${errorMessage}`
            ),
            () => Effect.fail(error)
          );
        })
      );

      // Write speed test result to database
      const writeSucceeded = yield* db
        .writeMetric({
          timestamp: result.timestamp,
          source: "speedtest" as const,
          latency: result.latency,
          jitter: result.jitter,
          downloadBandwidth: mbpsToBps(result.downloadSpeed),
          uploadBandwidth: mbpsToBps(result.uploadSpeed),
          serverLocation: result.serverLocation,
          isp: result.isp,
          externalIp: result.externalIp,
          internalIp: result.internalIp,
        })
        .pipe(
          Effect.as(true as const),
          Effect.catchAll((error) =>
            Effect.logError(
              `Speed test DB write failed: ${error._tag} - ${error.message}`
            ).pipe(Effect.as(false as const))
          )
        );

      lastSpeedTestTime = timestamp;
      if (writeSucceeded) {
        successfulSpeedTests++;
      } else {
        failedSpeedTests++;
      }
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

        // Schedule periodic speed tests
        yield* Effect.logInfo(
          `Starting speed test monitor (interval: ${speedTestIntervalSeconds}s)`
        );
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

        yield* Effect.logInfo("Network monitor started successfully");
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
        lastSpeedTestTime,
        successfulSpeedTests,
        failedSpeedTests,
      } satisfies MonitorStats);

    return {
      start,
      getStats,
    };
  })
);
