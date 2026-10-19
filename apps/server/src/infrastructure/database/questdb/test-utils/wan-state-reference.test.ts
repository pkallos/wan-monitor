import type { NetworkMetric } from "@shared/metrics";
import { describe, expect, it } from "vitest";
import {
  type FixtureCycle,
  type FixtureStatus,
  fullCycle,
  HOSTS,
  roundAt,
  singleRow,
  startStampedRows,
} from "@/infrastructure/database/questdb/test-utils/cycle-fixture";
import {
  bucketsOf,
  type ReferenceParams,
  type ReferenceResult,
  referenceOf,
} from "@/infrastructure/database/questdb/test-utils/wan-state-reference";

const T0 = Date.parse("2026-07-01T00:00:00Z");
const S = 1000;
const INTERVAL_MS = 30 * S;

const params = (over: Partial<ReferenceParams> = {}): ReferenceParams => ({
  startMs: T0,
  endMs: T0 + 3600 * S,
  nowMs: T0 + 7200 * S,
  intervalMs: INTERVAL_MS,
  hosts: HOSTS,
  ...over,
});

const rowsOfRounds = (cycles: readonly FixtureCycle[]): NetworkMetric[] =>
  cycles.flatMap((cycle) =>
    cycle.readings.map((item) => ({
      ...singleRow(cycle.startMs + item.offsetMs, item.host, item.status),
    }))
  );

const upRounds = (from: number, to: number): FixtureCycle[] =>
  Array.from({ length: to - from }, (_, i) =>
    roundAt(T0 + (from + i) * INTERVAL_MS, [0, 0, 0])
  );

/** The measured outputs' notation: seconds after T0, status, hosts. */
const lines = (result: ReferenceResult): string =>
  result.outages
    .map(
      (o) =>
        `${(o.startMs - T0) / S}..${(o.endMs - T0) / S} ${o.status === "down" ? "down" : "degr"} [${o.hosts}]`
    )
    .join(" | ");

describe("wan state reference", () => {
  const shapes = [
    ["start-stamped skew 1ms", [0, 1, 2], "1500..1800.002", "600..900.002"],
    ["legacy [0,3,8]ms", [0, 3, 8], "1500..1800.008", "600..900.008"],
    ["legacy +4s", [0, 3, 4005], "1500..1804.005", "600..904.005"],
  ] as const;

  describe.each(shapes)("%s", (_label, offsets, afterGap, firstEver) => {
    const failing = (index: number): FixtureStatus =>
      index === 0 ? "down" : "up";

    it("reads one failing host after a gap as degraded, never down", () => {
      const rounds = [
        ...Array.from({ length: 10 }, (_, i) =>
          roundAt(T0 + i * INTERVAL_MS, [0, 0, 0])
        ),
        ...Array.from({ length: 10 }, (_, i) =>
          roundAt(T0 + (50 + i) * INTERVAL_MS, offsets, failing)
        ),
      ];
      const result = referenceOf(rowsOfRounds(rounds), params());

      expect(lines(result)).toBe(`${afterGap} degr [8.8.8.8]`);
    });

    it("reads the first rows ever the same way", () => {
      const rounds = Array.from({ length: 10 }, (_, i) =>
        roundAt(T0 + (20 + i) * INTERVAL_MS, offsets, failing)
      );
      const result = referenceOf(rowsOfRounds(rounds), params());

      expect(lines(result)).toBe(`${firstEver} degr [8.8.8.8]`);
    });
  });

  it("holds a lone failing host as degraded while the others have not landed", () => {
    const rows = [
      ...rowsOfRounds(upRounds(0, 20)),
      singleRow(T0 + 600 * S, "8.8.8.8", "down"),
    ];

    const at = (secondsAfter: number): ReferenceResult =>
      referenceOf(
        rows,
        params({
          endMs: T0 + (600 + secondsAfter) * S,
          nowMs: T0 + (600 + secondsAfter) * S,
        })
      );

    expect(lines(at(3))).toBe("600..603 degr [8.8.8.8]");
    expect(at(3).liveState).toBe(2);
    expect(lines(at(20))).toBe("600..620 degr [8.8.8.8]");
    expect(lines(at(120))).toBe("600..630 down [8.8.8.8]");
    expect(at(120).liveState).toBe(0);
  });

  it("reads the onset and recovery of an all-down round at once", () => {
    const onset = [
      ...rowsOfRounds(upRounds(0, 20)),
      ...rowsOfRounds([
        roundAt(T0 + 20 * INTERVAL_MS, [0, 2000, 8000], () => "down"),
      ]),
    ];
    const onsetAt = (afterMs: number): ReferenceResult =>
      referenceOf(
        onset,
        params({
          endMs: T0 + 20 * INTERVAL_MS + afterMs,
          nowMs: T0 + 20 * INTERVAL_MS + afterMs,
        })
      );

    expect(onsetAt(1000).liveState).toBe(2);
    expect(onsetAt(3000).liveState).toBe(2);
    expect(onsetAt(9000).liveState).toBe(3);
    expect(lines(onsetAt(1000))).toBe("600..601 degr [8.8.8.8]");
    expect(lines(onsetAt(9000))).toBe(
      "608..609 down [1.1.1.1,8.8.8.8,cloudflare.com]"
    );

    const recovered = [...onset, ...rowsOfRounds(upRounds(21, 22))];
    const recoveredAt = referenceOf(
      recovered,
      params({
        endMs: T0 + 21 * INTERVAL_MS + 1000,
        nowMs: T0 + 21 * INTERVAL_MS + 1000,
      })
    );
    expect(recoveredAt.liveState).toBe(1);
    expect(lines(recoveredAt)).toBe(
      "608..630 down [1.1.1.1,8.8.8.8,cloudflare.com]"
    );
  });

  it("bridges one missed round for a configured host and not for another", () => {
    const rows: NetworkMetric[] = [];
    for (let i = 0; i < 40; i++) {
      for (const host of HOSTS) {
        if (host === "8.8.8.8" && i === 22) {
          continue;
        }
        const down = host === "8.8.8.8" && i >= 20 && i <= 24;
        rows.push(singleRow(T0 + i * INTERVAL_MS, host, down ? "down" : "up"));
      }
    }
    const window = { endMs: T0 + 40 * INTERVAL_MS, nowMs: T0 + 7200 * S };

    expect(lines(referenceOf(rows, params(window)))).toBe(
      "600..750 degr [8.8.8.8]"
    );
    expect(
      lines(
        referenceOf(
          rows,
          params({ ...window, hosts: ["1.1.1.1", "cloudflare.com"] })
        )
      )
    ).toBe("600..660 degr [8.8.8.8] | 690..750 degr [8.8.8.8]");
  });

  it("keeps spacing from shrinking after two manual pings a few seconds apart", () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      singleRow(T0 + i * INTERVAL_MS, "8.8.8.8")
    );
    for (const at of [
      10 * INTERVAL_MS + 5000,
      10 * INTERVAL_MS + 8000,
      20 * INTERVAL_MS + 4000,
      20 * INTERVAL_MS + 7000,
    ]) {
      rows.push(singleRow(T0 + at, "8.8.8.8"));
    }

    const result = referenceOf(
      rows,
      params({ endMs: T0 + 900 * S, hosts: ["8.8.8.8"] })
    );

    expect(result.outages).toEqual([]);
    expect(result.observedMs).toBe(900 * S);
    expect(result.upMs).toBe(900 * S);
  });

  it("reads one host every 90 s, down all hour, as two degraded outages", () => {
    const rows: NetworkMetric[] = [];
    for (let i = 0; i < 120; i++) {
      rows.push(singleRow(T0 + i * INTERVAL_MS, "8.8.8.8"));
      rows.push(singleRow(T0 + i * INTERVAL_MS, "1.1.1.1"));
      if (i % 3 === 0) {
        rows.push(singleRow(T0 + i * INTERVAL_MS, "cloudflare.com", "down"));
      }
    }

    const result = referenceOf(rows, params());

    expect(lines(result)).toBe(
      "0..30 degr [cloudflare.com] | 90..3570 degr [cloudflare.com]"
    );
    expect(result.observedMs).toBe(3600 * S);
  });

  it("reads 15-minute rows as one outage at a 15-minute interval and as four at the default", () => {
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
    const window = {
      endMs: T0 + 96 * 900 * S,
      nowMs: T0 + 2 * 86_400 * S,
      hosts: HOSTS.slice(0, 2),
    };

    expect(
      lines(referenceOf(rows, params({ ...window, intervalMs: 900 * S })))
    ).toBe("27000..30600 down [1.1.1.1,8.8.8.8]");
    expect(lines(referenceOf(rows, params(window)))).toBe(
      "26996..27060 down [1.1.1.1,8.8.8.8] | 27896..27960 down [1.1.1.1,8.8.8.8] | 28796..28860 down [1.1.1.1,8.8.8.8] | 29696..29760 down [1.1.1.1,8.8.8.8]"
    );
  });

  it("reads a duplicated host the same as a single host", () => {
    const rows: NetworkMetric[] = [];
    for (let i = 0; i < 100; i++) {
      for (const host of HOSTS) {
        rows.push(singleRow(T0 + i * INTERVAL_MS, host));
      }
      rows.push(singleRow(T0 + i * INTERVAL_MS, "8.8.8.8"));
    }

    const result = referenceOf(rows, params({ endMs: T0 + 3000 * S }));

    expect(result.observedMs).toBe(3000 * S);
    expect(result.upMs).toBe(3000 * S);
  });

  it("splits time exactly at bucket edges and grades each bucket", () => {
    const rounds = [
      ...Array.from({ length: 10 }, (_, i) =>
        fullCycle(T0 + i * INTERVAL_MS, i === 4 ? "down" : "up")
      ),
    ];
    const rows = startStampedRows(rounds, 0);

    const buckets = bucketsOf(
      rows,
      params({ endMs: T0 + 300 * S }),
      "1m",
      0.05
    );

    expect(buckets.map((b) => b.status)).toEqual([
      "up",
      "up",
      "down",
      "up",
      "up",
    ]);
    expect(buckets.map((b) => b.upMs + b.degradedMs + b.downMs)).toEqual([
      60 * S,
      60 * S,
      60 * S,
      60 * S,
      60 * S,
    ]);
    expect(buckets[2]?.downMs).toBe(30 * S);
    expect(buckets[2]?.upMs).toBe(30 * S);
  });
});
