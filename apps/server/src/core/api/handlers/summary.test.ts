import { describe, expect, it } from "@effect/vitest";
import { DbUnavailable } from "@shared/api/errors";
import type { Metric } from "@wan-monitor/shared";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import { vi } from "vitest";
import { getSummaryHandler } from "@/core/api/handlers/summary";
import {
  DatabaseUnavailable,
  QuestDB,
  type QuestDBService,
} from "@/infrastructure/database/questdb";
import type {
  HostStatsRow,
  QueryWindowUptimeParams,
  SummaryStatsRow,
  WindowUptime,
} from "@/infrastructure/database/questdb/model";
import { makeTestConfigLayer } from "@/test/config";
import { invalidTimeRangeOf } from "@/test/invalid-time-range";
import { emptyAnalyticsQueries } from "@/test/questdb-stubs";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const END = Date.parse("2024-02-01T00:00:00Z");

const baseDb: QuestDBService = {
  health: () =>
    Effect.succeed({ connected: true, version: "1.0.0", uptime: 100 }),
  writeMetric: () => Effect.void,
  flush: () => Effect.void,
  queryMetrics: () => Effect.succeed([]),
  querySpeedtests: () => Effect.succeed([]),
  queryConnectivityStatus: () => Effect.succeed([]),
  queryLiveConnectivity: () => Effect.succeed(null),
  queryEarliestTimestamp: () => Effect.succeed(null),
  queryLatestPingTimestamp: () => Effect.succeed(null),
  ...emptyAnalyticsQueries,
  close: () => Effect.void,
};

const layers = (db: Partial<QuestDBService>) =>
  Layer.mergeAll(
    Layer.succeed(QuestDB, { ...baseDb, ...db }),
    makeTestConfigLayer({
      ping: { intervalSeconds: 45, hosts: ["8.8.8.8", "1.1.1.1"] },
    })
  );

const statsRow = (
  overrides: Partial<SummaryStatsRow> = {}
): SummaryStatsRow => ({
  latency_p50: 20,
  latency_p95: 45,
  avg_packet_loss: 0.5,
  avg_jitter: 2,
  ...overrides,
});

const seconds = (up: number, observed: number): WindowUptime => ({
  up_micros: up * 1_000_000,
  observed_micros: observed * 1_000_000,
});

const unavailable = Effect.fail(
  new DatabaseUnavailable({ message: "connection refused" })
);

const summaryQuery = {
  startTime: new Date(END - 2 * DAY).toISOString(),
  endTime: new Date(END).toISOString(),
};

describe("Summary Handlers", () => {
  describe("getSummary", () => {
    it.effect("summarizes the range from the stats alone", () => {
      const db: Partial<QuestDBService> = {
        querySummaryStats: () => Effect.succeed(statsRow()),
      };

      return Effect.gen(function* () {
        const { range } = yield* getSummaryHandler({ query: summaryQuery });

        expect(range).toEqual({
          latencyP50: 20,
          latencyP95: 45,
          avgPacketLoss: 0.5,
          avgJitter: 2,
        });
      }).pipe(Effect.provide(layers(db)));
    });

    it.effect("reports nulls, not zeros, for a range with no data", () => {
      return Effect.gen(function* () {
        const result = yield* getSummaryHandler({ query: summaryQuery });

        expect(result.range).toEqual({
          latencyP50: null,
          latencyP95: null,
          avgPacketLoss: null,
          avgJitter: null,
        });
        expect(result.windows).toEqual({
          last24h: { uptimePercentage: null },
          last7d: { uptimePercentage: null },
          last30d: { uptimePercentage: null },
        });
        expect(result.hosts).toEqual([]);
        expect(result.speed).toMatchObject({ downloadMedian: null, count: 0 });
      }).pipe(Effect.provide(layers({})));
    });

    it.effect("queries the requested range and reports it in meta", () => {
      const onStats = vi.fn();
      const db: Partial<QuestDBService> = {
        querySummaryStats: (params) => {
          onStats(params);
          return Effect.succeed(statsRow());
        },
      };

      return Effect.gen(function* () {
        const result = yield* getSummaryHandler({ query: summaryQuery });

        expect(onStats).toHaveBeenCalledTimes(1);
        expect(onStats).toHaveBeenCalledWith({
          startTime: new Date(END - 2 * DAY),
          endTime: new Date(END),
        });
        expect(result.meta).toEqual({
          startTime: new Date(END - 2 * DAY).toISOString(),
          endTime: new Date(END).toISOString(),
        });
        expect(result).not.toHaveProperty("previous");
      }).pipe(Effect.provide(layers(db)));
    });

    it.effect(
      "reads the 24h, 7d and 30d windows in one query anchored at the end time",
      () => {
        const calls: QueryWindowUptimeParams[] = [];
        const db: Partial<QuestDBService> = {
          queryWindowUptime: (params) => {
            calls.push(params);
            return Effect.succeed([]);
          },
        };

        return Effect.gen(function* () {
          yield* TestClock.setTime(END + HOUR);
          yield* getSummaryHandler({ query: summaryQuery });

          expect(calls).toEqual([
            {
              endTime: new Date(END),
              nowMs: END + HOUR,
              intervalMs: 45_000,
              hosts: ["8.8.8.8", "1.1.1.1"],
              windowStartTimes: [
                new Date(END - DAY),
                new Date(END - 7 * DAY),
                new Date(END - 30 * DAY),
              ],
            },
          ]);
        }).pipe(Effect.provide(layers(db)));
      }
    );

    it.effect("reports each trailing window's own uptime", () => {
      const db: Partial<QuestDBService> = {
        queryWindowUptime: () =>
          Effect.succeed([
            seconds(86_400, 86_400),
            seconds(80, 100),
            seconds(60, 100),
          ]),
      };

      return Effect.gen(function* () {
        const { windows } = yield* getSummaryHandler({
          query: {
            startTime: new Date(END - HOUR).toISOString(),
            endTime: new Date(END).toISOString(),
          },
        });

        expect(windows.last24h).toEqual({ uptimePercentage: 100 });
        expect(windows.last7d).toEqual({ uptimePercentage: 80 });
        expect(windows.last30d).toEqual({ uptimePercentage: 60 });
      }).pipe(Effect.provide(layers(db)));
    });

    it.effect(
      "reports a null uptime for a window with no observed time",
      () => {
        const db: Partial<QuestDBService> = {
          queryWindowUptime: () =>
            Effect.succeed([seconds(0, 0), seconds(0, 3600), seconds(0, 0)]),
        };

        return Effect.gen(function* () {
          const { windows } = yield* getSummaryHandler({ query: summaryQuery });

          expect(windows.last24h).toEqual({ uptimePercentage: null });
          expect(windows.last7d).toEqual({ uptimePercentage: 0 });
          expect(windows.last30d).toEqual({ uptimePercentage: null });
        }).pipe(Effect.provide(layers(db)));
      }
    );

    it.effect("rejects a start after the end without querying", () => {
      const onStats = vi.fn();
      const db: Partial<QuestDBService> = {
        querySummaryStats: () => {
          onStats();
          return Effect.succeed(statsRow());
        },
      };

      return Effect.gen(function* () {
        const error = yield* invalidTimeRangeOf(
          getSummaryHandler({
            query: {
              startTime: new Date(END).toISOString(),
              endTime: new Date(END - DAY).toISOString(),
            },
          })
        );

        expect(error.message).toContain("startTime");
        expect(onStats).not.toHaveBeenCalled();
      }).pipe(Effect.provide(layers(db)));
    });

    it.effect("defaults the range to the trailing 24 hours", () => {
      const onStats = vi.fn();
      const db: Partial<QuestDBService> = {
        querySummaryStats: (params) => {
          onStats(params);
          return Effect.succeed(statsRow());
        },
      };

      return Effect.gen(function* () {
        yield* TestClock.setTime(END);
        yield* getSummaryHandler({ query: {} });

        const [params] = onStats.mock.calls[0];
        expect(params.endTime.getTime() - params.startTime.getTime()).toBe(DAY);
      }).pipe(Effect.provide(layers(db)));
    });

    it.effect(
      "derives each host's availability from its answered samples",
      () => {
        const hosts: readonly HostStatsRow[] = [
          {
            host: "8.8.8.8",
            latency_p50: 12,
            latency_p95: 30,
            avg_packet_loss: 1,
            avg_jitter: 0.5,
            answered_count: 57,
            total_count: 60,
            last_status: "up",
          },
          {
            host: "1.1.1.1",
            latency_p50: null,
            latency_p95: null,
            avg_packet_loss: 100,
            avg_jitter: null,
            answered_count: 0,
            total_count: 60,
            last_status: "down",
          },
        ];
        const db: Partial<QuestDBService> = {
          queryHostStats: () => Effect.succeed(hosts),
        };

        return Effect.gen(function* () {
          const result = yield* getSummaryHandler({ query: summaryQuery });

          expect(result.hosts).toEqual([
            {
              host: "8.8.8.8",
              latencyP50: 12,
              latencyP95: 30,
              avgPacketLoss: 1,
              avgJitter: 0.5,
              availabilityPercentage: 95,
              lastStatus: "up",
            },
            {
              host: "1.1.1.1",
              latencyP50: null,
              latencyP95: null,
              avgPacketLoss: 100,
              avgJitter: null,
              availabilityPercentage: 0,
              lastStatus: "down",
            },
          ]);
        }).pipe(Effect.provide(layers(db)));
      }
    );

    it.effect("summarizes speed tests, ignoring tests with no reading", () => {
      const speedtest = (download?: number, upload?: number): Metric => ({
        timestamp: "2024-01-31T12:00:00Z",
        source: "speedtest",
        download_speed: download,
        upload_speed: upload,
      });
      const db: Partial<QuestDBService> = {
        querySpeedtests: () =>
          Effect.succeed([speedtest(), speedtest(100, 10), speedtest(300, 30)]),
      };

      return Effect.gen(function* () {
        const { speed } = yield* getSummaryHandler({ query: summaryQuery });

        expect(speed).toMatchObject({
          downloadMedian: 200,
          uploadMedian: 20,
          count: 2,
        });
      }).pipe(Effect.provide(layers(db)));
    });

    it.effect.each([
      ["host stats", { queryHostStats: () => unavailable }],
      ["window uptime", { queryWindowUptime: () => unavailable }],
    ] as const)(
      "maps an unreachable database in the %s query to the shared 503 error body",
      ([, db]) =>
        Effect.gen(function* () {
          const exit = yield* Effect.exit(
            getSummaryHandler({ query: summaryQuery })
          );

          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit)) {
            const error = Cause.findErrorOption(exit.cause);
            expect(Option.isSome(error)).toBe(true);
            if (Option.isSome(error)) {
              expect(error.value).toBeInstanceOf(DbUnavailable);
            }
          }
        }).pipe(Effect.provide(layers(db)))
    );
  });
});
