import { describe, expect, it } from "@effect/vitest";
import { DbUnavailable } from "@shared/api/errors";
import type { ConnectivityStatus } from "@shared/metrics";
import { DEFAULT_GRANULARITY, MAX_OUTAGE_SPAN_DAYS } from "@wan-monitor/shared";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import { vi } from "vitest";
import { MAX_OUTAGES } from "@/core/analytics/outages";
import {
  getConnectivityStatusHandler,
  getLiveConnectivityHandler,
  getOutagesHandler,
} from "@/core/api/handlers/connectivity-status";
import {
  DatabaseUnavailable,
  QuestDB,
  type QuestDBService,
} from "@/infrastructure/database/questdb";
import type {
  ConnectivityStatusRow,
  OutageRun,
  QueryConnectivityParams,
  QueryStateParams,
} from "@/infrastructure/database/questdb/model";
import { makeTestConfigLayer } from "@/test/config";
import { invalidTimeRangeOf } from "@/test/invalid-time-range";
import { emptyAnalyticsQueries } from "@/test/questdb-stubs";

const NOW = Date.parse("2024-01-03T00:00:00Z");
const MICROS = 1_000_000;

/** The clock every handler reads; the TestClock starts at the epoch. */
const atNow = (nowMs = NOW) => TestClock.setTime(nowMs);

const bucketRow = (
  bucket: string,
  seconds: { up?: number; degraded?: number; down?: number }
): ConnectivityStatusRow => ({
  bucket,
  up_micros: (seconds.up ?? 0) * MICROS,
  degraded_micros: (seconds.degraded ?? 0) * MICROS,
  down_micros: (seconds.down ?? 0) * MICROS,
});

const createMockQuestDB = (
  mockRows: readonly ConnectivityStatusRow[],
  onQuery?: (params: QueryConnectivityParams) => void
): QuestDBService => ({
  health: () =>
    Effect.succeed({ connected: true, version: "1.0.0", uptime: 100 }),
  writeMetric: () => Effect.void,
  flush: () => Effect.void,
  queryMetrics: () => Effect.succeed([]),
  querySpeedtests: () => Effect.succeed([]),
  queryConnectivityStatus: (params) => {
    onQuery?.(params);
    return Effect.succeed(mockRows);
  },
  queryLiveConnectivity: () => Effect.succeed(null),
  queryEarliestTimestamp: () => Effect.succeed(null),
  queryLatestPingTimestamp: () => Effect.succeed(null),
  ...emptyAnalyticsQueries,
  close: () => Effect.void,
});

const createMockLiveQuestDB = (options: {
  readonly state?: ConnectivityStatus;
  readonly latestPingTimestamp?: string;
  readonly onLiveQuery?: (
    params: Pick<QueryStateParams, "nowMs" | "intervalMs" | "hosts">
  ) => void;
  readonly onLatestPingQuery?: () => void;
  readonly liveUnavailable?: boolean;
}): QuestDBService => ({
  ...createMockQuestDB([]),
  queryLiveConnectivity: (params) => {
    options.onLiveQuery?.(params);
    return options.liveUnavailable
      ? Effect.fail(new DatabaseUnavailable({ message: "connection refused" }))
      : Effect.succeed(options.state ?? null);
  },
  queryLatestPingTimestamp: () => {
    options.onLatestPingQuery?.();
    return Effect.succeed(options.latestPingTimestamp ?? null);
  },
});

const handlerLayers = (
  db: QuestDBService,
  pingIntervalSeconds = 30,
  hosts: readonly string[] = ["8.8.8.8", "1.1.1.1"]
) =>
  Layer.mergeAll(
    Layer.succeed(QuestDB, db),
    makeTestConfigLayer({
      ping: { intervalSeconds: pingIntervalSeconds, hosts: [...hosts] },
    })
  );

describe("Connectivity Status Handlers", () => {
  describe("getConnectivityStatus", () => {
    it.effect(
      "calculates status and percentages from time in each state",
      () => {
        const mockRows = [
          bucketRow("2024-01-01T00:00:00Z", { up: 3600 }),
          bucketRow("2024-01-01T01:00:00Z", { up: 2880, down: 720 }),
        ];
        const QuestDBTest = handlerLayers(createMockQuestDB(mockRows));

        return Effect.gen(function* () {
          yield* atNow();
          const result = yield* getConnectivityStatusHandler({ query: {} });

          expect(result.data).toHaveLength(2);
          expect(result.data[0].timestamp).toBe("2024-01-01T00:00:00Z");
          expect(result.data[0].status).toBe("up");
          expect(result.data[0].upPercentage).toBe(100);
          expect(result.data[1].status).toBe("down");
          expect(result.data[1].downPercentage).toBe(20);
          expect(result.data[1].upPercentage).toBe(80);
          expect(result.meta.uptimePercentage).toBe(90);
          expect(result.meta.availabilityPercentage).toBe(90);
        }).pipe(Effect.provide(QuestDBTest));
      }
    );

    it.effect("handles degraded status", () => {
      const mockRows = [
        bucketRow("2024-01-01T00:00:00Z", { up: 2520, degraded: 1080 }),
      ];
      const QuestDBTest = handlerLayers(createMockQuestDB(mockRows));

      return Effect.gen(function* () {
        yield* atNow();
        const result = yield* getConnectivityStatusHandler({ query: {} });

        expect(result.data[0].status).toBe("degraded");
        expect(result.data[0].degradedPercentage).toBe(30);
      }).pipe(Effect.provide(QuestDBTest));
    });

    it.effect(
      "under 5% degraded time in a coarse bucket stays up, not degraded",
      () => {
        const mockRows = [
          bucketRow("2024-01-01T00:00:00Z", { up: 3_430, degraded: 170 }),
        ];
        const QuestDBTest = handlerLayers(createMockQuestDB(mockRows));

        return Effect.gen(function* () {
          yield* atNow();
          const result = yield* getConnectivityStatusHandler({ query: {} });

          expect(result.data[0].status).toBe("up");
        }).pipe(Effect.provide(QuestDBTest));
      }
    );

    it.effect(
      "a sustained share of degraded time in a coarse bucket still reads as degraded",
      () => {
        const mockRows = [
          bucketRow("2024-01-01T00:00:00Z", { up: 3_240, degraded: 360 }),
        ];
        const QuestDBTest = handlerLayers(createMockQuestDB(mockRows));

        return Effect.gen(function* () {
          yield* atNow();
          const result = yield* getConnectivityStatusHandler({ query: {} });

          expect(result.data[0].status).toBe("degraded");
        }).pipe(Effect.provide(QuestDBTest));
      }
    );

    it.effect(
      "availabilityPercentage counts degraded as available, unlike uptimePercentage",
      () => {
        const mockRows = [
          bucketRow("2024-01-01T00:00:00Z", { up: 2520, degraded: 1080 }),
        ];
        const QuestDBTest = handlerLayers(createMockQuestDB(mockRows));

        return Effect.gen(function* () {
          yield* atNow();
          const result = yield* getConnectivityStatusHandler({ query: {} });

          expect(result.meta.uptimePercentage).toBe(70);
          expect(result.meta.availabilityPercentage).toBe(100);
        }).pipe(Effect.provide(QuestDBTest));
      }
    );

    it.effect(
      "passes the window, the clock, the interval and the hosts to the query",
      () => {
        const onQuery = vi.fn();
        const QuestDBTest = handlerLayers(createMockQuestDB([], onQuery), 45, [
          "8.8.8.8",
          "example.org",
        ]);

        return Effect.gen(function* () {
          yield* atNow();
          yield* getConnectivityStatusHandler({
            query: {
              startTime: "2024-01-01T00:00:00Z",
              endTime: "2024-01-02T00:00:00Z",
              granularity: "1h",
            },
          });

          expect(onQuery).toHaveBeenCalledWith({
            startTime: new Date("2024-01-01T00:00:00Z"),
            endTime: new Date("2024-01-02T00:00:00Z"),
            granularity: "1h",
            nowMs: NOW,
            intervalMs: 45_000,
            hosts: ["8.8.8.8", "example.org"],
          });
        }).pipe(Effect.provide(QuestDBTest));
      }
    );

    it.effect("rejects a reversed range before querying", () => {
      const onQuery = vi.fn();
      const QuestDBTest = handlerLayers(createMockQuestDB([], onQuery));

      return Effect.gen(function* () {
        const error = yield* invalidTimeRangeOf(
          getConnectivityStatusHandler({
            query: {
              startTime: "2024-01-02T00:00:00Z",
              endTime: "2024-01-01T00:00:00Z",
            },
          })
        );

        expect(error.message).toContain("startTime");
        expect(onQuery).not.toHaveBeenCalled();
      }).pipe(Effect.provide(QuestDBTest));
    });

    it.effect("defaults the window to the trailing 24 hours", () => {
      const onQuery = vi.fn();
      const QuestDBTest = handlerLayers(createMockQuestDB([], onQuery));
      const fixedNow = new Date("2025-01-15T12:00:00Z").getTime();

      return Effect.gen(function* () {
        yield* atNow(fixedNow);

        const result = yield* getConnectivityStatusHandler({ query: {} });

        expect(onQuery).toHaveBeenCalledWith(
          expect.objectContaining({
            startTime: new Date(fixedNow - 24 * 3600000),
            endTime: new Date(fixedNow),
            nowMs: fixedNow,
          })
        );
        expect(result.meta.startTime).toBe(
          new Date(fixedNow - 24 * 3600000).toISOString()
        );
        expect(result.meta.endTime).toBe(new Date(fixedNow).toISOString());
      }).pipe(Effect.provide(QuestDBTest));
    });

    it.effect(
      "queries the same default granularity coverage is measured against",
      () => {
        const onQuery = vi.fn();
        const QuestDBTest = handlerLayers(createMockQuestDB([], onQuery));

        return Effect.gen(function* () {
          yield* atNow();
          yield* getConnectivityStatusHandler({ query: {} });

          // The handler must resolve the window and granularity itself, so the
          // grid `expectedBuckets` counts is the grid the query sampled.
          expect(onQuery).toHaveBeenCalledWith(
            expect.objectContaining({ granularity: DEFAULT_GRANULARITY })
          );
        }).pipe(Effect.provide(QuestDBTest));
      }
    );

    it.effect("reports null uptime when there are no rows, not 0%", () => {
      const QuestDBTest = handlerLayers(createMockQuestDB([]));

      return Effect.gen(function* () {
        yield* atNow();
        const result = yield* getConnectivityStatusHandler({
          query: {
            startTime: "2024-01-01T00:00:00Z",
            endTime: "2024-01-02T00:00:00Z",
            granularity: "1h",
          },
        });

        expect(result.data).toEqual([]);
        // 0% would read as a total outage. Nothing was observed, so there is
        // no ratio to report at all.
        expect(result.meta.uptimePercentage).toBeNull();
        expect(result.meta.availabilityPercentage).toBeNull();
        expect(result.meta.observedSeconds).toBe(0);
        expect(result.meta.observedBuckets).toBe(0);
        expect(result.meta.expectedBuckets).toBe(24);
        expect(result.meta.coveragePercentage).toBe(0);
      }).pipe(Effect.provide(QuestDBTest));
    });

    it.effect(
      "reports full uptime over partial coverage when the monitor ran for part of the window",
      () => {
        // One hour of a 24-hour window: the link was clean for all the time
        // the monitor recorded, and silent for the other 23 hours.
        const mockRows = [bucketRow("2024-01-01T00:00:00Z", { up: 3600 })];
        const QuestDBTest = handlerLayers(createMockQuestDB(mockRows));

        return Effect.gen(function* () {
          yield* atNow();
          const result = yield* getConnectivityStatusHandler({
            query: {
              startTime: "2024-01-01T00:00:00Z",
              endTime: "2024-01-02T00:00:00Z",
              granularity: "1h",
            },
          });

          // Uptime is conditional on coverage: 100% is the honest answer for
          // the time that was observed...
          expect(result.meta.uptimePercentage).toBe(100);
          expect(result.meta.availabilityPercentage).toBe(100);
          expect(result.meta.observedSeconds).toBe(3600);

          // ...and coverage is what stops that from reading as "100% uptime
          // over the whole day".
          expect(result.meta.expectedBuckets).toBe(24);
          expect(result.meta.observedBuckets).toBe(1);
          expect(result.meta.coveragePercentage).toBeCloseTo(100 / 24, 10);
        }).pipe(Effect.provide(QuestDBTest));
      }
    );

    it.effect(
      "weights uptime by observed time, not by how many buckets it lands in",
      () => {
        // A busy bucket and a sparse one: 90 up of 100 seconds is 90%, whereas
        // averaging the two buckets' rates would give 45%.
        const mockRows = [
          bucketRow("2024-01-01T00:00:00Z", { up: 90, degraded: 5, down: 5 }),
          bucketRow("2024-01-01T01:00:00Z", { down: 1 }),
        ];
        const QuestDBTest = handlerLayers(createMockQuestDB(mockRows));

        return Effect.gen(function* () {
          yield* atNow();
          const result = yield* getConnectivityStatusHandler({
            query: {
              startTime: "2024-01-01T00:00:00Z",
              endTime: "2024-01-01T02:00:00Z",
              granularity: "1h",
            },
          });

          expect(result.meta.observedSeconds).toBe(101);
          expect(result.meta.uptimePercentage).toBeCloseTo(
            (90 / 101) * 100,
            10
          );
          expect(result.meta.availabilityPercentage).toBeCloseTo(
            (95 / 101) * 100,
            10
          );
          expect(result.meta.coveragePercentage).toBe(100);
        }).pipe(Effect.provide(QuestDBTest));
      }
    );

    it.effect("clamps coverage to 100% at an inclusive upper bound", () => {
      // The SQL filter's `timestamp <= end` can return one bucket more than the
      // half-open [start, end) grid expects when the window ends exactly on a
      // boundary. Coverage stays a percentage rather than exceeding 100.
      const mockRows = [0, 1, 2].map((hour) =>
        bucketRow(`2024-01-01T0${hour}:00:00Z`, { up: 10 })
      );
      const QuestDBTest = handlerLayers(createMockQuestDB(mockRows));

      return Effect.gen(function* () {
        yield* atNow();
        const result = yield* getConnectivityStatusHandler({
          query: {
            startTime: "2024-01-01T00:00:00Z",
            endTime: "2024-01-01T02:00:00Z",
            granularity: "1h",
          },
        });

        expect(result.meta.expectedBuckets).toBe(2);
        expect(result.meta.observedBuckets).toBe(3);
        expect(result.meta.coveragePercentage).toBe(100);
      }).pipe(Effect.provide(QuestDBTest));
    });

    it.effect.each([
      [
        "reads full coverage when every bucket up to now, the current partial one included, holds time",
        [
          bucketRow("2024-01-01T00:00:00Z", { up: 3600 }),
          bucketRow("2024-01-01T01:00:00Z", { up: 1800 }),
        ],
        100,
      ],
      [
        "expects the current partial bucket, so a window with no data in it reads below full coverage",
        [bucketRow("2024-01-01T00:00:00Z", { up: 3600 })],
        50,
      ],
    ] as const)(
      "counts expected buckets only up to now when the window ends later: %s",
      ([, mockRows, coverage]) => {
        const QuestDBTest = handlerLayers(createMockQuestDB(mockRows));

        return Effect.gen(function* () {
          yield* atNow(Date.parse("2024-01-01T01:30:00Z"));
          const result = yield* getConnectivityStatusHandler({
            query: {
              startTime: "2024-01-01T00:00:00Z",
              endTime: "2024-01-02T00:00:00Z",
              granularity: "1h",
            },
          });

          expect(result.meta.expectedBuckets).toBe(2);
          expect(result.meta.coveragePercentage).toBe(coverage);
          expect(result.meta.endTime).toBe("2024-01-02T00:00:00.000Z");
        }).pipe(Effect.provide(QuestDBTest));
      }
    );

    it.effect("reports the configured ping interval as the sample rate", () => {
      const QuestDBTest = handlerLayers(createMockQuestDB([]), 45);

      return Effect.gen(function* () {
        yield* atNow();
        const result = yield* getConnectivityStatusHandler({ query: {} });

        expect(result.meta.expectedSampleIntervalSeconds).toBe(45);
      }).pipe(Effect.provide(QuestDBTest));
    });
  });

  describe("getLiveConnectivity", () => {
    it.effect.each(["up", "degraded", "down"] as const)(
      "reports a %s state with the newest ping's timestamp",
      (state) => {
        const db = createMockLiveQuestDB({
          state,
          latestPingTimestamp: "2024-01-01T00:00:30.000Z",
        });

        return Effect.gen(function* () {
          const result = yield* getLiveConnectivityHandler();

          expect(result.status).toBe(state);
          expect(result.lastSampleAt).toBe("2024-01-01T00:00:30.000Z");
        }).pipe(Effect.provide(handlerLayers(db)));
      }
    );

    it.effect(
      "reports noInfo with the last recorded ping when no host has a standing ping",
      () => {
        const db = createMockLiveQuestDB({
          latestPingTimestamp: "2023-12-31T20:00:00.000Z",
        });

        return Effect.gen(function* () {
          const result = yield* getLiveConnectivityHandler();

          expect(result.status).toBe("noInfo");
          expect(result.lastSampleAt).toBe("2023-12-31T20:00:00.000Z");
        }).pipe(Effect.provide(handlerLayers(db)));
      }
    );

    it.effect(
      "reports noInfo with no timestamp when nothing was ever recorded",
      () => {
        const db = createMockLiveQuestDB({});

        return Effect.gen(function* () {
          const result = yield* getLiveConnectivityHandler();

          expect(result.status).toBe("noInfo");
          expect(result.lastSampleAt).toBeNull();
        }).pipe(Effect.provide(handlerLayers(db)));
      }
    );

    it.effect("asks for the newest ping alongside the state", () => {
      const onLatestPingQuery = vi.fn();
      const db = createMockLiveQuestDB({ state: "up", onLatestPingQuery });

      return Effect.gen(function* () {
        yield* getLiveConnectivityHandler();

        expect(onLatestPingQuery).toHaveBeenCalledTimes(1);
      }).pipe(Effect.provide(handlerLayers(db)));
    });

    it.effect(
      "reads the state at the clock with the configured interval and hosts",
      () => {
        const onLiveQuery = vi.fn();
        const db = createMockLiveQuestDB({ onLiveQuery });

        return Effect.gen(function* () {
          yield* atNow();
          yield* getLiveConnectivityHandler();

          expect(onLiveQuery).toHaveBeenCalledWith({
            nowMs: NOW,
            intervalMs: 300_000,
            hosts: ["8.8.8.8", "cloudflare.com"],
          });
        }).pipe(
          Effect.provide(handlerLayers(db, 300, ["8.8.8.8", "cloudflare.com"]))
        );
      }
    );

    it.effect("sizes the window as 2.5 configured ping intervals", () => {
      const db = createMockLiveQuestDB({});

      return Effect.gen(function* () {
        const result = yield* getLiveConnectivityHandler();

        // 300s interval gives a 750s window, well past the 60s floor.
        expect(result.windowSeconds).toBe(750);
      }).pipe(Effect.provide(handlerLayers(db, 300)));
    });

    it.effect(
      "holds the window at its 60s floor for fast ping intervals",
      () => {
        const db = createMockLiveQuestDB({});

        return Effect.gen(function* () {
          const result = yield* getLiveConnectivityHandler();

          expect(result.windowSeconds).toBe(60);
        }).pipe(Effect.provide(handlerLayers(db, 5)));
      }
    );

    it.effect(
      "maps an unreachable database to the shared 503 error body",
      () => {
        const db = createMockLiveQuestDB({ liveUnavailable: true });

        return Effect.gen(function* () {
          const exit = yield* Effect.exit(getLiveConnectivityHandler());

          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit)) {
            const error = Cause.findErrorOption(exit.cause);
            expect(Option.isSome(error)).toBe(true);
            if (Option.isSome(error)) {
              expect(error.value).toBeInstanceOf(DbUnavailable);
            }
          }
        }).pipe(Effect.provide(handlerLayers(db)));
      }
    );
  });

  describe("getOutages", () => {
    const START = Date.parse("2024-01-01T00:00:00Z");

    const outageRun = (
      runId: number,
      startSeconds: number,
      endSeconds: number,
      overrides: Partial<OutageRun> = {}
    ): OutageRun => ({
      run_id: runId,
      start_time: new Date(START + startSeconds * 1000).toISOString(),
      end_time: new Date(START + endSeconds * 1000).toISOString(),
      had_down: true,
      max_packet_loss: 100,
      peak_latency: null,
      affected_hosts: [],
      ...overrides,
    });

    const dbWithRuns = (
      runs: readonly OutageRun[],
      onQuery?: (params: QueryStateParams) => void
    ): QuestDBService => ({
      ...createMockQuestDB([]),
      queryOutageRuns: (params) => {
        onQuery?.(params);
        return Effect.succeed(runs);
      },
    });

    const query = {
      startTime: "2024-01-01T00:00:00Z",
      endTime: "2024-01-01T01:00:00Z",
    };

    it.effect("returns outages newest first with the window in meta", () => {
      const db = dbWithRuns([
        outageRun(1, 0, 30, { affected_hosts: ["8.8.8.8"] }),
        outageRun(2, 60, 90, { affected_hosts: ["8.8.8.8"] }),
      ]);

      return Effect.gen(function* () {
        yield* atNow();
        const result = yield* getOutagesHandler({ query });

        expect(result.data.map((outage) => outage.start)).toEqual([
          "2024-01-01T00:01:00.000Z",
          "2024-01-01T00:00:00.000Z",
        ]);
        expect(result.data[0]).toMatchObject({
          status: "down",
          durationSeconds: 30,
          affectedHosts: ["8.8.8.8"],
        });
        expect(result.meta).toEqual({
          startTime: "2024-01-01T00:00:00.000Z",
          endTime: "2024-01-01T01:00:00.000Z",
          count: 2,
          totalCount: 2,
        });
      }).pipe(Effect.provide(handlerLayers(db)));
    });

    it.effect("returns an empty log when no outage ran", () => {
      const db = dbWithRuns([]);

      return Effect.gen(function* () {
        yield* atNow();
        const result = yield* getOutagesHandler({ query });

        expect(result.data).toEqual([]);
        expect(result.meta.totalCount).toBe(0);
      }).pipe(Effect.provide(handlerLayers(db)));
    });

    it.effect(
      "caps the log at the 500 newest and reports the full count",
      () => {
        const runs = Array.from({ length: 600 }, (_, i) =>
          outageRun(i + 1, i * 60, i * 60 + 30)
        );
        const db = dbWithRuns(runs);

        return Effect.gen(function* () {
          yield* atNow();
          const result = yield* getOutagesHandler({
            query: {
              startTime: "2024-01-01T00:00:00Z",
              endTime: "2024-01-02T00:00:00Z",
            },
          });

          expect(result.data).toHaveLength(MAX_OUTAGES);
          expect(result.meta.count).toBe(MAX_OUTAGES);
          expect(result.meta.totalCount).toBe(600);
          // Newest first: the 600th outage leads and the 101st is last.
          expect(result.data[0].start).toBe(
            new Date(START + 599 * 60_000).toISOString()
          );
          expect(result.data[MAX_OUTAGES - 1].start).toBe(
            new Date(START + 100 * 60_000).toISOString()
          );
        }).pipe(Effect.provide(handlerLayers(db)));
      }
    );

    it.effect(
      "queries the requested window with the clock, the interval and the hosts",
      () => {
        const onQuery = vi.fn();
        const db = dbWithRuns([], onQuery);

        return Effect.gen(function* () {
          yield* atNow();
          yield* getOutagesHandler({ query });

          expect(onQuery).toHaveBeenCalledWith({
            startTime: new Date("2024-01-01T00:00:00Z"),
            endTime: new Date("2024-01-01T01:00:00Z"),
            nowMs: NOW,
            intervalMs: 30_000,
            hosts: ["8.8.8.8", "1.1.1.1"],
          });
        }).pipe(Effect.provide(handlerLayers(db)));
      }
    );

    it.effect(
      "defaults to the trailing 24 hours and reports that window",
      () => {
        const onQuery = vi.fn();
        const db = dbWithRuns([], onQuery);

        return Effect.gen(function* () {
          yield* atNow();
          const result = yield* getOutagesHandler({ query: {} });

          expect(onQuery).toHaveBeenCalledWith(
            expect.objectContaining({
              startTime: new Date(NOW - 24 * 60 * 60 * 1000),
              endTime: new Date(NOW),
            })
          );
          expect(result.meta).toMatchObject({
            startTime: new Date(NOW - 24 * 60 * 60 * 1000).toISOString(),
            endTime: new Date(NOW).toISOString(),
          });
        }).pipe(Effect.provide(handlerLayers(db)));
      }
    );

    it.effect(
      "clips an outage that began before the window to its start",
      () => {
        const db = dbWithRuns([outageRun(1, -120, 300)]);

        return Effect.gen(function* () {
          yield* atNow();
          const result = yield* getOutagesHandler({ query });

          expect(result.data[0]).toMatchObject({
            start: "2024-01-01T00:00:00.000Z",
            end: "2024-01-01T00:05:00.000Z",
            durationSeconds: 300,
          });
        }).pipe(Effect.provide(handlerLayers(db)));
      }
    );

    it.effect("clips an outage still running to the window end", () => {
      const db = dbWithRuns([outageRun(1, 3_500, 4_000)]);

      return Effect.gen(function* () {
        yield* atNow();
        const result = yield* getOutagesHandler({ query });

        expect(result.data[0]).toMatchObject({
          end: "2024-01-01T01:00:00.000Z",
          durationSeconds: 100,
        });
      }).pipe(Effect.provide(handlerLayers(db)));
    });

    it.effect(
      "clips an outage to the present when the window ends later",
      () => {
        const db = dbWithRuns([outageRun(1, 3_500, 4_000)]);

        return Effect.gen(function* () {
          yield* atNow(START + 3_700_000);
          const result = yield* getOutagesHandler({
            query: {
              startTime: "2024-01-01T00:00:00Z",
              endTime: "2024-01-01T06:00:00Z",
            },
          });

          expect(result.data[0]).toMatchObject({
            end: "2024-01-01T01:01:40.000Z",
            durationSeconds: 200,
          });
          expect(result.meta.endTime).toBe("2024-01-01T06:00:00.000Z");
        }).pipe(Effect.provide(handlerLayers(db)));
      }
    );

    it.effect("accepts a span of exactly 90 days", () => {
      const db = dbWithRuns([]);

      return Effect.gen(function* () {
        yield* atNow();
        const result = yield* getOutagesHandler({
          query: {
            startTime: "2024-01-01T00:00:00Z",
            endTime: new Date(
              START + MAX_OUTAGE_SPAN_DAYS * 24 * 60 * 60 * 1000
            ).toISOString(),
          },
        });

        expect(result.data).toEqual([]);
      }).pipe(Effect.provide(handlerLayers(db)));
    });

    it.effect(
      "rejects a span over 90 days before touching the database",
      () => {
        const onQuery = vi.fn();
        const db = dbWithRuns([], onQuery);

        return Effect.gen(function* () {
          const error = yield* invalidTimeRangeOf(
            getOutagesHandler({
              query: {
                startTime: "2024-01-01T00:00:00Z",
                endTime: new Date(
                  START + MAX_OUTAGE_SPAN_DAYS * 24 * 60 * 60 * 1000 + 1
                ).toISOString(),
              },
            })
          );

          expect(error.message).toContain("90 days");
          expect(onQuery).not.toHaveBeenCalled();
        }).pipe(Effect.provide(handlerLayers(db)));
      }
    );

    it.effect("rejects a start after the end", () => {
      const onQuery = vi.fn();
      const db = dbWithRuns([], onQuery);

      return Effect.gen(function* () {
        const error = yield* invalidTimeRangeOf(
          getOutagesHandler({
            query: {
              startTime: "2024-01-02T00:00:00Z",
              endTime: "2024-01-01T00:00:00Z",
            },
          })
        );

        expect(error.message).toContain("startTime");
        expect(onQuery).not.toHaveBeenCalled();
      }).pipe(Effect.provide(handlerLayers(db)));
    });

    it.effect(
      "maps an unreachable database to the shared 503 error body",
      () => {
        const db: QuestDBService = {
          ...createMockQuestDB([]),
          queryOutageRuns: () =>
            Effect.fail(
              new DatabaseUnavailable({ message: "connection refused" })
            ),
        };

        return Effect.gen(function* () {
          yield* atNow();
          const exit = yield* Effect.exit(getOutagesHandler({ query }));

          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit)) {
            const error = Cause.findErrorOption(exit.cause);
            expect(Option.isSome(error)).toBe(true);
            if (Option.isSome(error)) {
              expect(error.value).toBeInstanceOf(DbUnavailable);
            }
          }
        }).pipe(Effect.provide(handlerLayers(db)));
      }
    );
  });
});
