import type { NetworkMetric } from "@shared/metrics";
import {
  DEGRADED_BUCKET_MIN_SHARE,
  type Granularity,
} from "@wan-monitor/shared";
import { Clock, Effect, Layer, Schedule } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import {
  getConnectivityStatusHandler,
  getLiveConnectivityHandler,
  getOutagesHandler,
} from "@/core/api/handlers/connectivity-status";
import { getSummaryHandler } from "@/core/api/handlers/summary";
import {
  PingExecutor,
  PingExecutorLive,
} from "@/core/monitoring/ping-executor";
import { QuestDB } from "@/infrastructure/database/questdb";
import {
  type FixtureCycle,
  type FixtureStatus,
  fullCycle,
  HOSTS,
  legacyRows,
  roundAt,
  sharedRows,
  singleRow,
  speedtestRow,
  startStampedRows,
} from "@/infrastructure/database/questdb/test-utils/cycle-fixture";
import {
  seedTable,
  waitForRowCount,
} from "@/infrastructure/database/questdb/test-utils/seed";
import {
  createTestLayer,
  dropTableFamily,
  isQuestDBAvailable,
  queryQuestDB,
  TEST_TABLE,
} from "@/infrastructure/database/questdb/test-utils/setup";
import {
  bucketsOf,
  type ReferenceParams,
  referenceOf,
} from "@/infrastructure/database/questdb/test-utils/wan-state-reference";
import {
  type PingError,
  PingHostUnreachableError,
  type PingResult,
  PingService,
} from "@/infrastructure/ping/service";
import { makeTestConfigLayer } from "@/test/config";

/**
 * WAN state read as a function of time from each host's own samples, through
 * the real handlers against QuestDB. Every case writes its own table, and
 * rows go in on the live clock at fixed past instants; only the handler call
 * runs under a fixed clock.
 */
describe("Time model integration", () => {
  const skipTests = !isQuestDBAvailable();

  const S = 1000;
  const T0 = Date.parse("2026-07-01T00:00:00Z");
  const INTERVAL_MS = 30 * S;
  const FAR_NOW_MS = T0 + 30 * 24 * 3600 * S;

  const tables: string[] = [];

  afterEach(async () => {
    while (tables.length > 0) {
      const table = tables.pop();
      if (table !== undefined) {
        await Effect.runPromise(dropTableFamily(table));
      }
    }
  });

  interface CaseConfig {
    readonly hosts?: readonly string[];
    readonly intervalMs?: number;
  }

  interface Window {
    readonly startMs: number;
    readonly endMs: number;
    /** The reading clock; long after every fixture when omitted. */
    readonly nowMs?: number;
    readonly granularity?: Granularity;
  }

  const fixedClock = (nowMs: number): Clock.Clock => ({
    currentTimeMillisUnsafe: () => nowMs,
    currentTimeMillis: Effect.succeed(nowMs),
    currentTimeNanosUnsafe: () => BigInt(nowMs) * 1_000_000n,
    currentTimeNanos: Effect.succeed(BigInt(nowMs) * 1_000_000n),
    monotonicTimeNanosUnsafe: () => BigInt(nowMs) * 1_000_000n,
    monotonicTimeNanos: Effect.succeed(BigInt(nowMs) * 1_000_000n),
    sleep: () => Effect.void,
  });

  const layerFor = (table: string, config: CaseConfig) =>
    Layer.mergeAll(
      createTestLayer(table),
      makeTestConfigLayer({
        ping: {
          hosts: [...(config.hosts ?? HOSTS)],
          intervalSeconds: (config.intervalMs ?? INTERVAL_MS) / S,
        },
      })
    );

  const seed = async (
    name: string,
    rows: readonly NetworkMetric[]
  ): Promise<string> => {
    const table = `${TEST_TABLE}_tm_${name}`;
    tables.push(table);
    await Effect.runPromise(seedTable(table, rows));
    return table;
  };

  const iso = (ms: number): string => new Date(ms).toISOString();

  /**
   * A freshly built QuestDB layer connects in the background and answers 503
   * until it has. Handlers run only after it has, on the live clock.
   */
  const untilConnected = Effect.gen(function* () {
    const db = yield* QuestDB;
    yield* db
      .health()
      .pipe(
        Effect.retry(
          Schedule.spaced("100 millis").pipe(
            Schedule.upTo({ duration: "30 seconds" })
          )
        )
      );
  });

  const readAll = (table: string, window: Window, config: CaseConfig = {}) => {
    const nowMs = window.nowMs ?? FAR_NOW_MS;
    const query = {
      startTime: iso(window.startMs),
      endTime: iso(window.endMs),
    };
    return Effect.runPromise(
      Effect.gen(function* () {
        yield* untilConnected;
        return yield* Effect.gen(function* () {
          const outages = yield* getOutagesHandler({ query });
          const ribbon = yield* getConnectivityStatusHandler({
            query: { ...query, granularity: window.granularity ?? "1m" },
          });
          const live = yield* getLiveConnectivityHandler();
          return { outages, ribbon, live };
        }).pipe(Effect.provideService(Clock.Clock, fixedClock(nowMs)));
      }).pipe(Effect.provide(layerFor(table, config)))
    );
  };

  const summaryOf = (table: string, window: Window, config: CaseConfig = {}) =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* untilConnected;
        return yield* getSummaryHandler({
          query: { startTime: iso(window.startMs), endTime: iso(window.endMs) },
        }).pipe(
          Effect.provideService(
            Clock.Clock,
            fixedClock(window.nowMs ?? window.endMs)
          )
        );
      }).pipe(Effect.provide(layerFor(table, config)))
    );

  type Read = Awaited<ReturnType<typeof readAll>>;

  /** Outages oldest first, as seconds after T0: `600..630 down [hosts]`. */
  const lines = (read: Read): string =>
    [...read.outages.data]
      .reverse()
      .map((outage) => {
        const start = (Date.parse(outage.start) - T0) / S;
        const end = (Date.parse(outage.end) - T0) / S;
        return `${start}..${end} ${outage.status === "down" ? "down" : "degr"} [${outage.affectedHosts}]`;
      })
      .join(" | ");

  const downBuckets = (read: Read): number =>
    read.ribbon.data.filter((point) => point.status === "down").length;

  const referenceParams = (
    window: Window,
    config: CaseConfig = {}
  ): ReferenceParams => ({
    startMs: window.startMs,
    endMs: window.endMs,
    nowMs: window.nowMs ?? window.endMs,
    intervalMs: config.intervalMs ?? INTERVAL_MS,
    hosts: config.hosts ?? HOSTS,
  });

  const rounds = (
    count: number,
    make: (index: number) => FixtureCycle
  ): FixtureCycle[] => Array.from({ length: count }, (_, i) => make(i));

  const at = (round: number): number => T0 + round * INTERVAL_MS;

  /** Spacing of the skewed history's rounds, a little longer than the configured interval. */
  const SKEWED_ROUND_MS = 32 * S;
  const roundSeconds = (rounds: number): number =>
    (rounds * SKEWED_ROUND_MS) / S;

  /**
   * 120 rounds whose hosts land 0, 3 and 8 ms apart: every second block of ten
   * rounds has the first host lossy, and the fifth block has every host down.
   */
  const skewedRows = (): NetworkMetric[] =>
    legacyRows(
      rounds(120, (i) => {
        const block = Math.floor(i / 10);
        return roundAt(
          T0 + i * SKEWED_ROUND_MS,
          [0, 3, 8],
          (position): FixtureStatus => {
            if (block === 4) {
              return "down";
            }
            return block % 2 === 1 && position === 0 ? "degraded" : "up";
          }
        );
      })
    );

  /** A window read at its own end, as a dashboard reads the present. */
  const atEdge = (window: Window): Window => ({
    ...window,
    nowMs: window.endMs,
  });

  const hourWindow: Window = { startMs: T0, endMs: T0 + 3600 * S };

  describe("shape invariance", () => {
    const statusOf =
      (round: number) =>
      (position: number): FixtureStatus => {
        if (round >= 30 && round <= 33) {
          return "down";
        }
        return round >= 10 && round <= 14 && position === 0 ? "degraded" : "up";
      };

    const scenario = (
      offsetsOf: (down: boolean) => readonly number[]
    ): FixtureCycle[] =>
      rounds(60, (round) =>
        roundAt(
          at(round),
          offsetsOf(round >= 30 && round <= 33),
          statusOf(round)
        )
      );

    const shapes: readonly (readonly [
      string,
      (cycles: readonly FixtureCycle[]) => NetworkMetric[],
      (down: boolean) => readonly number[],
      number,
    ])[] = [
      ["shared stamps", sharedRows, () => [0, 0, 0], 0],
      [
        "start-stamped with skew",
        (cycles) => startStampedRows(cycles, 1),
        () => [0, 1, 2],
        2,
      ],
      ["legacy [0, 3, 8] ms", legacyRows, () => [0, 3, 8], 8],
      ["legacy +4 s", legacyRows, () => [0, 3, 4005], 4005],
      [
        "legacy +20 s in down rounds",
        legacyRows,
        (down) => (down ? [0, 3, 20_005] : [0, 3, 8]),
        20_005,
      ],
    ];

    it.skipIf(skipTests).each(shapes)(
      "reads %s as the same outages and buckets",
      async (name, write, offsetsOf, maxOffsetMs) => {
        const rows = write(scenario(offsetsOf));
        const table = await seed(`shape_${name.replace(/\W+/g, "_")}`, rows);

        const read = await readAll(table, { ...hourWindow, endMs: at(60) });

        expect(
          read.outages.data.map((o) => [o.status, o.affectedHosts])
        ).toEqual([
          ["down", ["1.1.1.1", "8.8.8.8", "cloudflare.com"]],
          ["degraded", ["8.8.8.8"]],
        ]);
        expect(read.ribbon.data).toHaveLength(30);

        const fiveMinutes = await readAll(table, {
          ...hourWindow,
          endMs: at(60),
          granularity: "5m",
        });
        expect(fiveMinutes.ribbon.data.map((p) => p.status)).toEqual([
          "up",
          "degraded",
          "up",
          "down",
          "up",
          "up",
        ]);

        const [newest, oldest] = read.outages.data;
        expect(
          Math.abs(Date.parse(oldest?.start ?? "") - at(10))
        ).toBeLessThanOrEqual(maxOffsetMs);
        expect(
          Math.abs(Date.parse(oldest?.end ?? "") - at(15))
        ).toBeLessThanOrEqual(maxOffsetMs);
        expect(
          Math.abs(Date.parse(newest?.start ?? "") - at(30))
        ).toBeLessThanOrEqual(maxOffsetMs);
        expect(
          Math.abs(Date.parse(newest?.end ?? "") - at(34))
        ).toBeLessThanOrEqual(maxOffsetMs);

        const expected = referenceOf(
          rows,
          referenceParams({ ...hourWindow, endMs: at(60) })
        );
        expect(
          [...read.outages.data]
            .reverse()
            .map((o) => [Date.parse(o.start), Date.parse(o.end)])
        ).toEqual(expected.outages.map((o) => [o.startMs, o.endMs]));
      }
    );

    it.skipIf(skipTests)(
      "reports the degraded outage's peak latency from the rows inside it",
      async () => {
        const rows = startStampedRows(
          scenario(() => [0, 1, 2]),
          1
        );
        const table = await seed("shape_peak", rows);

        const read = await readAll(table, { ...hourWindow, endMs: at(60) });

        const inside = rows.filter(
          (row) =>
            row.timestamp.getTime() >= at(10) &&
            row.timestamp.getTime() < at(15)
        );
        const peak = Math.max(...inside.map((row) => row.latency ?? 0));
        expect(read.outages.data[1]?.peakLatency).toBeCloseTo(peak, 6);
        expect(read.outages.data[1]?.maxPacketLoss).toBe(30);
      }
    );
  });

  describe("legacy history", () => {
    const skewedWindow: Window = {
      startMs: T0,
      endMs: T0 + 120 * SKEWED_ROUND_MS + 60 * S,
    };

    it.skipIf(skipTests)(
      "turns alternating degraded blocks into outages of minutes, not seconds-long ones",
      async () => {
        const rows = legacyRows(
          rounds(120, (i) =>
            roundAt(T0 + i * SKEWED_ROUND_MS, [0, 3, 8], (position) =>
              Math.floor(i / 10) % 2 === 1 && position === 0 ? "degraded" : "up"
            )
          )
        );
        const table = await seed("alternating_blocks", rows);

        const read = await readAll(table, skewedWindow);

        expect(read.outages.data).toHaveLength(6);
        for (const outage of read.outages.data) {
          expect(outage.durationSeconds).toBeCloseTo(
            (10 * SKEWED_ROUND_MS) / S,
            1
          );
          expect(outage.status).toBe("degraded");
        }
      }
    );

    it.skipIf(skipTests)(
      "reads the same outages and ribbon whichever hosts are configured",
      async () => {
        const table = await seed("hcfg_skewed", skewedRows());

        const all = await readAll(table, skewedWindow, { hosts: HOSTS });
        const one = await readAll(table, skewedWindow, { hosts: ["8.8.8.8"] });
        const none = await readAll(table, skewedWindow, { hosts: [] });

        expect(lines(all)).toBe(
          [
            `${roundSeconds(10)}..${roundSeconds(20)} degr [8.8.8.8]`,
            `${roundSeconds(30)}..${roundSeconds(60)} down [1.1.1.1,8.8.8.8,cloudflare.com]`,
            `${roundSeconds(70)}..${roundSeconds(80)} degr [8.8.8.8]`,
            `${roundSeconds(90)}..${roundSeconds(100)} degr [8.8.8.8]`,
            `${roundSeconds(110)}..${(120 * SKEWED_ROUND_MS + 8) / S} degr [8.8.8.8]`,
          ].join(" | ")
        );
        expect(lines(one)).toBe(lines(all));
        expect(lines(none)).toBe(lines(all));
        expect(one.ribbon.data).toEqual(all.ribbon.data);
        expect(none.ribbon.data).toEqual(all.ribbon.data);
      }
    );

    it.skipIf(skipTests)(
      "bridges a missing round for a configured host and not for another",
      async () => {
        const rows: NetworkMetric[] = [];
        for (let i = 0; i < 40; i++) {
          for (const host of HOSTS) {
            if (host === "8.8.8.8" && i === 22) {
              continue;
            }
            const down = host === "8.8.8.8" && i >= 20 && i <= 24;
            rows.push(singleRow(at(i), host, down ? "down" : "up"));
          }
        }
        const table = await seed("hcfg_missing", rows);
        const window = { startMs: T0, endMs: at(40) };

        const configured = await readAll(table, window);
        const unconfigured = await readAll(table, window, {
          hosts: ["1.1.1.1", "cloudflare.com"],
        });

        expect(lines(configured)).toBe("600..750 degr [8.8.8.8]");
        expect(lines(unconfigured)).toBe(
          "600..660 degr [8.8.8.8] | 690..750 degr [8.8.8.8]"
        );
      }
    );

    it.skipIf(skipTests)(
      "reads a day-long all-down run with one missed round as one outage",
      async () => {
        const roundCount = 2700;
        const cycles = rounds(roundCount, (i) =>
          roundAt(T0 + i * SKEWED_ROUND_MS, [0, 3, 4005], () => "down")
        ).filter((_, i) => i !== 1000);
        const table = await seed("long_outage", legacyRows(cycles));
        const endMs = T0 + roundCount * SKEWED_ROUND_MS + 120 * S;

        const read = await readAll(table, {
          startMs: T0,
          endMs,
          granularity: "1h",
        });

        expect(read.outages.data).toHaveLength(1);
        const [outage] = read.outages.data;
        expect(outage?.status).toBe("down");
        expect(outage?.affectedHosts).toEqual([
          "1.1.1.1",
          "8.8.8.8",
          "cloudflare.com",
        ]);
        // From the first row to the last host's final row plus one spacing.
        expect(outage?.durationSeconds).toBe(
          (roundCount * SKEWED_ROUND_MS + 4005) / S
        );
      },
      60_000
    );
  });

  describe("no-data boundaries", () => {
    const skews = [
      ["skew1ms", [0, 1, 2], 2],
      ["legacy3_8ms", [0, 3, 8], 8],
      ["legacy4s", [0, 3, 4005], 4005],
    ] as const;

    const failingFirst = (position: number): FixtureStatus =>
      position === 0 ? "down" : "up";

    describe.each(skews)("%s", (name, offsets, last) => {
      const rowsOf = (cycles: readonly FixtureCycle[]) => legacyRows(cycles);
      const upRounds = rounds(10, (i) => roundAt(at(i), [0, 0, 0]));

      it.skipIf(skipTests)(
        "reads one failing host after a gap as degraded",
        async () => {
          const cycles = [
            ...upRounds,
            ...rounds(10, (i) => roundAt(at(50 + i), offsets, failingFirst)),
          ];
          const table = await seed(`b1_gap_${name}`, rowsOf(cycles));

          const read = await readAll(table, hourWindow);

          expect(lines(read)).toBe(
            `1500..${1800 + last / 1000} degr [8.8.8.8]`
          );
          expect(downBuckets(read)).toBe(0);
        }
      );

      it.skipIf(skipTests)(
        "reads one failing host in the first rows ever as degraded",
        async () => {
          const cycles = rounds(10, (i) =>
            roundAt(at(20 + i), offsets, failingFirst)
          );
          const table = await seed(`b1_first_${name}`, rowsOf(cycles));

          const read = await readAll(table, hourWindow);

          expect(lines(read)).toBe(`600..${900 + last / 1000} degr [8.8.8.8]`);
          expect(downBuckets(read)).toBe(0);
        }
      );

      it.skipIf(skipTests)("reads the restart edge as degraded", async () => {
        const cycles = [...upRounds, roundAt(at(50), offsets, failingFirst)];
        const table = await seed(`b1_edge_${name}`, rowsOf(cycles));
        const nowMs = at(50) + last + 1000;

        const read = await readAll(
          table,
          atEdge({ startMs: T0, endMs: nowMs })
        );

        expect(lines(read)).toBe(
          `1500..${1500 + (last + 1000) / 1000} degr [8.8.8.8]`
        );
        expect(downBuckets(read)).toBe(0);
        expect(read.live.status).toBe("degraded");
      });
    });

    it.skipIf(skipTests)(
      "splits two all-down stretches around a 10-minute gap and measures uptime over observed time",
      async () => {
        const status = (i: number): FixtureStatus =>
          (i >= 0 && i < 5) || (i >= 30 && i < 35) ? "down" : "up";
        const cycles = [
          ...rounds(10, (i) => fullCycle(at(i), status(i))),
          ...rounds(10, (i) => fullCycle(at(30 + i), status(30 + i))),
        ];
        const table = await seed("two_stretches", startStampedRows(cycles, 0));

        const read = await readAll(table, {
          startMs: T0,
          endMs: T0 + 1800 * S,
        });

        expect(lines(read)).toBe(
          "0..150 down [1.1.1.1,8.8.8.8,cloudflare.com] | 900..1050 down [1.1.1.1,8.8.8.8,cloudflare.com]"
        );
        expect(read.ribbon.meta.observedSeconds).toBe(600);
        expect(read.ribbon.meta.uptimePercentage).toBe(50);
      }
    );

    it.skipIf(skipTests)(
      "bridges one missed round and splits at two",
      async () => {
        const downRounds = (skip: readonly number[]) =>
          startStampedRows(
            rounds(11, (i) => fullCycle(at(20 + i), "down")).filter(
              (_, i) => !skip.includes(20 + i)
            ),
            0
          );

        const one = await seed("missed_one", downRounds([25]));
        const two = await seed("missed_two", downRounds([25, 26]));
        const window = { startMs: T0, endMs: at(40) };

        expect(lines(await readAll(one, window))).toBe(
          "600..930 down [1.1.1.1,8.8.8.8,cloudflare.com]"
        );
        expect(lines(await readAll(two, window))).toBe(
          "600..750 down [1.1.1.1,8.8.8.8,cloudflare.com] | 810..930 down [1.1.1.1,8.8.8.8,cloudflare.com]"
        );
      }
    );
  });

  describe("the floor", () => {
    it.skipIf(skipTests)(
      "absorbs a legacy mixed sliver instead of reading it as extra down time",
      async () => {
        const cycles = [
          ...rounds(20, (i) => roundAt(at(i), [0, 3, 8])),
          roundAt(at(20), [0, 3, 8], () => "down"),
          ...rounds(20, (i) => roundAt(at(21 + i), [0, 3, 8])),
        ];
        const table = await seed("floor_sliver", legacyRows(cycles));

        const read = await readAll(table, hourWindow);

        expect(lines(read)).toBe(
          "600.008..630.008 down [1.1.1.1,8.8.8.8,cloudflare.com]"
        );
        expect(downBuckets(read)).toBe(1);
      }
    );

    it.skipIf(skipTests)(
      "keeps a degraded state that lasts one round",
      async () => {
        const cycles = rounds(40, (i) =>
          roundAt(at(i), [0, 0, 0], (position) =>
            i === 20 && position === 0 ? "degraded" : "up"
          )
        );
        const table = await seed(
          "floor_one_round",
          startStampedRows(cycles, 0)
        );

        const read = await readAll(table, hourWindow);

        expect(lines(read)).toBe("600..630 degr [8.8.8.8]");
      }
    );

    it.skipIf(skipTests)(
      "drops a manual ping's 10 s state and keeps its 20 s and 15 s ones, the floor being half a spacing",
      async () => {
        const rows: NetworkMetric[] = [];
        for (let i = 0; i < 20; i++) {
          for (const host of HOSTS) {
            rows.push(singleRow(at(i), host));
          }
        }
        rows.push(singleRow(at(5) + 10 * S, "8.8.8.8", "down"));
        rows.push(singleRow(at(8) + 15 * S, "8.8.8.8", "down"));
        rows.push(singleRow(at(12) + 20 * S, "8.8.8.8", "down"));
        const table = await seed("floor_manual", rows);

        const read = await readAll(table, { startMs: T0, endMs: at(20) });

        expect(lines(read)).toBe(
          "160..180 degr [8.8.8.8] | 255..270 degr [8.8.8.8]"
        );
      }
    );
  });

  describe("a run of only short states", () => {
    it.skipIf(skipTests)(
      "reads a segment whose every stretch is below the floor as the state of its longest",
      async () => {
        // The stray host's up ping stands 5 s before its down ping lands. Each
        // stretch is shorter than half the larger spacing, so none lasts, and
        // the whole segment takes the longest stretch's state, down.
        const rows = [
          singleRow(T0, "1.1.1.1", "degraded"),
          singleRow(T0 + 105 * S, "1.1.1.1", "up"),
          singleRow(T0 + 110 * S, "1.1.1.1", "down"),
        ];
        const table = await seed("short_states", rows);

        const read = await readAll(
          table,
          { startMs: T0, endMs: T0 + 300 * S },
          { hosts: [] }
        );

        expect(
          read.ribbon.data.map((point) => [
            (Date.parse(point.timestamp) - T0) / S,
            point.status,
          ])
        ).toEqual([
          [0, "degraded"],
          [60, "down"],
          [120, "down"],
        ]);
        // No ping stood long enough to qualify as a host of the second run,
        // but the log still lists it, as the ribbon shows its down time.
        expect(lines(read)).toBe("0..30 degr [1.1.1.1] | 105..125 down []");
        expect(read.outages.data[0]).toMatchObject({
          status: "down",
          affectedHosts: [],
          maxPacketLoss: 0,
          peakLatency: null,
        });
      }
    );
  });

  describe("right edge", () => {
    it.skipIf(skipTests)(
      "holds a lone failing host as degraded while the other hosts' rows land",
      async () => {
        const rows = [
          ...legacyRows(rounds(20, (i) => roundAt(at(i), [0, 0, 0]))),
          singleRow(at(20), "8.8.8.8", "down"),
        ];
        const table = await seed("edge_partial", rows);

        const soon = await readAll(
          table,
          atEdge({ startMs: T0, endMs: at(20) + 3 * S })
        );
        expect(lines(soon)).toBe("600..603 degr [8.8.8.8]");
        expect(soon.live.status).toBe("degraded");
        expect(soon.ribbon.data.at(-1)).toMatchObject({ status: "degraded" });

        const later = await readAll(
          table,
          atEdge({ startMs: T0, endMs: at(20) + 20 * S })
        );
        expect(lines(later)).toBe("600..620 degr [8.8.8.8]");
        expect(later.live.status).toBe("degraded");

        const silent = await readAll(
          table,
          atEdge({ startMs: T0, endMs: at(20) + 120 * S })
        );
        expect(lines(silent)).toBe("600..630 down [8.8.8.8]");
        expect(silent.live.status).toBe("noInfo");
      }
    );

    it.skipIf(skipTests)(
      "reads an all-down onset as degraded, then down, as the round lands",
      async () => {
        const rows = legacyRows([
          ...rounds(20, (i) => roundAt(at(i), [0, 0, 0])),
          roundAt(at(20), [0, 2000, 8000], () => "down"),
        ]);
        const table = await seed("edge_onset", rows);
        const reading = async (afterMs: number) =>
          readAll(table, atEdge({ startMs: T0, endMs: at(20) + afterMs }));

        const first = await reading(1000);
        const second = await reading(3000);
        const third = await reading(9000);

        expect(first.live.status).toBe("degraded");
        expect(lines(first)).toBe("600..601 degr [8.8.8.8]");
        expect(second.live.status).toBe("degraded");
        expect(lines(second)).toBe("600..603 degr [8.8.8.8]");
        expect(third.live.status).toBe("down");
        expect(lines(third)).toBe(
          "608..609 down [1.1.1.1,8.8.8.8,cloudflare.com]"
        );
      }
    );

    it.skipIf(skipTests)("reads a recovery as up at once", async () => {
      const rows = legacyRows([
        ...rounds(20, (i) => roundAt(at(i), [0, 0, 0])),
        roundAt(at(20), [0, 2000, 8000], () => "down"),
        roundAt(at(21), [0, 0, 0]),
      ]);
      const table = await seed("edge_recover", rows);

      for (const afterMs of [1000, 10_000, 40_000]) {
        const read = await readAll(
          table,
          atEdge({ startMs: T0, endMs: at(21) + afterMs })
        );
        expect(read.live.status).toBe("up");
        expect(lines(read)).toBe(
          "608..630 down [1.1.1.1,8.8.8.8,cloudflare.com]"
        );
      }
    });
  });

  describe("spacing", () => {
    it.skipIf(skipTests)(
      "follows each host's own spacing when one host reports every 90 s",
      async () => {
        const rows: NetworkMetric[] = [];
        for (let i = 0; i < 120; i++) {
          rows.push(singleRow(at(i), "8.8.8.8"));
          rows.push(singleRow(at(i), "1.1.1.1"));
          if (i % 3 === 0) {
            rows.push(singleRow(at(i), "cloudflare.com", "down"));
          }
        }
        const table = await seed("spacing_90s", rows);

        const read = await readAll(table, hourWindow);

        expect(lines(read)).toBe(
          "0..30 degr [cloudflare.com] | 90..3570 degr [cloudflare.com]"
        );
        expect(read.ribbon.meta.observedSeconds).toBe(3600);
      }
    );

    it.skipIf(skipTests)(
      "reads a spacing change by the configured interval, the same for any window",
      async () => {
        const rows = [
          ...legacyRows(rounds(240, (i) => roundAt(at(i), [0, 0, 0]))),
          ...legacyRows(
            rounds(30, (j) =>
              roundAt(T0 + 7200 * S + j * 120 * S, [0, 0, 0], () => "down")
            )
          ),
        ];
        const table = await seed("spacing_change", rows);
        const threeHours = { startMs: T0, endMs: T0 + 10_800 * S };
        const lastHour = { startMs: T0 + 7200 * S, endMs: T0 + 10_800 * S };

        const slow = { intervalMs: 120 * S };
        const slowAll = await readAll(table, threeHours, slow);
        const slowHour = await readAll(table, lastHour, slow);
        expect(lines(slowAll)).toBe(
          "7200..10800 down [1.1.1.1,8.8.8.8,cloudflare.com]"
        );
        expect(lines(slowHour)).toBe(lines(slowAll));

        const fastAll = await readAll(table, threeHours);
        const fastHour = await readAll(table, lastHour);
        expect(lines(fastAll)).toBe(
          "7200..7230 down [1.1.1.1,8.8.8.8,cloudflare.com] | 7320..7350 down [1.1.1.1,8.8.8.8,cloudflare.com] | 7440..10740 down [1.1.1.1,8.8.8.8,cloudflare.com]"
        );
        expect(lines(fastHour)).toBe(lines(fastAll));
      },
      60_000
    );

    it.skipIf(skipTests)(
      "keeps two manual pings a few seconds apart from shrinking the spacing",
      async () => {
        const rows = rounds(30, (i) => roundAt(at(i), [0, 0, 0])).map((round) =>
          singleRow(round.startMs, "8.8.8.8")
        );
        for (const offset of [
          10 * INTERVAL_MS + 5 * S,
          10 * INTERVAL_MS + 8 * S,
          20 * INTERVAL_MS + 4 * S,
          20 * INTERVAL_MS + 7 * S,
        ]) {
          rows.push(singleRow(T0 + offset, "8.8.8.8"));
        }
        const table = await seed("clamp_manual", rows);

        const read = await readAll(
          table,
          { startMs: T0, endMs: T0 + 900 * S },
          { hosts: ["8.8.8.8"] }
        );

        expect(read.outages.data).toEqual([]);
        expect(read.ribbon.meta.observedSeconds).toBe(900);
        expect(read.ribbon.meta.uptimePercentage).toBe(100);
      }
    );

    it.skipIf(skipTests)(
      "takes the median of three gaps as the spacing, so one 90 s gap among 30 s gaps does not widen it",
      async () => {
        const secondsOf = (rows: readonly number[]) =>
          rows.map((second) => singleRow(T0 + second * S, "8.8.8.8"));
        const rows = secondsOf([
          ...Array.from({ length: 11 }, (_, i) => i * 30),
          ...Array.from({ length: 11 }, (_, i) => 390 + i * 30),
        ]);
        const table = await seed("spacing_median", rows);

        const read = await readAll(
          table,
          { startMs: T0, endMs: T0 + 900 * S },
          { hosts: ["8.8.8.8"] }
        );

        expect(read.outages.data).toEqual([]);
        expect(read.ribbon.meta.observedSeconds).toBe(660);
        expect(read.ribbon.meta.uptimePercentage).toBe(100);
      }
    );

    it.skipIf(skipTests)(
      "reads 15-minute rows as one outage at a 15-minute interval, and four at the default",
      async () => {
        const rows: NetworkMetric[] = [];
        for (let i = 0; i < 96; i++) {
          HOSTS.slice(0, 2).forEach((host, k) => {
            rows.push(
              singleRow(
                T0 + i * 900 * S - k * 4000,
                host,
                i >= 30 && i < 34 ? "down" : "up"
              )
            );
          });
        }
        const table = await seed("spacing_15m", rows);
        const window = {
          startMs: T0,
          endMs: T0 + 96 * 900 * S,
          granularity: "1h" as const,
        };
        const pair = { hosts: HOSTS.slice(0, 2) };

        const matched = await readAll(table, window, {
          ...pair,
          intervalMs: 900 * S,
        });
        const capped = await readAll(table, window, pair);

        expect(lines(matched)).toBe("27000..30600 down [1.1.1.1,8.8.8.8]");
        expect(lines(capped)).toBe(
          "26996..27060 down [1.1.1.1,8.8.8.8] | 27896..27960 down [1.1.1.1,8.8.8.8] | 28796..28860 down [1.1.1.1,8.8.8.8] | 29696..29760 down [1.1.1.1,8.8.8.8]"
        );
      }
    );
  });

  describe("unconfigured and alias hosts", () => {
    it.skipIf(skipTests)(
      "reads a one-round all-down outage when success rows carry a resolved name",
      async () => {
        const rows: NetworkMetric[] = [];
        for (let i = 0; i < 40; i++) {
          const down = i === 20;
          const status = down ? "down" : "up";
          rows.push(singleRow(at(i), "8.8.8.8", status));
          rows.push(singleRow(at(i), "1.1.1.1", status));
          rows.push(
            singleRow(
              at(i),
              down ? "www.example.com" : "edge.cdn.example.net",
              status
            )
          );
        }
        const table = await seed("alias_resolved", rows);
        const hosts = ["8.8.8.8", "1.1.1.1", "www.example.com"];

        const read = await readAll(
          table,
          { startMs: T0, endMs: at(40) },
          { hosts }
        );
        const mid = await readAll(
          table,
          atEdge({ startMs: T0, endMs: at(20) + 20 * S }),
          { hosts }
        );

        expect(lines(read)).toBe(
          "600..630 down [1.1.1.1,8.8.8.8,www.example.com]"
        );
        expect(downBuckets(read)).toBe(1);
        expect(mid.live.status).toBe("down");
      }
    );

    it.skipIf(skipTests)(
      "reads manual pings by their own host and lets a stray name read for one interval",
      async () => {
        const rows = rounds(20, (i) => roundAt(at(i), [0, 0, 0])).flatMap(
          (round) => HOSTS.map((host) => singleRow(round.startMs, host))
        );
        rows.push(singleRow(at(5) + 10 * S, "8.8.8.8", "down"));
        rows.push(singleRow(at(12) + 20 * S, "8.8.8.8", "down"));
        rows.push(singleRow(at(15) + 5 * S, "example.org", "down"));
        const table = await seed("manual", rows);

        const read = await readAll(table, { startMs: T0, endMs: at(20) });
        const after10 = await readAll(
          table,
          atEdge({ startMs: T0, endMs: at(15) + 15 * S })
        );
        const after40 = await readAll(
          table,
          atEdge({ startMs: T0, endMs: at(15) + 45 * S })
        );

        expect(lines(read)).toBe(
          "160..180 degr [8.8.8.8] | 455..485 degr [example.org]"
        );
        expect(after10.live.status).toBe("degraded");
        expect(after40.live.status).toBe("up");
      }
    );

    it.skipIf(skipTests)(
      "reads a duplicated host the same as a single host",
      async () => {
        const shared: NetworkMetric[] = [];
        const single: NetworkMetric[] = [];
        for (let i = 0; i < 100; i++) {
          for (const host of HOSTS) {
            shared.push(singleRow(at(i), host));
          }
          shared.push(singleRow(at(i), "8.8.8.8"));
          // The duplicate's 3 ms gap must not read as the host's spacing, and
          // the missing round 50 is bridged only if the spacing stays 30 s.
          if (i !== 50) {
            single.push(singleRow(at(i), "8.8.8.8"));
            single.push(singleRow(at(i) + 3, "8.8.8.8"));
          }
        }
        const sharedTable = await seed("dup_shared", shared);
        const singleTable = await seed("dup_one", single);
        const window = {
          startMs: T0,
          endMs: T0 + 3000 * S,
          granularity: "5m" as const,
        };

        const many = await readAll(sharedTable, window);
        const one = await readAll(singleTable, window, { hosts: ["8.8.8.8"] });

        expect(many.ribbon.meta.observedSeconds).toBe(3000);
        expect(many.ribbon.meta.uptimePercentage).toBe(100);
        expect(one.ribbon.meta.observedSeconds).toBe(3000);
        expect(one.ribbon.meta.uptimePercentage).toBe(100);
      }
    );
  });

  describe("range edges", () => {
    const allDownAt = (offsetsMs: readonly number[]): NetworkMetric[] =>
      offsetsMs.flatMap((offset) =>
        HOSTS.map((host) => singleRow(T0 + offset, host, "down"))
      );

    it.skipIf(skipTests)(
      "counts a down row before the window that holds into it, clipped at the start",
      async () => {
        const rows = [
          ...allDownAt([-10 * S]),
          ...HOSTS.map((host) => singleRow(T0 + 20 * S, host)),
        ];
        const table = await seed("range_before", rows);

        const read = await readAll(table, { startMs: T0, endMs: T0 + 300 * S });

        expect(lines(read)).toBe("0..20 down [1.1.1.1,8.8.8.8,cloudflare.com]");
      }
    );

    it.skipIf(skipTests)(
      "clips an outage at an endTime in the middle of a hold",
      async () => {
        const rows = [
          ...HOSTS.map((host) => singleRow(T0, host)),
          ...allDownAt([100 * S]),
          ...HOSTS.map((host) => singleRow(T0 + 130 * S, host)),
        ];
        const table = await seed("range_mid_hold", rows);

        const read = await readAll(table, { startMs: T0, endMs: T0 + 110 * S });

        expect(lines(read)).toBe(
          "100..110 down [1.1.1.1,8.8.8.8,cloudflare.com]"
        );
      }
    );

    it.skipIf(skipTests)(
      "reads a window inside one outage as that whole window",
      async () => {
        const rows = allDownAt(
          Array.from({ length: 41 }, (_, i) => (i - 20) * INTERVAL_MS)
        );
        const table = await seed("range_inside", rows);

        const read = await readAll(table, { startMs: T0, endMs: T0 + 300 * S });

        expect(lines(read)).toBe(
          "0..300 down [1.1.1.1,8.8.8.8,cloudflare.com]"
        );
        expect(read.ribbon.meta.uptimePercentage).toBe(0);
      }
    );

    it.skipIf(skipTests)(
      "observes nothing past now and counts coverage to now when the window ends later",
      async () => {
        const rows = rounds(11, (i) => roundAt(at(i), [0, 0, 0])).flatMap(
          (round) => HOSTS.map((host) => singleRow(round.startMs, host))
        );
        const table = await seed("range_future_end", rows);

        const read = await readAll(table, {
          startMs: T0,
          endMs: T0 + 3600 * S,
          nowMs: T0 + 310 * S,
          granularity: "5m",
        });

        expect(read.ribbon.meta.observedSeconds).toBe(310);
        expect(read.ribbon.meta.coveragePercentage).toBe(100);
        expect(read.ribbon.meta.uptimePercentage).toBe(100);
      }
    );

    it.skipIf(skipTests)(
      "reads coverage below 100% when an interior bucket is empty and the last one is partial",
      async () => {
        const rows = [
          ...Array.from({ length: 10 }, (_, i) => singleRow(at(i), "8.8.8.8")),
          ...Array.from({ length: 4 }, (_, i) =>
            singleRow(T0 + (600 + i * 30) * S, "8.8.8.8")
          ),
        ];
        const table = await seed("range_gap_coverage", rows);

        const read = await readAll(
          table,
          { startMs: T0, endMs: T0 + 12 * 60 * S, granularity: "5m" },
          { hosts: ["8.8.8.8"] }
        );

        expect(read.ribbon.meta.expectedBuckets).toBe(3);
        expect(read.ribbon.meta.observedBuckets).toBe(2);
        expect(read.ribbon.meta.coveragePercentage).toBeCloseTo(
          (2 / 3) * 100,
          6
        );
      }
    );

    it.skipIf(skipTests)(
      "reads a window that starts after now as empty",
      async () => {
        const rows = HOSTS.map((host) => singleRow(T0, host));
        const table = await seed("range_future_start", rows);

        const read = await readAll(table, {
          startMs: T0 + 7200 * S,
          endMs: T0 + 10_800 * S,
          nowMs: T0 + 3600 * S,
          granularity: "5m",
        });

        expect(read.outages.data).toEqual([]);
        expect(read.ribbon.data).toEqual([]);
        expect(read.ribbon.meta.uptimePercentage).toBeNull();
        expect(read.ribbon.meta.observedSeconds).toBe(0);
      }
    );

    it.skipIf(skipTests)(
      "leaves speed test rows out of the state",
      async () => {
        const rows = [
          ...HOSTS.map((host) => singleRow(T0, host)),
          speedtestRow(T0 + 10 * S),
        ];
        const table = await seed("range_speedtest", rows);

        const read = await readAll(table, { startMs: T0, endMs: T0 + 60 * S });

        expect(read.ribbon.meta.observedSeconds).toBe(30);
      }
    );
  });

  describe("live", () => {
    it.skipIf(skipTests)("reads the stretch that reaches now", async () => {
      const rows = rounds(10, (i) => roundAt(at(i), [0, 0, 0])).flatMap(
        (round) => HOSTS.map((host) => singleRow(round.startMs, host))
      );
      const table = await seed("live_up", rows);

      const read = await readAll(
        table,
        atEdge({ startMs: T0, endMs: at(9) + 10 * S })
      );

      expect(read.live.status).toBe("up");
      expect(Date.parse(read.live.lastSampleAt ?? "")).toBe(at(9));
    });

    it.skipIf(skipTests)(
      "reads no data once every row has lapsed, with the newest ping ever",
      async () => {
        const rows = rounds(10, (i) => roundAt(at(i), [0, 0, 0])).flatMap(
          (round) => HOSTS.map((host) => singleRow(round.startMs, host))
        );
        const table = await seed("live_stale", rows);

        const read = await readAll(
          table,
          atEdge({ startMs: T0, endMs: at(9) + 600 * S })
        );

        expect(read.live.status).toBe("noInfo");
        expect(Date.parse(read.live.lastSampleAt ?? "")).toBe(at(9));
      }
    );

    it.skipIf(skipTests).each([
      [30, 75],
      [10, 60],
      [300, 750],
    ])(
      "sizes its window from a %i s interval as %i s",
      async (intervalSeconds, windowSeconds) => {
        const table = await seed(
          `live_window_${intervalSeconds}`,
          HOSTS.map((host) => singleRow(T0, host))
        );

        const read = await readAll(
          table,
          { startMs: T0, endMs: T0 + 5 * S },
          { intervalMs: intervalSeconds * S }
        );

        expect(read.live.windowSeconds).toBe(windowSeconds);
      }
    );
  });

  describe("ribbon", () => {
    const mixedHours = (): NetworkMetric[] => {
      const cycles = rounds(720, (i) =>
        roundAt(at(i), [0, 3, 8], (position): FixtureStatus => {
          if (i >= 40 && i < 50) {
            return position === 0 ? "degraded" : "up";
          }
          if (i >= 100 && i < 104) {
            return "down";
          }
          if (i >= 300 && i < 330) {
            return position === 1 ? "down" : "up";
          }
          return "up";
        })
      ).filter((_, i) => i !== 200 && !(i >= 500 && i < 520));
      return legacyRows(cycles);
    };

    /** Every bucket and the window's totals equal the reference's. */
    const expectRibbonToMatchReference = (
      read: Read,
      rows: readonly NetworkMetric[],
      window: Window,
      config: CaseConfig = {}
    ): void => {
      const granularity = window.granularity ?? "1m";
      const expected = bucketsOf(
        rows,
        referenceParams(window, config),
        granularity,
        DEGRADED_BUCKET_MIN_SHARE
      );
      expect(
        read.ribbon.data.map((point) => Date.parse(point.timestamp))
      ).toEqual(expected.map((bucket) => bucket.bucketMs));
      expect(read.ribbon.data.map((point) => point.status)).toEqual(
        expected.map((bucket) => bucket.status)
      );
      read.ribbon.data.forEach((point, index) => {
        const bucket = expected[index];
        const observed =
          (bucket?.upMs ?? 0) +
          (bucket?.degradedMs ?? 0) +
          (bucket?.downMs ?? 0);
        expect(point.upPercentage).toBeCloseTo(
          ((bucket?.upMs ?? 0) / observed) * 100,
          6
        );
        expect(point.degradedPercentage).toBeCloseTo(
          ((bucket?.degradedMs ?? 0) / observed) * 100,
          6
        );
        expect(point.downPercentage).toBeCloseTo(
          ((bucket?.downMs ?? 0) / observed) * 100,
          6
        );
      });

      const totals = referenceOf(rows, referenceParams(window, config));
      expect(read.ribbon.meta.observedSeconds).toBeCloseTo(
        totals.observedMs / S,
        6
      );
      expect(read.ribbon.meta.uptimePercentage).toBeCloseTo(
        (totals.upMs / totals.observedMs) * 100,
        6
      );
    };

    it.skipIf(skipTests).each(["1m", "1h", "6h", "1d"] as const)(
      "matches the reference in every %s bucket, including a bridged hold across a minute edge",
      async (granularity) => {
        const rows = mixedHours();
        const table = await seed(`ribbon_truth_${granularity}`, rows);
        const window = { startMs: T0, endMs: T0 + 6 * 3600 * S, granularity };

        expectRibbonToMatchReference(
          await readAll(table, window),
          rows,
          window
        );
      },
      60_000
    );

    it.skipIf(skipTests).each(["6h", "1d"] as const)(
      "reads a three-day outage at a 15-minute interval as 100% down in every %s bucket it spans",
      async (granularity) => {
        const stepMs = 900 * S;
        const downFrom = 30 * 3600 * S;
        const downTo = 102 * 3600 * S;
        const rows = startStampedRows(
          rounds(5 * 96, (i) =>
            roundAt(T0 + i * stepMs, [0, 0, 0], () =>
              T0 + i * stepMs >= T0 + downFrom && T0 + i * stepMs < T0 + downTo
                ? "down"
                : "up"
            )
          ),
          0
        );
        const table = await seed(`ribbon_multiday_${granularity}`, rows);
        const window = {
          startMs: T0,
          endMs: T0 + 5 * 24 * 3600 * S,
          granularity,
        };
        const config = { intervalMs: stepMs };

        const read = await readAll(table, window, config);

        expectRibbonToMatchReference(read, rows, window, config);
        const width = granularity === "6h" ? 6 * 3600 * S : 24 * 3600 * S;
        const inside = read.ribbon.data.filter((point) => {
          const startMs = Date.parse(point.timestamp);
          return startMs >= T0 + downFrom && startMs + width <= T0 + downTo;
        });
        expect(inside.length).toBeGreaterThan(0);
        for (const point of inside) {
          expect(point.status).toBe("down");
          expect(point.downPercentage).toBeCloseTo(100, 6);
        }
        expect(lines(read)).toBe(
          `${downFrom / S}..${downTo / S} down [1.1.1.1,8.8.8.8,cloudflare.com]`
        );
      },
      60_000
    );

    it.skipIf(skipTests)(
      "splits a bucket at a window that starts and ends inside buckets",
      async () => {
        const cycles = rounds(60, (i) =>
          roundAt(at(i), [0, 1, 2], (position) =>
            i >= 8 && i < 13 && position === 0 ? "degraded" : "up"
          )
        );
        const rows = startStampedRows(cycles, 1);
        const table = await seed("ribbon_partial_edges", rows);
        const window = {
          startMs: T0 + 150 * S,
          endMs: T0 + 920 * S,
          granularity: "5m" as const,
        };

        const read = await readAll(table, window);

        expectRibbonToMatchReference(read, rows, window);
        expect(read.ribbon.data).toHaveLength(4);
        expect(read.ribbon.meta.observedSeconds).toBe(770);
      }
    );
  });

  describe("hosts that change", () => {
    const NEW_HOSTS = ["9.9.9.9", "203.0.113.5", "example.net"] as const;
    const hostRows = (
      hosts: readonly string[],
      from: number,
      to: number,
      statusOf: (round: number, host: string) => FixtureStatus = () => "up"
    ): NetworkMetric[] =>
      Array.from({ length: to - from }, (_, i) =>
        hosts.map((host) =>
          singleRow(at(from + i), host, statusOf(from + i, host))
        )
      ).flat();

    it.skipIf(skipTests).each([
      ["up", "up", ""],
      ["down", "down", "570..600 down [1.1.1.1,8.8.8.8,cloudflare.com]"],
    ] as const)(
      "reads PING_HOSTS replaced mid-range as one continuous record when the old hosts' last rows were %s",
      async (_label, lastStatus, outage) => {
        const rows = [
          ...hostRows(HOSTS, 0, 20, (round) =>
            round === 19 ? lastStatus : "up"
          ),
          ...hostRows(NEW_HOSTS, 20, 40),
        ];
        const table = await seed(`hosts_replaced_${lastStatus}`, rows);

        const read = await readAll(
          table,
          { startMs: T0, endMs: at(40) },
          { hosts: NEW_HOSTS }
        );

        expect(lines(read)).toBe(outage);
        expect(read.ribbon.meta.observedSeconds).toBe(1200);
      }
    );

    it.skipIf(skipTests).each([
      ["up", ""],
      ["down", "600..1200 degr [cloudflare.com]"],
    ] as const)(
      "reads a third host that starts mid-range, reporting %s, from its first row",
      async (status, outage) => {
        const rows = [
          ...hostRows(HOSTS.slice(0, 2), 0, 40),
          ...hostRows(HOSTS.slice(2), 20, 40, () => status),
        ];
        const table = await seed(`host_added_${status}`, rows);

        const read = await readAll(table, { startMs: T0, endMs: at(40) });

        expect(lines(read)).toBe(outage);
        expect(read.ribbon.meta.observedSeconds).toBe(1200);
      }
    );

    it.skipIf(skipTests)(
      "shrinks the quorum when a host stops reporting, instead of reading down",
      async () => {
        const rows = [
          ...hostRows(HOSTS.slice(0, 2), 0, 40),
          ...hostRows(HOSTS.slice(2), 0, 20),
        ];
        const table = await seed("host_stops", rows);

        const read = await readAll(table, { startMs: T0, endMs: at(40) });

        expect(read.outages.data).toEqual([]);
        expect(read.ribbon.meta.observedSeconds).toBe(1200);
        expect(read.ribbon.meta.uptimePercentage).toBe(100);
      }
    );
  });

  describe("the same outages from any window start", () => {
    /** The narrow window's outages and 1 m buckets, against the same span read through a wider window. */
    const expectInvariant = async (
      table: string,
      narrow: Window,
      wide: Window,
      config: CaseConfig
    ) => {
      const [a, b] = [narrow.startMs, narrow.endMs];
      const near = await readAll(
        table,
        { ...narrow, nowMs: b + 10 * 3600 * S },
        config
      );
      const far = await readAll(
        table,
        { ...wide, nowMs: b + 10 * 3600 * S },
        config
      );

      const clip = (o: {
        start: string;
        end: string;
        status: string;
        affectedHosts: readonly string[];
      }) =>
        JSON.stringify([
          Math.max(Date.parse(o.start), a),
          Math.min(Date.parse(o.end), b),
          o.status,
          o.affectedHosts,
        ]);
      expect(near.outages.data.map(clip)).toEqual(
        far.outages.data
          .filter((o) => Date.parse(o.end) > a && Date.parse(o.start) < b)
          .map(clip)
      );
      const farBuckets = new Map(far.ribbon.data.map((p) => [p.timestamp, p]));
      for (const point of near.ribbon.data) {
        expect(farBuckets.get(point.timestamp)).toEqual(point);
      }
    };

    it.skipIf(skipTests).each([30, 900] as const)(
      "reads windows on the skewed history the same whichever side data is cut, at a %i s interval",
      async (intervalSeconds) => {
        const table = await seed(`invariant_${intervalSeconds}`, skewedRows());
        const config = { intervalMs: intervalSeconds * S };

        for (const [from, to] of [
          [300, 1500],
          [900, 3000],
          [1980, 3600],
        ] as const) {
          await expectInvariant(
            table,
            { startMs: T0 + from * S, endMs: T0 + to * S },
            { startMs: T0 + (from - 1200) * S, endMs: T0 + (to + 1200) * S },
            config
          );
        }
      },
      60_000
    );
  });

  describe("an empty table", () => {
    it.skipIf(skipTests)(
      "reads as no data through every query, not as an outage or an error",
      async () => {
        const table = await seed("empty", []);
        const window = { startMs: T0, endMs: T0 + 3600 * S };

        const read = await readAll(table, window);
        const summary = await summaryOf(table, window);

        expect(read.outages.data).toEqual([]);
        expect(read.ribbon.data).toEqual([]);
        expect(read.ribbon.meta.uptimePercentage).toBeNull();
        expect(read.ribbon.meta.observedSeconds).toBe(0);
        expect(read.live.status).toBe("noInfo");
        expect(read.live.lastSampleAt).toBeNull();
        expect(summary.windows).toEqual({
          last24h: { uptimePercentage: null },
          last7d: { uptimePercentage: null },
          last30d: { uptimePercentage: null },
        });
        expect(summary.range.latencyP50).toBeNull();
      }
    );
  });

  describe("duplicate rows", () => {
    it.skipIf(skipTests)(
      "reads two rows of one host at one instant as the one that was written last",
      async () => {
        const rows: NetworkMetric[] = [];
        for (let i = 0; i < 100; i++) {
          if (i === 10) {
            rows.push(singleRow(at(i), "8.8.8.8", "up"));
            rows.push(singleRow(at(i), "8.8.8.8", "down"));
          } else {
            rows.push(singleRow(at(i), "8.8.8.8"));
          }
        }
        const table = await seed("dup_status", rows);

        const read = await readAll(
          table,
          { startMs: T0, endMs: T0 + 3000 * S },
          { hosts: ["8.8.8.8"] }
        );

        expect(lines(read)).toBe("300..330 down [8.8.8.8]");
        expect(read.ribbon.meta.observedSeconds).toBe(3000);
      }
    );
  });

  describe("the writer", () => {
    const delaysMs: Record<string, number> = {
      "8.8.8.8": 80,
      "www.example.com": 250,
    };

    /** Runs the real executor against a real table, with pings that take `delaysMs` and end as `ping` decides. */
    const writeRound = async (
      name: string,
      end: (host: string) => Effect.Effect<PingResult, PingError>
    ) => {
      const table = `${TEST_TABLE}_tm_${name}`;
      tables.push(table);
      const pingService = Layer.succeed(PingService, {
        ping: (host) =>
          Effect.sleep(delaysMs[host] ?? 0).pipe(Effect.andThen(end(host))),
        pingWithConfig: () => Effect.die("unused"),
        isReachable: () => Effect.succeed(true),
      });
      const writer = Layer.provideMerge(
        PingExecutorLive,
        Layer.mergeAll(
          createTestLayer(table),
          makeTestConfigLayer({
            ping: { hosts: ["8.8.8.8", "www.example.com"] },
          }),
          pingService
        )
      );

      const before = await Effect.runPromise(
        Effect.gen(function* () {
          yield* untilConnected;
          const executor = yield* PingExecutor;
          const startedAt = Date.now();
          yield* executor.executeAll();
          return startedAt;
        }).pipe(Effect.provide(writer))
      );
      await Effect.runPromise(waitForRowCount(2, "30 seconds", table));
      const rows = await queryQuestDB(
        `SELECT host, timestamp, duration_ms, connectivity_status FROM ${table} ORDER BY host`
      );
      return { before, rows };
    };

    const expectStartStampsAndDurations = (
      before: number,
      rows: readonly (readonly unknown[])[]
    ) => {
      expect(rows.map((row) => row[0])).toEqual(["8.8.8.8", "www.example.com"]);
      for (const [row, delayMs] of [
        [rows[0], 80],
        [rows[1], 250],
      ] as const) {
        const stampMs = Date.parse(`${String(row?.[1])}`);
        expect(stampMs - before).toBeGreaterThanOrEqual(-5);
        expect(stampMs - before).toBeLessThan(delayMs);
        // A timer can fire a millisecond early against `Date.now()`.
        expect(Number(row?.[2])).toBeGreaterThanOrEqual(delayMs - 2);
        expect(Number(row?.[2])).toBeLessThan(delayMs + 400);
      }
    };

    it.skipIf(skipTests)(
      "stamps each row at the start of its ping, records how long it ran, and keeps the requested host",
      async () => {
        const { before, rows } = await writeRound("writer", (host) =>
          Effect.succeed({
            host: host === "www.example.com" ? "edge.cdn.example.net" : host,
            alive: true,
            latency: 10,
            packetLoss: 0,
          })
        );

        expectStartStampsAndDurations(before, rows);
        expect(rows.map((row) => row[3])).toEqual(["up", "up"]);
      },
      30_000
    );

    it.skipIf(skipTests)(
      "records a failed ping the same way, as a down row of the requested host",
      async () => {
        const { before, rows } = await writeRound("writer_failed", (host) =>
          Effect.fail(
            new PingHostUnreachableError({
              host: host === "www.example.com" ? "edge.cdn.example.net" : host,
              message: "Host unreachable",
            })
          )
        );

        expectStartStampsAndDurations(before, rows);
        expect(rows.map((row) => row[3])).toEqual(["down", "down"]);
      },
      30_000
    );
  });

  describe("summary windows", () => {
    it.skipIf(skipTests)(
      "answers the 24 hour, 7 day and 30 day uptime from time, not from counts",
      async () => {
        const HOUR = 3600 * S;
        const DAY = 24 * HOUR;
        const endMs = T0 + 31 * DAY;
        const rows: NetworkMetric[] = [];
        for (let i = 0; i < 31 * 24; i++) {
          const down = i === 31 * 24 - 10;
          rows.push(singleRow(T0 + i * HOUR, "8.8.8.8", down ? "down" : "up"));
          // The down hour carries two rows, so a count of rows would weigh it
          // twice: 23 of 25 rows up in the last day is 92%, not 23 of 24 hours.
          if (down) {
            rows.push(singleRow(T0 + i * HOUR + HOUR / 2, "8.8.8.8", "down"));
          }
        }
        const table = await seed("summary_windows", rows);

        const summary = await summaryOf(
          table,
          { startMs: endMs - DAY, endMs },
          { hosts: ["8.8.8.8"], intervalMs: HOUR }
        );

        expect(summary.windows.last24h.uptimePercentage).toBeCloseTo(
          (23 / 24) * 100,
          6
        );
        expect(summary.windows.last7d.uptimePercentage).toBeCloseTo(
          (167 / 168) * 100,
          6
        );
        expect(summary.windows.last30d.uptimePercentage).toBeCloseTo(
          (719 / 720) * 100,
          6
        );
        expect(Object.keys(summary.range).sort()).toEqual([
          "avgJitter",
          "avgPacketLoss",
          "latencyP50",
          "latencyP95",
        ]);
      },
      60_000
    );
  });
});
