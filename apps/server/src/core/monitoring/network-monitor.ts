import { mbpsToBps } from "@shared/metrics";
import { Clock, Context, Effect, Layer, Ref, Schedule } from "effect";
import { PingExecutor } from "@/core/monitoring/ping-executor";
import { ConfigService } from "@/infrastructure/config/config";
import { QuestDB } from "@/infrastructure/database/questdb";
// Import from speedtest-service to avoid native module loading in tests
import { SpeedTestService } from "@/infrastructure/speedtest/types";

// ============================================================================
// Internal Stats State (managed via Ref for atomic concurrent updates)
// ============================================================================

interface StatsState {
  readonly startTime: number | null;
  readonly lastPingTime: number | null;
  readonly successfulPings: number;
  readonly failedPings: number;
  readonly lastSpeedTestTime: number | null;
  readonly successfulSpeedTests: number;
  readonly failedSpeedTests: number;
}

const initialStats: StatsState = {
  startTime: null,
  lastPingTime: null,
  successfulPings: 0,
  failedPings: 0,
  lastSpeedTestTime: null,
  successfulSpeedTests: 0,
  failedSpeedTests: 0,
};

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
   * Start the periodic monitoring (ping every 30s by default)
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
    const config = yield* ConfigService;

    const pingIntervalSeconds = config.ping.intervalSeconds;
    const speedTestIntervalSeconds = config.speedtest.intervalSeconds;

    // Stats tracking via Ref for atomic concurrent updates
    const statsRef = yield* Ref.make<StatsState>(initialStats);

    /**
     * Execute a single ping cycle and update stats
     */
    const executePingCycle = Effect.gen(function* () {
      const timestamp = yield* Clock.currentTimeMillis;

      yield* Effect.logInfo("Starting ping cycle");

      const results = yield* pingExecutor.executeAll();

      const successCount = results.filter((r) => r.success).length;
      const failCount = results.filter((r) => !r.success).length;

      yield* Ref.update(statsRef, (s) => ({
        ...s,
        lastPingTime: timestamp,
        successfulPings: s.successfulPings + successCount,
        failedPings: s.failedPings + failCount,
      }));

      yield* Effect.logInfo(
        `Ping cycle completed: ${successCount} successful, ${failCount} failed`
      );
    });

    /**
     * Execute a single speedtest cycle and update stats
     */
    const executeSpeedTestCycle = Effect.gen(function* () {
      const timestamp = yield* Clock.currentTimeMillis;

      const result = yield* speedTestService.runTest().pipe(
        Effect.catchTags({
          SpeedTestExecutionError: (error) =>
            Effect.gen(function* () {
              yield* Ref.update(statsRef, (s) => ({
                ...s,
                failedSpeedTests: s.failedSpeedTests + 1,
              }));
              yield* Effect.logError(
                `Speed test failed: SpeedTestExecutionError - ${error.message}`
              );
              return yield* Effect.fail(error);
            }),
          SpeedTestTimeoutError: (error) =>
            Effect.gen(function* () {
              yield* Ref.update(statsRef, (s) => ({
                ...s,
                failedSpeedTests: s.failedSpeedTests + 1,
              }));
              yield* Effect.logError(
                `Speed test failed: SpeedTestTimeoutError - Timeout after ${error.timeoutMs}ms`
              );
              return yield* Effect.fail(error);
            }),
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

      yield* Ref.update(statsRef, (s) => ({
        ...s,
        lastSpeedTestTime: timestamp,
        successfulSpeedTests: s.successfulSpeedTests + (writeSucceeded ? 1 : 0),
        failedSpeedTests: s.failedSpeedTests + (writeSucceeded ? 0 : 1),
      }));
    });

    /**
     * Start periodic monitoring
     */
    const start = () =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        yield* Ref.update(statsRef, (s) => ({
          ...s,
          startTime: now,
        }));

        yield* Effect.logInfo(
          `Starting network monitor (ping interval: ${pingIntervalSeconds}s)`
        );

        // Run initial ping immediately
        yield* executePingCycle;

        // Schedule periodic pings
        const schedule = Schedule.spaced(`${pingIntervalSeconds} seconds`);

        yield* executePingCycle.pipe(
          Effect.catchAll((error) =>
            Effect.logError(`Ping cycle error: ${error}`).pipe(
              Effect.flatMap(() => Effect.void)
            )
          ),
          Effect.repeat(schedule),
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
          Effect.catchAll((error) =>
            Effect.logError(`Speed test cycle error: ${error}`).pipe(
              Effect.flatMap(() => Effect.void)
            )
          ),
          Effect.repeat(speedTestSchedule),
          Effect.fork
        );

        yield* Effect.logInfo("Network monitor started successfully");
      });

    /**
     * Get monitoring statistics
     */
    const getStats = () =>
      Effect.gen(function* () {
        const s = yield* Ref.get(statsRef);
        const now = yield* Clock.currentTimeMillis;
        return {
          uptime: s.startTime ? now - s.startTime : 0,
          lastPingTime: s.lastPingTime ? new Date(s.lastPingTime) : null,
          successfulPings: s.successfulPings,
          failedPings: s.failedPings,
          lastSpeedTestTime: s.lastSpeedTestTime
            ? new Date(s.lastSpeedTestTime)
            : null,
          successfulSpeedTests: s.successfulSpeedTests,
          failedSpeedTests: s.failedSpeedTests,
        } satisfies MonitorStats;
      });

    return {
      start,
      getStats,
    };
  })
);
