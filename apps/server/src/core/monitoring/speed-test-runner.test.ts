import { describe, expect, it } from "@effect/vitest";
import type { NetworkMetric } from "@shared/metrics";
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  References,
} from "effect";
import {
  SpeedTestRunner,
  type SpeedTestRunnerInterface,
} from "@/core/monitoring/speed-test-runner";
import {
  DatabaseWriteError,
  QuestDB,
  type QuestDBService,
} from "@/infrastructure/database/questdb";
import {
  SpeedTestExecutionError,
  SpeedTestTimeoutError,
} from "@/infrastructure/speedtest/errors";
import {
  type SpeedTestResult,
  SpeedTestService,
  type SpeedTestServiceInterface,
} from "@/infrastructure/speedtest/types";
import { emptyAnalyticsQueries } from "@/test/questdb-stubs";
import { speedTestRunnerFrom } from "@/test/speedtest-runner";

const result: SpeedTestResult = {
  timestamp: new Date("2024-01-01T12:00:00Z"),
  downloadSpeed: 100.5,
  uploadSpeed: 50.2,
  latency: 15.3,
  jitter: 2.5,
  serverLocation: "San Francisco, CA",
  isp: "Test ISP",
  externalIp: "1.2.3.4",
  internalIp: "192.168.1.100",
};

const dbWith = (overrides: Partial<QuestDBService> = {}): QuestDBService => ({
  writeMetric: () => Effect.void,
  flush: () => Effect.void,
  queryMetrics: () => Effect.succeed([]),
  querySpeedtests: () => Effect.succeed([]),
  queryConnectivityStatus: () => Effect.succeed([]),
  queryLiveConnectivity: () => Effect.succeed(null),
  queryEarliestTimestamp: () => Effect.succeed(null),
  queryLatestPingTimestamp: () => Effect.succeed(null),
  ...emptyAnalyticsQueries,
  health: () => Effect.succeed({ connected: true, uptime: 1 }),
  close: () => Effect.void,
  ...overrides,
});

const silent = Layer.succeed(References.MinimumLogLevel, "None");

const runnerLayer = (
  speedTest: SpeedTestServiceInterface,
  db: QuestDBService = dbWith()
) =>
  Layer.merge(
    speedTestRunnerFrom(
      Layer.succeed(SpeedTestService, speedTest),
      Layer.succeed(QuestDB, db)
    ),
    silent
  );

/** A service whose test does not finish until `gate` is opened, counting how often it starts. */
const gatedService = Effect.gen(function* () {
  const gate = yield* Deferred.make<void>();
  const started = yield* Deferred.make<void>();
  const calls = { count: 0 };
  const service: SpeedTestServiceInterface = {
    runTest: () =>
      Effect.suspend(() => {
        calls.count += 1;
        return Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(gate)),
          Effect.as(result)
        );
      }),
  };
  return {
    service,
    calls,
    started: Deferred.await(started),
    open: Deferred.succeed(gate, undefined),
  };
});

const withRunner = <A, E>(
  use: (runner: SpeedTestRunnerInterface) => Effect.Effect<A, E>
) => SpeedTestRunner.pipe(Effect.flatMap(use));

describe("SpeedTestRunner", () => {
  describe("overlap", () => {
    it.effect(
      "refuses a manual run while a scheduled run is in flight and reports it running",
      () =>
        Effect.gen(function* () {
          const gated = yield* gatedService;

          return yield* withRunner((runner) =>
            Effect.gen(function* () {
              expect(yield* runner.isRunning()).toBe(false);

              const scheduled = yield* Effect.forkChild(runner.run());
              yield* gated.started;

              expect(yield* runner.isRunning()).toBe(true);
              expect(Option.isNone(yield* runner.runIfIdle())).toBe(true);
              expect(gated.calls.count).toBe(1);

              yield* gated.open;
              const outcome = yield* Fiber.join(scheduled);

              expect(outcome.result).toEqual(result);
              expect(yield* runner.isRunning()).toBe(false);
            })
          ).pipe(Effect.provide(runnerLayer(gated.service)));
        })
    );

    it.effect("answers a manual run at once instead of queueing it", () =>
      Effect.gen(function* () {
        const gated = yield* gatedService;

        return yield* withRunner((runner) =>
          Effect.gen(function* () {
            const scheduled = yield* Effect.forkChild(runner.run());
            yield* gated.started;

            const manual = yield* Effect.forkChild(runner.runIfIdle());
            yield* Effect.yieldNow;

            expect(manual.pollUnsafe()).toBeDefined();

            yield* gated.open;
            yield* Fiber.join(scheduled);
          })
        ).pipe(Effect.provide(runnerLayer(gated.service)));
      })
    );

    it.effect(
      "makes a scheduled run wait behind a manual run instead of overlapping it",
      () =>
        Effect.gen(function* () {
          const gated = yield* gatedService;

          return yield* withRunner((runner) =>
            Effect.gen(function* () {
              const manual = yield* Effect.forkChild(runner.runIfIdle());
              yield* gated.started;

              const scheduled = yield* Effect.forkChild(runner.run());
              yield* Effect.yieldNow;

              expect(scheduled.pollUnsafe()).toBeUndefined();
              expect(gated.calls.count).toBe(1);

              yield* gated.open;
              yield* Fiber.join(manual);
              yield* Fiber.join(scheduled);

              expect(gated.calls.count).toBe(2);
            })
          ).pipe(Effect.provide(runnerLayer(gated.service)));
        })
    );

    it.effect(
      "starts one of several simultaneous manual runs and queues none",
      () =>
        Effect.gen(function* () {
          const gated = yield* gatedService;

          return yield* withRunner((runner) =>
            Effect.gen(function* () {
              const claims = Array.from({ length: 8 }, () =>
                runner.runIfIdle()
              );
              const [claimed] = yield* Effect.all(
                [
                  Effect.all(claims, { concurrency: "unbounded" }),
                  gated.started.pipe(
                    Effect.andThen(Effect.yieldNow),
                    Effect.andThen(gated.open)
                  ),
                ],
                { concurrency: "unbounded" }
              );

              expect(claimed.filter(Option.isSome)).toHaveLength(1);
              expect(gated.calls.count).toBe(1);
            })
          ).pipe(Effect.provide(runnerLayer(gated.service)));
        })
    );
  });

  describe("releasing the permit", () => {
    const failing = (
      error: SpeedTestExecutionError | SpeedTestTimeoutError
    ): SpeedTestServiceInterface => ({ runTest: () => Effect.fail(error) });

    for (const [label, error] of [
      ["an execution error", new SpeedTestExecutionError({ message: "boom" })],
      ["a timeout", new SpeedTestTimeoutError({ timeoutMs: 1000 })],
    ] as const) {
      it.effect(`frees the runner after ${label}`, () =>
        withRunner((runner) =>
          Effect.gen(function* () {
            const exit = yield* Effect.exit(runner.runIfIdle());
            const failure = Exit.isFailure(exit)
              ? Cause.findErrorOption(exit.cause)
              : Option.none();

            expect(Option.getOrUndefined(failure)).toBe(error);
            expect(yield* runner.isRunning()).toBe(false);

            const retry = yield* Effect.exit(runner.runIfIdle());
            expect(Exit.isFailure(retry)).toBe(true);
          })
        ).pipe(Effect.provide(runnerLayer(failing(error))))
      );
    }

    it.effect("frees the runner when the run is interrupted", () =>
      Effect.gen(function* () {
        const gated = yield* gatedService;

        return yield* withRunner((runner) =>
          Effect.gen(function* () {
            const fiber = yield* Effect.forkChild(runner.runIfIdle());
            yield* gated.started;
            expect(yield* runner.isRunning()).toBe(true);

            yield* Fiber.interrupt(fiber);

            expect(yield* runner.isRunning()).toBe(false);
            const next = yield* Effect.forkChild(runner.runIfIdle());
            yield* gated.open;
            expect(Option.isSome(yield* Fiber.join(next))).toBe(true);
          })
        ).pipe(Effect.provide(runnerLayer(gated.service)));
      })
    );
  });

  describe("persisting", () => {
    const succeeding = (
      testResult: SpeedTestResult
    ): SpeedTestServiceInterface => ({
      runTest: () => Effect.succeed(testResult),
    });

    const capturing = (written: NetworkMetric[]) =>
      dbWith({
        writeMetric: (metric) =>
          Effect.sync(() => {
            written.push(metric);
          }),
      });

    it.effect("writes the result once, in bps", () => {
      const written: NetworkMetric[] = [];

      return withRunner((runner) =>
        Effect.gen(function* () {
          const outcome = yield* runner.run();

          expect(outcome.persisted).toBe(true);
          expect(written).toEqual([
            {
              timestamp: result.timestamp,
              source: "speedtest",
              latency: 15.3,
              jitter: 2.5,
              downloadBandwidth: 100_500_000,
              uploadBandwidth: 50_200_000,
              serverLocation: "San Francisco, CA",
              isp: "Test ISP",
              externalIp: "1.2.3.4",
              internalIp: "192.168.1.100",
            },
          ]);
        })
      ).pipe(
        Effect.provide(runnerLayer(succeeding(result), capturing(written)))
      );
    });

    it.effect(
      "writes no bandwidth or latency for a measurement that is missing",
      () => {
        const written: NetworkMetric[] = [];

        return withRunner((runner) =>
          Effect.gen(function* () {
            yield* runner.run();

            expect(written).toHaveLength(1);
            expect(written[0].downloadBandwidth).toBeUndefined();
            expect(written[0].uploadBandwidth).toBeUndefined();
            expect(written[0].latency).toBeUndefined();
            expect(written[0].isp).toBe("Test ISP");
          })
        ).pipe(
          Effect.provide(
            runnerLayer(
              succeeding({ timestamp: result.timestamp, isp: "Test ISP" }),
              capturing(written)
            )
          )
        );
      }
    );

    it.effect("keeps a measured 0 ms latency", () => {
      const written: NetworkMetric[] = [];

      return withRunner((runner) =>
        Effect.gen(function* () {
          yield* runner.run();

          expect(written[0].latency).toBe(0);
        })
      ).pipe(
        Effect.provide(
          runnerLayer(
            succeeding({ timestamp: result.timestamp, latency: 0 }),
            capturing(written)
          )
        )
      );
    });

    it.effect(
      "still returns the result, flagged unpersisted, when the write fails",
      () =>
        withRunner((runner) =>
          Effect.gen(function* () {
            const outcome = yield* runner.run();

            expect(outcome.persisted).toBe(false);
            expect(outcome.result).toEqual(result);
            expect(yield* runner.isRunning()).toBe(false);
          })
        ).pipe(
          Effect.provide(
            runnerLayer(
              succeeding(result),
              dbWith({
                writeMetric: () =>
                  Effect.fail(new DatabaseWriteError({ message: "disk full" })),
              })
            )
          )
        )
    );

    it.live(
      "finishes the write of a measured result even when interrupted during it",
      () => {
        const written: NetworkMetric[] = [];
        const slowWrite = dbWith({
          writeMetric: (metric) =>
            Effect.sleep("50 millis").pipe(
              Effect.andThen(
                Effect.sync(() => {
                  written.push(metric);
                })
              )
            ),
        });

        return withRunner((runner) =>
          Effect.gen(function* () {
            const fiber = yield* Effect.forkChild(runner.run());
            yield* Effect.sleep("10 millis");

            yield* Fiber.interrupt(fiber);

            expect(written).toHaveLength(1);
          })
        ).pipe(Effect.provide(runnerLayer(succeeding(result), slowWrite)));
      }
    );
  });
});
