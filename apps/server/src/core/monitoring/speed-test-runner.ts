import { mbpsToBps, type NetworkMetric } from "@shared/metrics";
import { Context, Effect, Layer, type Option, Ref, Semaphore } from "effect";
import { QuestDB } from "@/infrastructure/database/questdb";
import type { SpeedTestError } from "@/infrastructure/speedtest/errors";
// Import from types to avoid loading the speedtest-net native module in tests
import {
  type SpeedTestResult,
  SpeedTestService,
} from "@/infrastructure/speedtest/types";

export interface SpeedTestOutcome {
  readonly result: SpeedTestResult;
  /** False when the measurement succeeded but the database write failed. */
  readonly persisted: boolean;
}

export interface SpeedTestRunnerInterface {
  /** Waits for any running test to finish, then runs and stores one. */
  readonly run: () => Effect.Effect<SpeedTestOutcome, SpeedTestError>;
  /** Runs and stores a test, or answers `None` at once when one is already running. */
  readonly runIfIdle: () => Effect.Effect<
    Option.Option<SpeedTestOutcome>,
    SpeedTestError
  >;
  readonly isRunning: () => Effect.Effect<boolean>;
}

export class SpeedTestRunner extends Context.Service<
  SpeedTestRunner,
  SpeedTestRunnerInterface
>()("SpeedTestRunner") {}

const optionalBps = (mbps: number | undefined): number | undefined =>
  mbps === undefined ? undefined : mbpsToBps(mbps);

const toNetworkMetric = (result: SpeedTestResult): NetworkMetric => ({
  timestamp: result.timestamp,
  source: "speedtest",
  latency: result.latency,
  jitter: result.jitter,
  downloadBandwidth: optionalBps(result.downloadSpeed),
  uploadBandwidth: optionalBps(result.uploadSpeed),
  serverLocation: result.serverLocation,
  isp: result.isp,
  externalIp: result.externalIp,
  internalIp: result.internalIp,
});

/**
 * Admits one speed test at a time across the scheduler and manual trigger,
 * since concurrent tests on one link skew each other. `isRunning` is a status flag only.
 */
export const SpeedTestRunnerLive = Layer.effect(
  SpeedTestRunner,
  Effect.gen(function* () {
    const speedTestService = yield* SpeedTestService;
    const db = yield* QuestDB;
    const permit = yield* Semaphore.make(1);
    const running = yield* Ref.make(false);

    const runAndPersist = Effect.gen(function* () {
      const result = yield* speedTestService.runTest();

      // A finished measurement is not worth losing to a client that
      // disconnects while it is being written.
      const persisted = yield* Effect.uninterruptible(
        db.writeMetric(toNetworkMetric(result)).pipe(
          Effect.as(true),
          Effect.catch((error) =>
            Effect.logError(
              `Speed test DB write failed: ${error._tag} - ${error.message}`
            ).pipe(Effect.as(false))
          )
        )
      );

      return { result, persisted } satisfies SpeedTestOutcome;
    });

    const guarded = Ref.set(running, true).pipe(
      Effect.andThen(runAndPersist),
      Effect.ensuring(Ref.set(running, false))
    );

    return {
      run: () => permit.withPermit(guarded),
      runIfIdle: () => permit.withPermitsIfAvailable(1)(guarded),
      isRunning: () => Ref.get(running),
    };
  })
);
