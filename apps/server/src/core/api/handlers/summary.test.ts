import { describe, expect, it } from "@effect/vitest";
import { DB_UNAVAILABLE } from "@shared/api/errors";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import { vi } from "vitest";
import { getSummaryHandler } from "@/core/api/handlers/summary";
import {
  DbUnavailable,
  QuestDB,
  type QuestDBService,
} from "@/infrastructure/database/questdb";
import type {
  ConnectivityStatusRow,
  HostStatsRow,
  MetricRow,
  QueryMetricsParams,
  SummaryStatsRow,
} from "@/infrastructure/database/questdb/model";
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
  Layer.succeed(QuestDB, { ...baseDb, ...db });

const statsRow = (
  overrides: Partial<SummaryStatsRow> = {}
): SummaryStatsRow => ({
  latency_p50: 20,
  latency_p95: 45,
  avg_packet_loss: 0.5,
  avg_jitter: 2,
  ...overrides,
});

const connectivityRow = (
  counts: Pick<
    ConnectivityStatusRow,
    "up_count" | "degraded_count" | "down_count"
  >
): ConnectivityStatusRow => ({
  timestamp: "2024-01-01T00:00:00Z",
  ...counts,
  total_count: counts.up_count + counts.degraded_count + counts.down_count,
});

const summaryQuery = {
  startTime: new Date(END - 2 * DAY).toISOString(),
  endTime: new Date(END).toISOString(),
};

describe("Summary Handlers", () => {
  describe("getSummary", () => {
    it.effect(
      "summarizes the range from the stats and connectivity rows",
      () => {
        const db: Partial<QuestDBService> = {
          querySummaryStats: () => Effect.succeed(statsRow()),
          queryConnectivityStatus: () =>
            Effect.succeed([
              connectivityRow({
                up_count: 90,
                degraded_count: 6,
                down_count: 4,
              }),
            ]),
        };

        return Effect.gen(function* () {
          const { range } = yield* getSummaryHandler({ query: summaryQuery });

          expect(range).toMatchObject({
            latencyP50: 20,
            latencyP95: 45,
            avgPacketLoss: 0.5,
            avgJitter: 2,
            uptimePercentage: 90,
            availabilityPercentage: 96,
          });
          expect(range.coveragePercentage).toBeGreaterThan(0);
        }).pipe(Effect.provide(layers(db)));
      }
    );

    it.effect("reports nulls, not zeros, for a range with no data", () => {
      return Effect.gen(function* () {
        const result = yield* getSummaryHandler({ query: summaryQuery });

        expect(result.range).toMatchObject({
          latencyP50: null,
          avgPacketLoss: null,
          uptimePercentage: null,
          availabilityPercentage: null,
          coveragePercentage: 0,
        });
        expect(result.hosts).toEqual([]);
        expect(result.speed).toMatchObject({ downloadMedian: null, count: 0 });
      }).pipe(Effect.provide(layers({})));
    });

    it.effect(
      "compares against the window of equal length just before the range",
      () => {
        const onStats = vi.fn();
        const db: Partial<QuestDBService> = {
          querySummaryStats: (params) => {
            onStats(params);
            return Effect.succeed(statsRow());
          },
        };

        return Effect.gen(function* () {
          const result = yield* getSummaryHandler({ query: summaryQuery });

          expect(onStats).toHaveBeenCalledWith({
            startTime: new Date(END - 2 * DAY),
            endTime: new Date(END),
          });
          // Both bounds are inclusive in the queries, so the previous window
          // stops 1ms short of the range to leave no instant in both.
          expect(onStats).toHaveBeenCalledWith({
            startTime: new Date(END - 4 * DAY - 1),
            endTime: new Date(END - 2 * DAY - 1),
          });
          expect(result.meta).toEqual({
            startTime: new Date(END - 2 * DAY).toISOString(),
            endTime: new Date(END).toISOString(),
          });
        }).pipe(Effect.provide(layers(db)));
      }
    );

    it.effect(
      "keeps the previous window's figures apart from the range's",
      () => {
        const db: Partial<QuestDBService> = {
          querySummaryStats: ({ endTime }) =>
            Effect.succeed(
              endTime.getTime() === END
                ? statsRow({ latency_p50: 30 })
                : statsRow({ latency_p50: 10 })
            ),
          queryConnectivityStatus: ({ endTime }) =>
            Effect.succeed([
              endTime?.getTime() === END
                ? connectivityRow({
                    up_count: 50,
                    degraded_count: 0,
                    down_count: 50,
                  })
                : connectivityRow({
                    up_count: 100,
                    degraded_count: 0,
                    down_count: 0,
                  }),
            ]),
        };

        return Effect.gen(function* () {
          const result = yield* getSummaryHandler({ query: summaryQuery });

          expect(result.range.latencyP50).toBe(30);
          expect(result.range.uptimePercentage).toBe(50);
          expect(result.previous.latencyP50).toBe(10);
          expect(result.previous.uptimePercentage).toBe(100);
        }).pipe(Effect.provide(layers(db)));
      }
    );

    it.effect("anchors the 24h, 7d and 30d windows at the end time", () => {
      const calls: QueryMetricsParams[] = [];
      const db: Partial<QuestDBService> = {
        queryConnectivityStatus: (params) => {
          calls.push(params);
          return Effect.succeed([]);
        },
      };

      return Effect.gen(function* () {
        yield* getSummaryHandler({ query: summaryQuery });

        const trailing = (spanMs: number, granularity: string) =>
          expect.objectContaining({
            startTime: new Date(END - spanMs),
            endTime: new Date(END),
            granularity,
          });
        expect(calls).toEqual(
          expect.arrayContaining([
            trailing(DAY, "5m"),
            trailing(7 * DAY, "1h"),
            trailing(30 * DAY, "1h"),
          ])
        );
      }).pipe(Effect.provide(layers(db)));
    });

    it.effect("reports each trailing window's own uptime", () => {
      const db: Partial<QuestDBService> = {
        queryConnectivityStatus: ({ startTime }) => {
          const spanMs = END - (startTime?.getTime() ?? END);
          return Effect.succeed([
            spanMs === DAY
              ? connectivityRow({
                  up_count: 100,
                  degraded_count: 0,
                  down_count: 0,
                })
              : spanMs === 7 * DAY
                ? connectivityRow({
                    up_count: 80,
                    degraded_count: 10,
                    down_count: 10,
                  })
                : connectivityRow({
                    up_count: 60,
                    degraded_count: 20,
                    down_count: 20,
                  }),
          ]);
        },
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

    describe("a range whose previous window would begin before the epoch", () => {
      // The previous window starts at startMs - 1 - span, so a range that
      // starts exactly one span plus 1ms after the epoch is the earliest valid one.
      const rangeStartingAt = (startMs: number) => ({
        startTime: new Date(startMs).toISOString(),
        endTime: new Date(startMs + DAY).toISOString(),
      });

      it.effect("accepts the earliest range whose previous window fits", () => {
        const onStats = vi.fn();
        const db: Partial<QuestDBService> = {
          querySummaryStats: (params) => {
            onStats(params);
            return Effect.succeed(statsRow());
          },
        };

        return Effect.gen(function* () {
          yield* getSummaryHandler({ query: rangeStartingAt(DAY + 1) });

          const previous = onStats.mock.calls[1][0];
          expect(previous.startTime.getTime()).toBe(0);
        }).pipe(Effect.provide(layers(db)));
      });

      it.effect(
        "rejects a range one millisecond earlier without querying",
        () => {
          const onStats = vi.fn();
          const db: Partial<QuestDBService> = {
            querySummaryStats: () => {
              onStats();
              return Effect.succeed(statsRow());
            },
          };

          return Effect.gen(function* () {
            const error = yield* invalidTimeRangeOf(
              getSummaryHandler({ query: rangeStartingAt(DAY) })
            );

            expect(error.message).toContain("1970");
            expect(onStats).not.toHaveBeenCalled();
          }).pipe(Effect.provide(layers(db)));
        }
      );

      it.effect.each(["1000-01-01T00:00:00Z", "0100-01-01T00:00:00Z"])(
        "rejects a start of %s",
        (startTime) =>
          Effect.gen(function* () {
            yield* invalidTimeRangeOf(
              getSummaryHandler({
                query: { startTime, endTime: "9999-12-31T00:00:00Z" },
              })
            );
          }).pipe(Effect.provide(layers({})))
      );
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

    it.effect(
      "summarizes speed tests, ignoring failed tests stored as 0",
      () => {
        const speedtest = (download: number, upload: number): MetricRow => ({
          timestamp: "2024-01-31T12:00:00Z",
          source: "speedtest",
          download_speed: download,
          upload_speed: upload,
        });
        const db: Partial<QuestDBService> = {
          querySpeedtests: () =>
            Effect.succeed([
              speedtest(0, 0),
              speedtest(100, 10),
              speedtest(300, 30),
            ]),
        };

        return Effect.gen(function* () {
          const { speed } = yield* getSummaryHandler({ query: summaryQuery });

          expect(speed).toMatchObject({
            downloadMedian: 200,
            uploadMedian: 20,
            count: 2,
          });
        }).pipe(Effect.provide(layers(db)));
      }
    );

    it.effect(
      "summarizes the speed tests of the window just before the range as previousSpeed",
      () => {
        const speedtest = (download: number, upload: number): MetricRow => ({
          timestamp: "2024-01-01T12:00:00Z",
          source: "speedtest",
          download_speed: download,
          upload_speed: upload,
        });
        const rangeStartMs = Date.parse(summaryQuery.startTime);
        const db: Partial<QuestDBService> = {
          querySpeedtests: ({ startTime }) =>
            Effect.succeed(
              (startTime?.getTime() ?? 0) < rangeStartMs
                ? [speedtest(0, 0), speedtest(400, 40), speedtest(600, 80)]
                : [speedtest(100, 10)]
            ),
        };

        return Effect.gen(function* () {
          const { speed, previousSpeed } = yield* getSummaryHandler({
            query: summaryQuery,
          });

          expect(speed).toMatchObject({ downloadMedian: 100, count: 1 });
          expect(previousSpeed).toMatchObject({
            downloadMedian: 500,
            uploadMedian: 60,
            count: 2,
          });
        }).pipe(Effect.provide(layers(db)));
      }
    );

    it.effect("reports a previous window with no speed tests as nulls", () =>
      Effect.gen(function* () {
        const { previousSpeed } = yield* getSummaryHandler({
          query: summaryQuery,
        });

        expect(previousSpeed).toMatchObject({
          downloadMedian: null,
          uploadMedian: null,
          count: 0,
        });
      }).pipe(Effect.provide(layers({})))
    );

    it.effect(
      "maps an unreachable database to the shared 503 error body",
      () => {
        const db: Partial<QuestDBService> = {
          queryHostStats: () =>
            Effect.fail(new DbUnavailable({ message: "connection refused" })),
        };

        return Effect.gen(function* () {
          const exit = yield* Effect.exit(
            getSummaryHandler({ query: summaryQuery })
          );

          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit)) {
            const error = Cause.findErrorOption(exit.cause);
            expect(Option.isSome(error)).toBe(true);
            if (Option.isSome(error)) {
              expect(error.value).toMatchObject({ error: DB_UNAVAILABLE });
            }
          }
        }).pipe(Effect.provide(layers(db)));
      }
    );
  });
});
