import { describe, expect, it } from "@effect/vitest";
import { DB_UNAVAILABLE } from "@shared/api/errors";
import { DEFAULT_GRANULARITY } from "@wan-monitor/shared";
import { Cause, Clock, Effect, Exit, Layer, Option } from "effect";
import { vi } from "vitest";
import {
  getConnectivityStatusHandler,
  getLiveConnectivityHandler,
} from "@/core/api/handlers/connectivity-status";
import {
  DbUnavailable,
  QuestDB,
  type QuestDBService,
} from "@/infrastructure/database/questdb";
import type {
  ConnectivityStatusRow,
  LiveConnectivityRow,
  QueryMetricsParams,
} from "@/infrastructure/database/questdb/model";
import { makeTestConfigLayer } from "@/test/config";

const createMockQuestDB = (
  mockRows: unknown[],
  onQuery?: (params: QueryMetricsParams) => void
): QuestDBService => ({
  health: () =>
    Effect.succeed({ connected: true, version: "1.0.0", uptime: 100 }),
  writeMetric: () => Effect.void,
  flush: () => Effect.void,
  queryMetrics: () => Effect.succeed([]),
  querySpeedtests: () => Effect.succeed([]),
  queryConnectivityStatus: (params) => {
    onQuery?.(params);
    return Effect.succeed(mockRows as readonly ConnectivityStatusRow[]);
  },
  queryLiveConnectivity: () => Effect.succeed(null),
  queryEarliestTimestamp: () => Effect.succeed(null),
  queryLatestPingTimestamp: () => Effect.succeed(null),
  close: () => Effect.void,
});

const createMockLiveQuestDB = (options: {
  readonly liveRow?: LiveConnectivityRow;
  readonly latestPingTimestamp?: string;
  readonly onLiveQuery?: (sinceIso: string) => void;
  readonly onLatestPingQuery?: () => void;
  readonly liveUnavailable?: boolean;
}): QuestDBService => ({
  ...createMockQuestDB([]),
  queryLiveConnectivity: (sinceIso) => {
    options.onLiveQuery?.(sinceIso);
    return options.liveUnavailable
      ? Effect.fail(new DbUnavailable({ message: "connection refused" }))
      : Effect.succeed(options.liveRow ?? null);
  },
  queryLatestPingTimestamp: () => {
    options.onLatestPingQuery?.();
    return Effect.succeed(options.latestPingTimestamp ?? null);
  },
});

const handlerLayers = (db: QuestDBService, pingIntervalSeconds = 30) =>
  Layer.mergeAll(
    Layer.succeed(QuestDB, db),
    makeTestConfigLayer({ ping: { intervalSeconds: pingIntervalSeconds } })
  );

describe("Connectivity Status Handlers", () => {
  describe("getConnectivityStatus", () => {
    it.effect("calculates status and percentages correctly", () => {
      const mockRows = [
        {
          timestamp: "2024-01-01T00:00:00Z",
          up_count: 10,
          down_count: 0,
          degraded_count: 0,
          total_count: 10,
        },
        {
          timestamp: "2024-01-01T01:00:00Z",
          up_count: 8,
          down_count: 2,
          degraded_count: 0,
          total_count: 10,
        },
      ];
      const QuestDBTest = handlerLayers(createMockQuestDB(mockRows));

      return Effect.gen(function* () {
        const result = yield* getConnectivityStatusHandler({ query: {} });

        expect(result.data).toHaveLength(2);
        expect(result.data[0].status).toBe("up");
        expect(result.data[0].upPercentage).toBe(100);
        expect(result.data[1].status).toBe("down");
        expect(result.data[1].downPercentage).toBe(20);
        expect(result.meta.uptimePercentage).toBe(90);
        expect(result.meta.availabilityPercentage).toBe(90);
      }).pipe(Effect.provide(QuestDBTest));
    });

    it.effect("handles degraded status", () => {
      const mockRows = [
        {
          timestamp: "2024-01-01T00:00:00Z",
          up_count: 7,
          down_count: 0,
          degraded_count: 3,
          total_count: 10,
        },
      ];
      const QuestDBTest = handlerLayers(createMockQuestDB(mockRows));

      return Effect.gen(function* () {
        const result = yield* getConnectivityStatusHandler({ query: {} });

        expect(result.data[0].status).toBe("degraded");
        expect(result.data[0].degradedPercentage).toBe(30);
      }).pipe(Effect.provide(QuestDBTest));
    });

    it.effect(
      "a single degraded cycle out of a large coarse bucket stays up, not degraded",
      () => {
        const mockRows = [
          {
            timestamp: "2024-01-01T00:00:00Z",
            up_count: 119,
            down_count: 0,
            degraded_count: 1,
            total_count: 120,
          },
        ];
        const QuestDBTest = handlerLayers(createMockQuestDB(mockRows));

        return Effect.gen(function* () {
          const result = yield* getConnectivityStatusHandler({ query: {} });

          expect(result.data[0].status).toBe("up");
        }).pipe(Effect.provide(QuestDBTest));
      }
    );

    it.effect(
      "a sustained share of degraded cycles in a coarse bucket still reads as degraded",
      () => {
        const mockRows = [
          {
            timestamp: "2024-01-01T00:00:00Z",
            up_count: 108,
            down_count: 0,
            degraded_count: 12,
            total_count: 120,
          },
        ];
        const QuestDBTest = handlerLayers(createMockQuestDB(mockRows));

        return Effect.gen(function* () {
          const result = yield* getConnectivityStatusHandler({ query: {} });

          expect(result.data[0].status).toBe("degraded");
        }).pipe(Effect.provide(QuestDBTest));
      }
    );

    it.effect(
      "availabilityPercentage counts degraded as available, unlike uptimePercentage",
      () => {
        const mockRows = [
          {
            timestamp: "2024-01-01T00:00:00Z",
            up_count: 7,
            down_count: 0,
            degraded_count: 3,
            total_count: 10,
          },
        ];
        const QuestDBTest = handlerLayers(createMockQuestDB(mockRows));

        return Effect.gen(function* () {
          const result = yield* getConnectivityStatusHandler({ query: {} });

          expect(result.meta.uptimePercentage).toBe(70);
          expect(result.meta.availabilityPercentage).toBe(100);
        }).pipe(Effect.provide(QuestDBTest));
      }
    );

    it.effect("converts query start/end times to Dates before querying", () => {
      const onQuery = vi.fn();
      const QuestDBTest = handlerLayers(createMockQuestDB([], onQuery));

      return Effect.gen(function* () {
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
        });
      }).pipe(Effect.provide(QuestDBTest));
    });

    it.effect(
      "queries the same default granularity coverage is measured against",
      () => {
        const onQuery = vi.fn();
        const QuestDBTest = handlerLayers(createMockQuestDB([], onQuery));

        return Effect.gen(function* () {
          yield* getConnectivityStatusHandler({ query: {} });

          // The handler must resolve the window and granularity itself, so the
          // grid `expectedBuckets` counts is the grid the query sampled.
          expect(onQuery).toHaveBeenCalledWith(
            expect.objectContaining({ granularity: DEFAULT_GRANULARITY })
          );
        }).pipe(Effect.provide(QuestDBTest));
      }
    );

    it.effect("falls back to a count of 1 to avoid division by zero", () => {
      const mockRows = [
        {
          timestamp: "2024-01-01T00:00:00Z",
          up_count: 0,
          down_count: 0,
          degraded_count: 0,
          total_count: 0,
        },
      ];
      const QuestDBTest = handlerLayers(createMockQuestDB(mockRows));

      return Effect.gen(function* () {
        const result = yield* getConnectivityStatusHandler({ query: {} });

        expect(result.data[0].upPercentage).toBe(0);
        expect(result.data[0].downPercentage).toBe(0);
        expect(result.data[0].degradedPercentage).toBe(0);
      }).pipe(Effect.provide(QuestDBTest));
    });

    it.effect("reports null uptime when there are no rows, not 0%", () => {
      const QuestDBTest = handlerLayers(createMockQuestDB([]));

      return Effect.gen(function* () {
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
        expect(result.meta.observedCycles).toBe(0);
        expect(result.meta.observedBuckets).toBe(0);
        expect(result.meta.expectedBuckets).toBe(24);
        expect(result.meta.coveragePercentage).toBe(0);
      }).pipe(Effect.provide(QuestDBTest));
    });

    it.effect(
      "reports full uptime over partial coverage when the monitor ran for part of the window",
      () => {
        // One hour of a 24-hour window: the monitor was up and the link was
        // clean for every cycle it recorded, and silent for the other 23 hours.
        const mockRows = [
          {
            timestamp: "2024-01-01T00:00:00Z",
            up_count: 120,
            down_count: 0,
            degraded_count: 0,
            total_count: 120,
          },
        ];
        const QuestDBTest = handlerLayers(createMockQuestDB(mockRows));

        return Effect.gen(function* () {
          const result = yield* getConnectivityStatusHandler({
            query: {
              startTime: "2024-01-01T00:00:00Z",
              endTime: "2024-01-02T00:00:00Z",
              granularity: "1h",
            },
          });

          // Uptime is conditional on coverage: 100% is the honest answer for
          // the cycles that were observed...
          expect(result.meta.uptimePercentage).toBe(100);
          expect(result.meta.availabilityPercentage).toBe(100);
          expect(result.meta.observedCycles).toBe(120);

          // ...and coverage is what stops that from reading as "100% uptime
          // over the whole day".
          expect(result.meta.expectedBuckets).toBe(24);
          expect(result.meta.observedBuckets).toBe(1);
          expect(result.meta.coveragePercentage).toBeCloseTo(100 / 24, 10);
        }).pipe(Effect.provide(QuestDBTest));
      }
    );

    it.effect(
      "weights uptime by observed cycles, not by how many buckets they land in",
      () => {
        // A busy bucket and a sparse one: 90 up of 100 cycles is 90%, whereas
        // averaging the two buckets' rates would give 70%.
        const mockRows = [
          {
            timestamp: "2024-01-01T00:00:00Z",
            up_count: 90,
            down_count: 5,
            degraded_count: 5,
            total_count: 100,
          },
          {
            timestamp: "2024-01-01T01:00:00Z",
            up_count: 0,
            down_count: 1,
            degraded_count: 0,
            total_count: 1,
          },
        ];
        const QuestDBTest = handlerLayers(createMockQuestDB(mockRows));

        return Effect.gen(function* () {
          const result = yield* getConnectivityStatusHandler({
            query: {
              startTime: "2024-01-01T00:00:00Z",
              endTime: "2024-01-01T02:00:00Z",
              granularity: "1h",
            },
          });

          expect(result.meta.observedCycles).toBe(101);
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
      const mockRows = [0, 1, 2].map((hour) => ({
        timestamp: `2024-01-01T0${hour}:00:00Z`,
        up_count: 10,
        down_count: 0,
        degraded_count: 0,
        total_count: 10,
      }));
      const QuestDBTest = handlerLayers(createMockQuestDB(mockRows));

      return Effect.gen(function* () {
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

    it.effect("reports the configured ping interval as the sample rate", () => {
      const QuestDBTest = handlerLayers(createMockQuestDB([]), 45);

      return Effect.gen(function* () {
        const result = yield* getConnectivityStatusHandler({ query: {} });

        expect(result.meta.expectedSampleIntervalSeconds).toBe(45);
      }).pipe(Effect.provide(QuestDBTest));
    });
  });

  describe("getLiveConnectivity", () => {
    it.effect("passes the newest cycle's status and timestamp through", () => {
      const db = createMockLiveQuestDB({
        liveRow: {
          timestamp: "2024-01-01T00:00:30.000Z",
          cycle_status: "up",
        },
      });

      return Effect.gen(function* () {
        const result = yield* getLiveConnectivityHandler();

        expect(result.status).toBe("up");
        expect(result.lastSampleAt).toBe("2024-01-01T00:00:30.000Z");
      }).pipe(Effect.provide(handlerLayers(db)));
    });

    it.effect("reports a fully-down cycle as down, never as noInfo", () => {
      const db = createMockLiveQuestDB({
        liveRow: {
          timestamp: "2024-01-01T00:00:30.000Z",
          cycle_status: "down",
        },
      });

      return Effect.gen(function* () {
        const result = yield* getLiveConnectivityHandler();

        expect(result.status).toBe("down");
      }).pipe(Effect.provide(handlerLayers(db)));
    });

    it.effect("reports a lossy cycle as degraded", () => {
      const db = createMockLiveQuestDB({
        liveRow: {
          timestamp: "2024-01-01T00:00:30.000Z",
          cycle_status: "degraded",
        },
      });

      return Effect.gen(function* () {
        const result = yield* getLiveConnectivityHandler();

        expect(result.status).toBe("degraded");
      }).pipe(Effect.provide(handlerLayers(db)));
    });

    it.effect(
      "reports noInfo with the last recorded ping when the monitor stopped reporting",
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

    it.effect("skips the fallback query when the window has a cycle", () => {
      const onLatestPingQuery = vi.fn();
      const db = createMockLiveQuestDB({
        liveRow: {
          timestamp: "2024-01-01T00:00:30.000Z",
          cycle_status: "up",
        },
        onLatestPingQuery,
      });

      return Effect.gen(function* () {
        yield* getLiveConnectivityHandler();

        expect(onLatestPingQuery).not.toHaveBeenCalled();
      }).pipe(Effect.provide(handlerLayers(db)));
    });

    it.effect("sizes the window from the configured ping interval", () => {
      const onLiveQuery = vi.fn();
      const db = createMockLiveQuestDB({ onLiveQuery });

      return Effect.gen(function* () {
        const result = yield* getLiveConnectivityHandler();
        const now = yield* Clock.currentTimeMillis;

        // 300s interval doubles to a 600s window, well past the 60s floor.
        expect(result.windowSeconds).toBe(600);
        const [sinceIso] = onLiveQuery.mock.calls[0];
        expect(now - Date.parse(sinceIso)).toBe(600_000);
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
              expect(error.value).toMatchObject({ error: DB_UNAVAILABLE });
            }
          }
        }).pipe(Effect.provide(handlerLayers(db)));
      }
    );
  });
});
