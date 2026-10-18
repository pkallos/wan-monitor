import {
  Clock,
  Context,
  Effect,
  Layer,
  Ref,
  Schedule,
  type Scope,
} from "effect";
import { PingExecutor } from "@/core/monitoring/ping-executor";
import { SpeedTestRunner } from "@/core/monitoring/speed-test-runner";
import { ConfigService } from "@/infrastructure/config/config";

// ============================================================================
// Internal Stats State (managed via Ref for atomic concurrent updates)
// ============================================================================

interface StatsState {
  readonly startTime: number | null;
  readonly lastPingTime: number | null;
  readonly successfulPings: number;
  readonly failedPings: number;
  readonly failedWrites: number;
  readonly lastSpeedTestTime: number | null;
  readonly successfulSpeedTests: number;
  readonly failedSpeedTests: number;
}

const initialStats: StatsState = {
  startTime: null,
  lastPingTime: null,
  successfulPings: 0,
  failedPings: 0,
  failedWrites: 0,
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
  /** Ping results whose row could not be stored; counted apart from `failedPings`. */
  readonly failedWrites: number;
  readonly lastSpeedTestTime: Date | null;
  readonly successfulSpeedTests: number;
  readonly failedSpeedTests: number;
}

// ============================================================================
// Service Interface
// ============================================================================

export interface NetworkMonitorInterface {
  /**
   * Runs one ping cycle, then starts the periodic ping and speed test loops.
   * The loops run until the provided Scope closes.
   */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;

  /**
   * Get current monitoring statistics
   */
  readonly getStats: () => Effect.Effect<MonitorStats, never>;
}

// ============================================================================
// Service Tag
// ============================================================================

export class NetworkMonitor extends Context.Service<
  NetworkMonitor,
  NetworkMonitorInterface
>()("NetworkMonitor") {}

// ============================================================================
// Service Implementation
// ============================================================================

export const NetworkMonitorLive = Layer.effect(
  NetworkMonitor,
  Effect.gen(function* () {
    const pingExecutor = yield* PingExecutor;
    const speedTestRunner = yield* SpeedTestRunner;
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
      const failedWriteCount = results.filter(
        (r) => r.writeError !== undefined
      ).length;

      yield* Ref.update(statsRef, (s) => ({
        ...s,
        lastPingTime: timestamp,
        successfulPings: s.successfulPings + successCount,
        failedPings: s.failedPings + failCount,
        failedWrites: s.failedWrites + failedWriteCount,
      }));

      yield* Effect.logInfo(
        `Ping cycle completed: ${successCount} successful, ${failCount} failed, ${failedWriteCount} failed writes`
      );
    });

    /**
     * Execute a single speedtest cycle and update stats
     */
    const executeSpeedTestCycle = Effect.gen(function* () {
      const { persisted } = yield* speedTestRunner.run().pipe(
        Effect.tapError((error) =>
          Ref.update(statsRef, (s) => ({
            ...s,
            failedSpeedTests: s.failedSpeedTests + 1,
          })).pipe(
            Effect.andThen(
              Effect.logError(
                `Speed test failed: ${error._tag} - ${error.message}`
              )
            )
          )
        )
      );

      const finishedAt = yield* Clock.currentTimeMillis;
      yield* Ref.update(statsRef, (s) => ({
        ...s,
        lastSpeedTestTime: finishedAt,
        successfulSpeedTests: s.successfulSpeedTests + (persisted ? 1 : 0),
        failedSpeedTests: s.failedSpeedTests + (persisted ? 0 : 1),
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

        yield* executePingCycle;

        // fixed, not spaced: cycle starts stay on the interval grid instead of
        // drifting by each cycle's length; outage detection reads that period.
        yield* executePingCycle.pipe(
          Effect.schedule(Schedule.fixed(`${pingIntervalSeconds} seconds`)),
          Effect.forkScoped
        );

        yield* Effect.logInfo(
          `Starting speed test monitor (interval: ${speedTestIntervalSeconds}s)`
        );
        const speedTestSchedule = Schedule.spaced(
          `${speedTestIntervalSeconds} seconds`
        );

        yield* executeSpeedTestCycle.pipe(
          Effect.catch((error) =>
            Effect.logError(`Speed test cycle error: ${error}`)
          ),
          Effect.repeat(speedTestSchedule),
          Effect.forkScoped
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
          failedWrites: s.failedWrites,
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
