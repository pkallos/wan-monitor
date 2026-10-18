import type { NetworkMetric } from "@shared/metrics";
import { PACKET_LOSS_THRESHOLDS } from "@wan-monitor/shared";
import { Effect, Layer, Schedule } from "effect";
import { describe, expect, it } from "vitest";
import { getOutagesHandler } from "@/core/api/handlers/connectivity-status";
import { getSummaryHandler } from "@/core/api/handlers/summary";
import { QuestDB } from "@/infrastructure/database/questdb/service";
import {
  createLegacyTable,
  type LegacyRow,
} from "@/infrastructure/database/questdb/test-utils/legacy-table";
import {
  seedDatabase,
  seedGeneratedPings,
} from "@/infrastructure/database/questdb/test-utils/seed";
import {
  createTestLayer,
  dropTableFamily,
  isQuestDBAvailable,
  queryQuestDB,
  setupIntegrationTest,
  TEST_TABLE,
  teardownIntegrationTest,
} from "@/infrastructure/database/questdb/test-utils/setup";
import { makeTestConfigLayer } from "@/test/config";

/**
 * Integration tests for the summary and outage endpoints, run against seeded
 * QuestDB. They run when QUESTDB_AVAILABLE=true.
 */
describe("Summary Integration Tests", () => {
  const skipTests = !isQuestDBAvailable();
  // The seeded cycles are one minute apart but the configured interval is the
  // 30s default, so a figure that is right only for the measured period shows
  // up as wrong.
  const testLayer = Layer.mergeAll(createTestLayer(), makeTestConfigLayer());

  /** 00:00 PST on 2024-02-10. */
  const T0 = Date.parse("2024-02-10T08:00:00Z");
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  /** Cycles land 30s past the minute, so none sits on a window bound. */
  const at = (minute: number): number => T0 + minute * MINUTE + 30_000;
  /** 2.5 periods of the 30s cycle spacing the grouping tests use. */
  const MERGE_GAP_MS = 75_000;
  const WINDOW = {
    startTime: new Date(T0).toISOString(),
    endTime: new Date(T0 + HOUR).toISOString(),
  };

  type CycleKind = "up" | "degraded" | "down" | "oneHostDown";
  type SeededCycle = readonly [secondsAfterStart: number, kind: CycleKind];

  const HOSTS = ["8.8.8.8", "1.1.1.1"] as const;

  const hostMetric = (
    timestamp: Date,
    host: string,
    kind: "up" | "lossy" | "down",
    latency: number
  ): NetworkMetric =>
    kind === "down"
      ? {
          timestamp,
          source: "ping",
          host,
          packetLoss: 100,
          connectivityStatus: "down",
        }
      : {
          timestamp,
          source: "ping",
          host,
          latency,
          jitter: 2,
          packetLoss: kind === "lossy" ? 20 : 0,
          connectivityStatus: "up",
        };

  /** One ping cycle: every host stamped with the same timestamp. */
  const cycle = (timestampMs: number, kind: CycleKind): NetworkMetric[] => {
    const timestamp = new Date(timestampMs);
    const [a, b] = HOSTS;
    switch (kind) {
      case "up":
        return [
          hostMetric(timestamp, a, "up", 10),
          hostMetric(timestamp, b, "up", 30),
        ];
      case "degraded":
        return [
          hostMetric(timestamp, a, "lossy", 40),
          hostMetric(timestamp, b, "up", 60),
        ];
      case "down":
        return [
          hostMetric(timestamp, a, "down", 0),
          hostMetric(timestamp, b, "down", 0),
        ];
      case "oneHostDown":
        return [
          hostMetric(timestamp, a, "down", 0),
          hostMetric(timestamp, b, "up", 30),
        ];
    }
  };

  /**
   * An hour of one-minute cycles (59 of them; minute 26 is never recorded):
   *   0-19 up, 20-22 down, 23 up, 24-25 degraded, 26 missing, 27 degraded,
   *   28-39 up, 40 one host down, 41-59 up.
   * That is 52 up, 4 degraded and 3 down cycles.
   */
  const scenario = (): NetworkMetric[] => {
    const kindAt = (minute: number): CycleKind | null => {
      if (minute === 26) return null;
      if (minute >= 20 && minute <= 22) return "down";
      if (minute === 24 || minute === 25 || minute === 27) return "degraded";
      if (minute === 40) return "oneHostDown";
      return "up";
    };
    return Array.from({ length: 60 }, (_, minute) => {
      const kind = kindAt(minute);
      return kind === null ? [] : cycle(at(minute), kind);
    }).flat();
  };

  /** Mbps pairs at minutes 10, 20, 30 and 40; the third failed (stored as 0). */
  const speedtests = (): NetworkMetric[] =>
    [
      [100, 20],
      [200, 40],
      [0, 0],
      [300, 60],
    ].map(([download, upload], i) => ({
      timestamp: new Date(T0 + (10 + i * 10) * MINUTE),
      source: "speedtest" as const,
      downloadBandwidth: download * 1_000_000,
      uploadBandwidth: upload * 1_000_000,
      connectivityStatus: "up" as const,
    }));

  it.skipIf(skipTests)(
    "summarizes the range, hosts and speed tests",
    async () => {
      const program = Effect.gen(function* () {
        const db = yield* setupIntegrationTest();
        yield* seedDatabase(db, [...scenario(), ...speedtests()]);

        const summary = yield* getSummaryHandler({ query: WINDOW });

        // Per-cycle latency: 52 cycles at 20, one at 30, three at 50, and the
        // three down cycles carry none. Percentiles are approximate.
        expect(summary.range.latencyP50).toBeCloseTo(20, 0);
        expect(summary.range.latencyP95).toBeGreaterThanOrEqual(29.5);
        expect(summary.range.latencyP95).toBeLessThanOrEqual(50.5);
        // Per-cycle mean loss: 3 cycles at 100, 3 at 10, one at 50, rest 0.
        expect(summary.range.avgPacketLoss).toBeCloseTo(380 / 59, 5);
        // Failed samples carry no jitter, so only measured samples average in.
        expect(summary.range.avgJitter).toBeCloseTo(2, 5);
        expect(summary.range.uptimePercentage).toBeCloseTo((52 / 59) * 100, 5);
        expect(summary.range.availabilityPercentage).toBeCloseTo(
          (56 / 59) * 100,
          5
        );
        expect(summary.range.coveragePercentage).toBe(100);

        // The trailing windows all reach back over the seeded hour.
        for (const window of [
          summary.windows.last24h,
          summary.windows.last7d,
          summary.windows.last30d,
        ]) {
          expect(window.uptimePercentage).toBeCloseTo((52 / 59) * 100, 5);
        }

        expect(summary.hosts.map((host) => host.host)).toEqual([
          "1.1.1.1",
          "8.8.8.8",
        ]);
        const [cloudflare, google] = summary.hosts;
        expect(google.availabilityPercentage).toBeCloseTo((55 / 59) * 100, 5);
        expect(google.latencyP50).toBeCloseTo(10, 0);
        expect(google.avgPacketLoss).toBeCloseTo(460 / 59, 5);
        expect(google.lastStatus).toBe("up");
        expect(cloudflare.availabilityPercentage).toBeCloseTo(
          (56 / 59) * 100,
          5
        );
        expect(cloudflare.latencyP50).toBeCloseTo(30, 0);

        expect(summary.speed).toMatchObject({
          downloadMedian: 200,
          uploadMedian: 40,
          count: 3,
        });

        yield* teardownIntegrationTest(db);
      });

      await Effect.runPromise(Effect.provide(program, testLayer));
    }
  );

  it.skipIf(skipTests)(
    "measures the median spacing between cycles, ignoring a gap",
    async () => {
      const program = Effect.gen(function* () {
        const db = yield* setupIntegrationTest();
        const window = {
          startTime: new Date(T0),
          endTime: new Date(T0 + HOUR),
        };
        yield* seedDatabase(db, [
          ...cycle(at(0), "up"),
          ...cycle(at(0) + 40_500, "up"),
          ...cycle(at(0) + 81_000, "up"),
          // A long gap must not drag the median up.
          ...cycle(at(20), "up"),
          ...cycle(at(20) + 40_500, "up"),
        ]);

        expect(yield* db.queryCyclePeriod(window)).toBe(40_500);
        expect(
          yield* db.queryCyclePeriod({
            startTime: new Date(at(0) - 1000),
            endTime: new Date(at(0) + 1000),
          })
        ).toBeNull();

        yield* teardownIntegrationTest(db);
      });

      await Effect.runPromise(Effect.provide(program, testLayer));
    }
  );

  it.skipIf(skipTests)(
    "classifies each host's newest sample as down, degraded or up",
    async () => {
      const [a, b] = HOSTS;
      const program = Effect.gen(function* () {
        const db = yield* setupIntegrationTest();
        const first = new Date(at(0));
        const second = new Date(at(1));
        yield* seedDatabase(db, [
          hostMetric(first, a, "up", 10),
          hostMetric(first, b, "up", 30),
          hostMetric(second, a, "down", 0),
          hostMetric(second, b, "lossy", 30),
        ]);

        const summary = yield* getSummaryHandler({ query: WINDOW });

        expect(
          Object.fromEntries(
            summary.hosts.map((host) => [host.host, host.lastStatus])
          )
        ).toEqual({ [a]: "down", [b]: "degraded" });

        yield* teardownIntegrationTest(db);
      });

      await Effect.runPromise(Effect.provide(program, testLayer));
    }
  );

  it.skipIf(skipTests)(
    "counts cycles stamped exactly on the range's start and end",
    async () => {
      const program = Effect.gen(function* () {
        const db = yield* setupIntegrationTest();
        yield* seedDatabase(db, [
          ...cycle(T0, "down"),
          ...cycle(T0 + HOUR, "up"),
        ]);

        const summary = yield* getSummaryHandler({ query: WINDOW });

        // One down cycle (100% loss) and one up cycle (0%): both are in range.
        expect(summary.range.avgPacketLoss).toBe(50);

        yield* teardownIntegrationTest(db);
      });

      await Effect.runPromise(Effect.provide(program, testLayer));
    }
  );

  it.skipIf(skipTests)(
    "classifies a host whose newest sample sits exactly on the loss floor as degraded",
    async () => {
      const [a, b] = HOSTS;
      const atFloor = (host: string): NetworkMetric => ({
        timestamp: new Date(at(1)),
        source: "ping",
        host,
        latency: 10,
        jitter: 1,
        packetLoss: PACKET_LOSS_THRESHOLDS.degradedFloor,
        connectivityStatus: "up",
      });
      const program = Effect.gen(function* () {
        const db = yield* setupIntegrationTest();
        yield* seedDatabase(db, [
          hostMetric(new Date(at(0)), a, "up", 10),
          hostMetric(new Date(at(0)), b, "up", 30),
          atFloor(a),
          hostMetric(new Date(at(1)), b, "up", 30),
        ]);

        const summary = yield* getSummaryHandler({ query: WINDOW });

        expect(
          Object.fromEntries(
            summary.hosts.map((host) => [host.host, host.lastStatus])
          )
        ).toEqual({ [a]: "degraded", [b]: "up" });

        yield* teardownIntegrationTest(db);
      });

      await Effect.runPromise(Effect.provide(program, testLayer));
    }
  );

  it.skipIf(skipTests)(
    "lists a host sitting exactly on the loss floor as affected in an outage",
    async () => {
      const [a, b] = HOSTS;
      const program = Effect.gen(function* () {
        const db = yield* setupIntegrationTest();
        yield* seedDatabase(db, [
          ...cycle(at(0), "up"),
          {
            timestamp: new Date(at(1)),
            source: "ping",
            host: a,
            latency: 10,
            jitter: 1,
            packetLoss: PACKET_LOSS_THRESHOLDS.degradedFloor,
            connectivityStatus: "up",
          },
          hostMetric(new Date(at(1)), b, "up", 30),
          ...cycle(at(2), "up"),
        ]);

        const result = yield* getOutagesHandler({ query: WINDOW });

        expect(result.data).toHaveLength(1);
        expect(result.data[0]).toMatchObject({
          status: "degraded",
          affectedHosts: [a],
          maxPacketLoss: PACKET_LOSS_THRESHOLDS.degradedFloor,
        });

        yield* teardownIntegrationTest(db);
      });

      await Effect.runPromise(Effect.provide(program, testLayer));
    }
  );

  it.skipIf(skipTests)(
    "builds the outage log from runs of non-up cycles",
    async () => {
      const program = Effect.gen(function* () {
        const db = yield* setupIntegrationTest();
        yield* seedDatabase(db, scenario());

        const result = yield* getOutagesHandler({ query: WINDOW });

        expect(result.meta.totalCount).toBe(3);
        // A lone host down is a degraded cycle: a target problem, not a WAN outage.
        expect(result.data[0]).toEqual({
          start: new Date(at(40)).toISOString(),
          end: new Date(at(41)).toISOString(),
          durationSeconds: 60,
          status: "degraded",
          affectedHosts: ["8.8.8.8"],
          maxPacketLoss: 100,
          peakLatency: 30,
        });
        // Minutes 24, 25 and 27 merge across the missing cycle at 26.
        expect(result.data[1]).toEqual({
          start: new Date(at(24)).toISOString(),
          end: new Date(at(28)).toISOString(),
          durationSeconds: 240,
          status: "degraded",
          affectedHosts: ["8.8.8.8"],
          maxPacketLoss: 20,
          peakLatency: 60,
        });
        expect(result.data[2]).toEqual({
          start: new Date(at(20)).toISOString(),
          end: new Date(at(23)).toISOString(),
          durationSeconds: 180,
          status: "down",
          affectedHosts: ["1.1.1.1", "8.8.8.8"],
          maxPacketLoss: 100,
          peakLatency: null,
        });

        yield* teardownIntegrationTest(db);
      });

      await Effect.runPromise(Effect.provide(program, testLayer));
    }
  );

  it.skipIf(skipTests)(
    "reports a 40,000-cycle outage on one host",
    async () => {
      const flakyHost = "blocks-icmp.long-hostname-for-testing.example";
      const cycleCount = 40_000;
      const cycleMs = 30_000;
      const endMs = T0 + cycleCount * cycleMs;
      const program = Effect.gen(function* () {
        const db = yield* setupIntegrationTest();
        yield* seedGeneratedPings([
          {
            host: flakyHost,
            startMs: T0,
            count: cycleCount,
            intervalMs: cycleMs,
            kind: "down",
          },
          {
            host: "1.1.1.1",
            startMs: T0,
            count: cycleCount,
            intervalMs: cycleMs,
            kind: "up",
          },
        ]);

        const result = yield* getOutagesHandler({
          query: {
            startTime: new Date(T0).toISOString(),
            endTime: new Date(endMs).toISOString(),
          },
        });

        expect(result.meta.totalCount).toBe(1);
        expect(result.data[0]).toEqual({
          start: new Date(T0).toISOString(),
          end: new Date(endMs).toISOString(),
          durationSeconds: (cycleCount * cycleMs) / 1000,
          status: "degraded",
          affectedHosts: [flakyHost],
          maxPacketLoss: 100,
          peakLatency: 30,
        });

        yield* teardownIntegrationTest(db);
      });

      await Effect.runPromise(Effect.provide(program, testLayer));
    },
    120_000
  );

  it.skipIf(skipTests)(
    "returns one row per outage, not per cycle, for a window that is non-up throughout",
    async () => {
      const cycleCount = 4_000;
      const cycleMs = 30_000;
      const startMs = (cycle: number) => T0 + cycle * cycleMs;
      const program = Effect.gen(function* () {
        const db = yield* setupIntegrationTest();
        yield* seedGeneratedPings([
          {
            host: "8.8.8.8",
            startMs: T0,
            count: cycleCount,
            intervalMs: cycleMs,
            kind: "down",
          },
          // Down for 100 of the 4,000 cycles: affected only inside the run.
          {
            host: "9.9.9.9",
            startMs: T0,
            count: 1_500,
            intervalMs: cycleMs,
            kind: "up",
          },
          {
            host: "9.9.9.9",
            startMs: startMs(1_500),
            count: 100,
            intervalMs: cycleMs,
            kind: "down",
          },
          {
            host: "9.9.9.9",
            startMs: startMs(1_600),
            count: 2_400,
            intervalMs: cycleMs,
            kind: "up",
          },
          {
            host: "1.1.1.1",
            startMs: T0,
            count: cycleCount,
            intervalMs: cycleMs,
            kind: "up",
          },
        ]);

        const runs = yield* db.queryOutageRuns({
          startTime: new Date(T0),
          endTime: new Date(startMs(cycleCount)),
          mergeGapMs: MERGE_GAP_MS,
        });

        expect(runs).toHaveLength(1);
        expect([...(runs[0]?.affected_hosts ?? [])].sort()).toEqual([
          "8.8.8.8",
          "9.9.9.9",
        ]);

        yield* teardownIntegrationTest(db);
      });

      await Effect.runPromise(Effect.provide(program, testLayer));
    },
    60_000
  );

  it.skipIf(skipTests)(
    "returns one row per outage, not per cycle, for a mostly-up 90-day window",
    async () => {
      const cycleMs = 10 * MINUTE;
      const cycleCount = (90 * 24 * HOUR) / cycleMs;
      const at = (cycle: number) => T0 + cycle * cycleMs;
      const program = Effect.gen(function* () {
        const db = yield* setupIntegrationTest();
        const host = "8.8.8.8";
        yield* seedGeneratedPings([
          { host, startMs: T0, count: 5_000, intervalMs: cycleMs, kind: "up" },
          {
            host,
            startMs: at(5_000),
            count: 3,
            intervalMs: cycleMs,
            kind: "down",
          },
          {
            host,
            startMs: at(5_003),
            count: 5_000,
            intervalMs: cycleMs,
            kind: "up",
          },
          {
            host,
            startMs: at(10_003),
            count: 1,
            intervalMs: cycleMs,
            kind: "down",
          },
          {
            host,
            startMs: at(10_004),
            count: cycleCount - 10_004,
            intervalMs: cycleMs,
            kind: "up",
          },
        ]);

        const runs = yield* db.queryOutageRuns({
          startTime: new Date(T0),
          endTime: new Date(at(cycleCount)),
          mergeGapMs: 2.5 * cycleMs,
        });

        expect(runs.map((run) => Date.parse(run.start_time))).toEqual([
          at(5_000),
          at(10_003),
        ]);

        yield* teardownIntegrationTest(db);
      });

      await Effect.runPromise(Effect.provide(program, testLayer));
    },
    60_000
  );

  describe.skipIf(skipTests)("outage grouping", () => {
    type Span = readonly [firstSecond: number, lastSecond: number];

    const outageRuns = (cycles: readonly SeededCycle[]) =>
      Effect.gen(function* () {
        const db = yield* setupIntegrationTest();
        yield* seedDatabase(
          db,
          cycles.flatMap(([seconds, kind]) => cycle(T0 + seconds * 1000, kind))
        );

        const runs = yield* db.queryOutageRuns({
          startTime: new Date(T0),
          endTime: new Date(T0 + HOUR),
          mergeGapMs: MERGE_GAP_MS,
        });

        yield* teardownIntegrationTest(db);
        return runs;
      }).pipe(Effect.provide(testLayer));

    const spanOf = (run: { start_time: string; last_time: string }): Span => [
      (Date.parse(run.start_time) - T0) / 1000,
      (Date.parse(run.last_time) - T0) / 1000,
    ];

    it.each<[string, readonly SeededCycle[], readonly Span[]]>([
      [
        "keeps consecutive non-up cycles in one run",
        [
          [0, "up"],
          [30, "down"],
          [60, "down"],
          [90, "down"],
          [120, "up"],
        ],
        [[30, 90]],
      ],
      [
        "does not split a run at a degraded cycle between down ones",
        [
          [30, "down"],
          [60, "degraded"],
          [90, "down"],
        ],
        [[30, 90]],
      ],
      [
        "bridges a single missing cycle",
        [
          [0, "up"],
          [30, "down"],
          [60, "down"],
          [120, "down"],
          [150, "up"],
        ],
        [[30, 120]],
      ],
      [
        "splits at two missing cycles",
        [
          [30, "down"],
          [120, "down"],
        ],
        [
          [30, 30],
          [120, 120],
        ],
      ],
      [
        "merges two non-up cycles exactly the merge gap apart",
        [
          [0, "down"],
          [75, "down"],
        ],
        [[0, 75]],
      ],
      [
        "splits two non-up cycles a second past the merge gap",
        [
          [0, "down"],
          [76, "down"],
        ],
        [
          [0, 0],
          [76, 76],
        ],
      ],
      [
        "splits at an up cycle even though the gap is one period",
        [
          [0, "down"],
          [30, "up"],
          [60, "down"],
        ],
        [
          [0, 0],
          [60, 60],
        ],
      ],
      [
        "starts a run after an up cycle that is far behind it",
        [
          [0, "up"],
          [300, "down"],
        ],
        [[300, 300]],
      ],
      [
        "starts a run that touches the window start at its first cycle",
        [
          [0, "down"],
          [30, "down"],
          [60, "up"],
        ],
        [[0, 30]],
      ],
      [
        "finds nothing when every cycle is up",
        [
          [0, "up"],
          [30, "up"],
        ],
        [],
      ],
    ])("%s", async (_name, cycles, expected) => {
      const runs = await Effect.runPromise(outageRuns(cycles));

      expect(runs.map(spanOf)).toEqual(expected);
    });

    it("marks a run down only when one of its cycles was down", async () => {
      const runs = await Effect.runPromise(
        outageRuns([
          [0, "degraded"],
          [30, "up"],
          [60, "degraded"],
          [90, "down"],
        ])
      );

      expect(runs.map((run) => run.had_down)).toEqual([false, true]);
    });

    it("reports a run's worst loss and peak latency across its cycles", async () => {
      const host = "8.8.8.8";
      const lossy = (
        seconds: number,
        packetLoss: number,
        latency: number
      ): NetworkMetric => ({
        timestamp: new Date(T0 + seconds * 1000),
        source: "ping",
        host,
        latency,
        jitter: 2,
        packetLoss,
        connectivityStatus: "up",
      });
      const program = Effect.gen(function* () {
        const db = yield* setupIntegrationTest();
        yield* seedDatabase(db, [
          lossy(0, 30, 120),
          hostMetric(new Date(T0 + 30_000), host, "down", 0),
          lossy(60, 50, 200),
        ]);

        const runs = yield* db.queryOutageRuns({
          startTime: new Date(T0),
          endTime: new Date(T0 + HOUR),
          mergeGapMs: MERGE_GAP_MS,
        });
        const outages = yield* getOutagesHandler({ query: WINDOW });

        yield* teardownIntegrationTest(db);
        return { runs, outages };
      }).pipe(Effect.provide(testLayer));

      const { runs, outages } = await Effect.runPromise(program);

      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({
        had_down: true,
        max_packet_loss: 100,
        peak_latency: 200,
      });
      expect(outages.data).toEqual([
        expect.objectContaining({
          status: "down",
          maxPacketLoss: 100,
          peakLatency: 200,
        }),
      ]);
    });
  });

  describe.skipIf(skipTests)("window bounds", () => {
    /**
     * A down cycle stamped on one end of the window and an up cycle 30s inside
     * it, so every query that bounds the window must keep the boundary cycle.
     */
    it.each<[string, readonly SeededCycle[], number]>([
      [
        "start",
        [
          [0, "down"],
          [30, "up"],
        ],
        0,
      ],
      [
        "end",
        [
          [3570, "up"],
          [3600, "down"],
        ],
        3600,
      ],
    ])(
      "includes a cycle stamped exactly on the window %s",
      async (_side, cycles, downSecond) => {
        const window = {
          startTime: new Date(T0),
          endTime: new Date(T0 + HOUR),
        };
        const program = Effect.gen(function* () {
          const db = yield* setupIntegrationTest();
          yield* seedDatabase(
            db,
            cycles.flatMap(([seconds, kind]) =>
              cycle(T0 + seconds * 1000, kind)
            )
          );

          const hostStats = yield* db.queryHostStats(window);
          const runs = yield* db.queryOutageRuns({
            ...window,
            mergeGapMs: MERGE_GAP_MS,
          });
          const period = yield* db.queryCyclePeriod(window);

          expect(hostStats.map((host) => host.total_count)).toEqual([2, 2]);
          expect(
            runs.map((run) => [
              (Date.parse(run.start_time) - T0) / 1000,
              [...run.affected_hosts].sort(),
            ])
          ).toEqual([[downSecond, ["1.1.1.1", "8.8.8.8"]]]);
          expect(period).toBe(30_000);

          yield* teardownIntegrationTest(db);
        });

        await Effect.runPromise(Effect.provide(program, testLayer));
      }
    );
  });

  it.skipIf(skipTests)(
    "clips an outage still running at the end of the window to that end",
    async () => {
      const program = Effect.gen(function* () {
        const db = yield* setupIntegrationTest();
        yield* seedDatabase(db, [
          ...cycle(T0, "up"),
          ...cycle(T0 + 30_000, "down"),
          ...cycle(T0 + 60_000, "down"),
        ]);

        const result = yield* getOutagesHandler({
          query: {
            startTime: new Date(T0).toISOString(),
            endTime: new Date(T0 + 75_000).toISOString(),
          },
        });

        expect(result.data).toHaveLength(1);
        expect(result.data[0]).toMatchObject({
          start: new Date(T0 + 30_000).toISOString(),
          end: new Date(T0 + 75_000).toISOString(),
          durationSeconds: 45,
          status: "down",
        });

        yield* teardownIntegrationTest(db);
      });

      await Effect.runPromise(Effect.provide(program, testLayer));
    }
  );

  describe.skipIf(skipTests)("outage end", () => {
    const outagesFor = (cycles: readonly SeededCycle[]) =>
      Effect.gen(function* () {
        const db = yield* setupIntegrationTest();
        yield* seedDatabase(
          db,
          cycles.flatMap(([seconds, kind]) => cycle(T0 + seconds * 1000, kind))
        );

        const result = yield* getOutagesHandler({ query: WINDOW });

        yield* teardownIntegrationTest(db);
        return result.data;
      }).pipe(Effect.provide(testLayer));

    // Every gap but the one before the recovery cycle is 30s, so the period
    // stays 30s and only the recovery cycle's time changes the end.
    it.each<[string, number, number]>([
      ["at the up cycle recorded within the merge gap after it", 105, 105],
      ["at the up cycle recorded exactly the merge gap after it", 135, 135],
      [
        "one period after its last cycle when no up cycle followed within the merge gap",
        136,
        90,
      ],
    ])("ends an outage %s", async (_name, recoveredSecond, endSecond) => {
      const outages = await Effect.runPromise(
        outagesFor([
          [0, "up"],
          [30, "up"],
          [60, "down"],
          [recoveredSecond, "up"],
          [recoveredSecond + 30, "up"],
          [recoveredSecond + 60, "up"],
        ])
      );

      expect(outages).toHaveLength(1);
      expect(outages[0]).toMatchObject({
        start: new Date(T0 + 60_000).toISOString(),
        end: new Date(T0 + endSecond * 1000).toISOString(),
        durationSeconds: endSecond - 60,
      });
    });
  });

  describe.skipIf(skipTests)(
    "on a legacy table that predates the schema migrations",
    () => {
      // A name no earlier run has written through ILP: QuestDB's ILP writer
      // loses the first batch for a name whose table was dropped.
      const legacyName = `${TEST_TABLE}_legacy_${Date.now().toString(36)}`;
      const legacyLayer = Layer.mergeAll(
        createTestLayer(legacyName),
        makeTestConfigLayer()
      );
      const CYCLE_MS = 30_000;
      const atCycle = (index: number): number => T0 + index * CYCLE_MS;
      const [google, cloudflare] = HOSTS;

      /** A series of `kind` pings for `host` over cycles `from` up to but not including `to`. */
      const span = (
        host: string,
        from: number,
        to: number,
        kind: "up" | "down"
      ) => ({
        host,
        startMs: atCycle(from),
        count: to - from,
        intervalMs: CYCLE_MS,
        kind,
      });

      /**
       * An hour of 30s cycles: both hosts down for cycles 20-22, only 8.8.8.8
       * down at 40, and both down for 60-61 and 63 with no cycle recorded at 62.
       */
      const series = [
        ...[google, cloudflare].flatMap((host) => [
          span(host, 0, 20, "up"),
          span(host, 20, 23, "down"),
          span(host, 60, 62, "down"),
          span(host, 63, 64, "down"),
          span(host, 64, 120, "up"),
        ]),
        span(google, 23, 40, "up"),
        span(google, 40, 41, "down"),
        span(google, 41, 60, "up"),
        span(cloudflare, 23, 60, "up"),
      ];

      const legacyRows = series.flatMap(
        ({ host, startMs, count, intervalMs, kind }) =>
          Array.from({ length: count }, (_, index): LegacyRow => {
            const timestampMs = startMs + index * intervalMs;
            return kind === "down"
              ? {
                  timestampMs,
                  source: "ping",
                  host,
                  packetLoss: 100,
                  connectivityStatus: "down",
                }
              : {
                  timestampMs,
                  source: "ping",
                  host,
                  latency: 30,
                  jitter: 2,
                  packetLoss: 0,
                  connectivityStatus: "up",
                };
          })
      );

      it("is migrated on connect, then measures the cycle period and outage durations", async () => {
        const designatedType = async () =>
          (
            await queryQuestDB(
              `SELECT type FROM table_columns('${legacyName}') WHERE designated`
            )
          )[0];
        await Effect.runPromise(dropTableFamily(legacyName));
        await Effect.runPromise(createLegacyTable(legacyName, legacyRows));

        const program = Effect.gen(function* () {
          const db = yield* QuestDB;
          yield* db
            .health()
            .pipe(
              Effect.retry(
                Schedule.spaced("200 millis").pipe(
                  Schedule.upTo({ duration: "30 seconds" })
                )
              )
            );

          const period = yield* db.queryCyclePeriod({
            startTime: new Date(T0),
            endTime: new Date(T0 + HOUR),
          });
          const result = yield* getOutagesHandler({ query: WINDOW });
          return { period, outages: result.data };
        }).pipe(Effect.provide(legacyLayer));

        const before = await designatedType();
        let after: Awaited<ReturnType<typeof designatedType>>;
        let ledger: readonly (readonly unknown[])[];
        let leftovers: readonly (readonly unknown[])[];
        let result: { period: number | null; outages: unknown };
        try {
          result = await Effect.runPromise(program);
          after = await designatedType();
          ledger = await queryQuestDB(
            `SELECT version FROM ${legacyName}_migrations ORDER BY version`
          );
          leftovers = await queryQuestDB(
            `SELECT table_name FROM tables() WHERE table_name IN ('${legacyName}__previous', '${legacyName}__rebuild')`
          );
        } finally {
          await Effect.runPromise(dropTableFamily(legacyName));
        }
        const { period, outages } = result;

        expect(before).toEqual(["TIMESTAMP_NS"]);
        expect(after).toEqual(["TIMESTAMP"]);
        expect(ledger).toEqual([[1], [2]]);
        expect(leftovers).toEqual([]);
        expect(period).toBe(CYCLE_MS);
        expect(outages).toEqual([
          {
            start: new Date(atCycle(60)).toISOString(),
            end: new Date(atCycle(64)).toISOString(),
            durationSeconds: 120,
            status: "down",
            affectedHosts: [cloudflare, google],
            maxPacketLoss: 100,
            peakLatency: null,
          },
          {
            start: new Date(atCycle(40)).toISOString(),
            end: new Date(atCycle(41)).toISOString(),
            durationSeconds: 30,
            status: "degraded",
            affectedHosts: [google],
            maxPacketLoss: 100,
            peakLatency: 30,
          },
          {
            start: new Date(atCycle(20)).toISOString(),
            end: new Date(atCycle(23)).toISOString(),
            durationSeconds: 90,
            status: "down",
            affectedHosts: [cloudflare, google],
            maxPacketLoss: 100,
            peakLatency: null,
          },
        ]);
      }, 60_000);
    }
  );

  it.skipIf(skipTests)(
    "returns no outages when every cycle is up",
    async () => {
      const program = Effect.gen(function* () {
        const db = yield* setupIntegrationTest();
        yield* seedDatabase(
          db,
          [0, 1, 2].flatMap((minute) => cycle(at(minute), "up"))
        );

        const result = yield* getOutagesHandler({ query: WINDOW });

        expect(result.data).toEqual([]);
        expect(result.meta.totalCount).toBe(0);

        yield* teardownIntegrationTest(db);
      });

      await Effect.runPromise(Effect.provide(program, testLayer));
    }
  );
});
