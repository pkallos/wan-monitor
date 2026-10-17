import type { Outage } from "@shared/api/routes/connectivity-status";
import type { Granularity } from "@shared/api/routes/metrics";
import { Array as Array_, Option } from "effect";
import { describe, expect, test } from "vitest";
import type { Cell, CellStatus } from "@/dashboard/connectivity";
import { CLOCK_FORMAT } from "@/dashboard/format";
import {
  axisTicks,
  bucketAdjective,
  CHIP_OVERHANG_PX,
  type ChipPlacement,
  chipHeightPx,
  DEFAULT_RIBBON_WIDTH_PX,
  dayRows,
  describeRibbon,
  type IncidentChip,
  incidentChips,
  labelsClearOfNow,
  layoutChips,
  ribbonWidthPx,
  segmentForKey,
  stacksByDay,
} from "@/dashboard/ribbon";
import { outageFixture, withTimeZone } from "@/dashboard/testFixtures";

const HOUR_MS = 3_600_000;
const local = (day: number, hour = 0, minute = 0) =>
  new Date(2026, 9, day, hour, minute).getTime();

const cellsFrom = (
  startMs: number,
  count: number,
  intervalMs: number,
  statusAt: (index: number) => CellStatus = () => "up",
  nowMs = startMs + count * intervalMs - 1
): ReadonlyArray<Cell> =>
  Array.from({ length: count }, (_, index) => {
    const cellStartMs = startMs + index * intervalMs;
    return {
      startMs: cellStartMs,
      endMs: cellStartMs + intervalMs,
      status: statusAt(index),
      maybeShares: Option.none(),
      isCurrent: cellStartMs <= nowMs && nowMs < cellStartMs + intervalMs,
    };
  });

const weekday = (day: number) =>
  new Date(2026, 9, day).toLocaleDateString([], { weekday: "short" });

// Thu Oct 8 15:00 through Thu Oct 15 14:00 (the current, partial hour), the
// shape the 7-day range takes.
const sevenDayCells = (statusAt?: (index: number) => CellStatus) =>
  cellsFrom(local(8, 15), 168, HOUR_MS, statusAt, local(15, 14, 32));

describe("bucketAdjective", () => {
  test.each([
    ["1m", "1-minute"],
    ["5m", "5-minute"],
    ["15m", "15-minute"],
    ["1h", "hourly"],
    ["6h", "6-hour"],
    ["1d", "daily"],
  ] as const)("calls a %s bucket %s", (granularity, adjective) => {
    expect(bucketAdjective(granularity)).toBe(adjective);
  });
});

describe("axisTicks", () => {
  test("labels each local day of a week, starting with the partial first one", () => {
    const ticks = axisTicks(sevenDayCells(), local(15, 14, 32));

    expect(ticks.map((tick) => tick.label)).toEqual([
      `${weekday(8)} 8`,
      `${weekday(9)} 9`,
      `${weekday(10)} 10`,
      `${weekday(11)} 11`,
      `${weekday(12)} 12`,
      `${weekday(13)} 13`,
      `${weekday(14)} 14`,
      "Today",
    ]);
  });

  test("places each tick at its share of the window", () => {
    const ticks = axisTicks(sevenDayCells(), local(15, 14, 32));

    expect(ticks[0].fraction).toBe(0);
    expect(ticks[1].fraction).toBeCloseTo(9 / 168, 5);
    expect(ticks[7].fraction).toBeCloseTo(153 / 168, 5);
  });

  test("leaves out the partial first day's label when its midnight is right behind it", () => {
    const cells = cellsFrom(local(8, 22), 24 * 5, HOUR_MS);
    const labels = axisTicks(cells, local(13, 21)).map((tick) => tick.label);

    expect(labels[0]).toBe(`${weekday(9)} 9`);
  });

  test("ticks a day's window every few hours", () => {
    const cells = cellsFrom(local(14, 14), 288, 300_000);
    const ticks = axisTicks(cells, local(15, 13));

    expect(ticks.map((tick) => tick.label)).toEqual([
      "3:00 PM",
      "6:00 PM",
      "9:00 PM",
      "12:00 AM",
      "3:00 AM",
      "6:00 AM",
      "9:00 AM",
      "12:00 PM",
    ]);
  });

  test("ticks an hour's window every quarter hour", () => {
    const cells = cellsFrom(local(15, 13, 31), 60, 60_000);
    const ticks = axisTicks(cells, local(15, 14, 20));

    expect(ticks.map((tick) => tick.label)).toEqual([
      "1:45 PM",
      "2:00 PM",
      "2:15 PM",
      "2:30 PM",
    ]);
  });

  test("thins a month to weekly ticks named by date", () => {
    const cells = cellsFrom(local(1), 720, HOUR_MS);
    const ticks = axisTicks(cells, local(30, 23));

    expect(ticks.length).toBeLessThanOrEqual(8);
    expect(ticks.length).toBeGreaterThan(2);
    expect(ticks[0].label).toBe(
      new Date(2026, 9, 1).toLocaleDateString([], {
        month: "short",
        day: "numeric",
      })
    );
  });

  describe("over months", () => {
    const DAY_MS = 24 * HOUR_MS;
    const monthLabel = (year: number, month: number) =>
      new Date(year, month, 1).toLocaleDateString([], {
        month: "short",
        year: "numeric",
      });
    const dailyCells = (from: Date, to: Date) =>
      cellsFrom(
        from.getTime(),
        Math.round((to.getTime() - from.getTime()) / DAY_MS),
        DAY_MS
      );
    const labelsOf = (from: Date, to: Date) =>
      axisTicks(dailyCells(from, to), to.getTime()).map((tick) => tick.label);

    test("labels each month of a year to date taken in July once, in order", () => {
      expect(labelsOf(new Date(2026, 0, 1), new Date(2026, 6, 20))).toEqual(
        [0, 1, 2, 3, 4, 5, 6].map((month) => monthLabel(2026, month))
      );
    });

    test("labels a year to date taken in October by quarter", () => {
      expect(labelsOf(new Date(2026, 0, 1), new Date(2026, 9, 15))).toEqual([
        monthLabel(2026, 0),
        monthLabel(2026, 3),
        monthLabel(2026, 6),
        monthLabel(2026, 9),
      ]);
    });

    test("labels the last twelve months by quarter, from the first quarter that starts inside them", () => {
      expect(labelsOf(new Date(2025, 9, 15), new Date(2026, 9, 15))).toEqual([
        monthLabel(2026, 0),
        monthLabel(2026, 3),
        monthLabel(2026, 6),
        monthLabel(2026, 9),
      ]);
    });

    test("puts a range that starts on the 1st right at the left edge and carries on month by month", () => {
      const from = new Date(2026, 9, 1);
      const to = new Date(2027, 2, 9);
      const ticks = axisTicks(dailyCells(from, to), to.getTime());

      expect(ticks.map((tick) => tick.label)).toEqual([
        monthLabel(2026, 9),
        monthLabel(2026, 10),
        monthLabel(2026, 11),
        monthLabel(2027, 0),
        monthLabel(2027, 1),
        monthLabel(2027, 2),
      ]);
      expect(ticks[0].fraction).toBe(0);
    });

    test("places each month tick at its local first-of-month", () => {
      const from = new Date(2026, 0, 1);
      const to = new Date(2026, 6, 20);
      const ticks = axisTicks(dailyCells(from, to), to.getTime());
      const span = to.getTime() - from.getTime();

      expect(ticks[3].fraction).toBeCloseTo(
        (new Date(2026, 3, 1).getTime() - from.getTime()) / span,
        3
      );
    });

    test("ticks half-yearly across a couple of years and yearly across many", () => {
      expect(labelsOf(new Date(2024, 2, 10), new Date(2026, 9, 15))).toEqual([
        monthLabel(2024, 6),
        monthLabel(2025, 0),
        monthLabel(2025, 6),
        monthLabel(2026, 0),
        monthLabel(2026, 6),
      ]);
      expect(labelsOf(new Date(2021, 2, 10), new Date(2026, 9, 15))).toEqual([
        monthLabel(2022, 0),
        monthLabel(2023, 0),
        monthLabel(2024, 0),
        monthLabel(2025, 0),
        monthLabel(2026, 0),
      ]);
    });

    test("never repeats a label", () => {
      for (const [from, to] of [
        [new Date(2026, 0, 1), new Date(2026, 6, 20)],
        [new Date(2025, 9, 15), new Date(2026, 9, 15)],
        [new Date(2019, 4, 3), new Date(2026, 9, 15)],
      ]) {
        const labels = labelsOf(from, to);

        expect(new Set(labels).size).toBe(labels.length);
      }
    });
  });

  describe("over very long spans", () => {
    const DAY_MS = 24 * HOUR_MS;
    const yearsOf = (labels: ReadonlyArray<string>) =>
      labels.map((label) => Number(label.slice(-4)));
    const labelsOver = (from: Date, to: Date) =>
      axisTicks(
        cellsFrom(
          from.getTime(),
          Math.round((to.getTime() - from.getTime()) / DAY_MS),
          DAY_MS
        ),
        to.getTime()
      ).map((tick) => tick.label);

    test("ticks every year up to eight years", () => {
      expect(
        yearsOf(labelsOver(new Date(2018, 2, 10), new Date(2026, 1, 1)))
      ).toEqual([2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]);
    });

    test("steps in whole years once the span passes eight, so labels stay at most eight and never repeat", () => {
      const years = yearsOf(
        labelsOver(new Date(2016, 5, 1), new Date(2026, 9, 1))
      );

      expect(years.length).toBeLessThanOrEqual(8);
      expect(years.length).toBeGreaterThan(1);
      expect(new Set(years).size).toBe(years.length);
      const gaps = years.slice(1).map((year, index) => year - years[index]);
      expect(new Set(gaps).size).toBe(1);
      expect(gaps[0]).toBeGreaterThanOrEqual(2);
    });

    test("prints at most eight labels just past the span a yearly tick fits", () => {
      for (const [from, to] of [
        [new Date(2017, 8, 1), new Date(2026, 4, 1)],
        [new Date(2017, 11, 1), new Date(2026, 0, 20)],
      ]) {
        expect(labelsOver(from, to).length).toBeLessThanOrEqual(8);
      }
    });

    test("never prints more than eight labels however long the span", () => {
      for (const startYear of [2010, 1990, 1970]) {
        expect(
          labelsOver(new Date(startYear, 0, 15), new Date(2026, 9, 1)).length
        ).toBeLessThanOrEqual(8);
      }
    });
  });

  test("never places a tick outside the window", () => {
    for (const tick of axisTicks(sevenDayCells(), local(15, 14, 32))) {
      expect(tick.fraction).toBeGreaterThanOrEqual(0);
      expect(tick.fraction).toBeLessThan(1);
    }
  });

  test("has no ticks for no cells", () => {
    expect(axisTicks([], local(15))).toEqual([]);
  });
});

describe("chipHeightPx", () => {
  test("grows with the incident's length up to a ceiling", () => {
    expect(chipHeightPx(0)).toBe(22);
    expect(chipHeightPx(2 * 60)).toBeGreaterThan(22);
    expect(chipHeightPx(44 * 60)).toBe(34);
    expect(chipHeightPx(5 * 3600)).toBe(34);
  });

  test("never shrinks as an incident gets longer", () => {
    const heights = [60, 120, 600, 1800, 2640, 7200].map(chipHeightPx);

    expect(heights).toEqual([...heights].sort((a, b) => a - b));
  });
});

describe("incidentChips", () => {
  const cells = sevenDayCells();
  const RANGE_END = new Date(local(15, 14, 32)).toISOString();
  const down: Outage = outageFixture({
    start: new Date(local(9, 2, 14)).toISOString(),
    end: new Date(local(9, 2, 31)).toISOString(),
    durationSeconds: 17 * 60,
    status: "down",
  });
  const degraded: Outage = outageFixture({
    start: new Date(local(11, 19, 42)).toISOString(),
    end: new Date(local(11, 20, 26)).toISOString(),
    durationSeconds: 44 * 60,
    status: "degraded",
  });
  const ongoing: Outage = outageFixture({
    start: new Date(local(15, 14, 29)).toISOString(),
    end: RANGE_END,
    durationSeconds: 3 * 60,
    status: "degraded",
  });
  const newestFirst = [ongoing, degraded, down];

  test("letters incidents oldest first and puts each over the cell it began in", () => {
    const chips = incidentChips(cells, newestFirst, Option.some(ongoing));

    expect(chips.map((chip) => chip.ref)).toEqual(["C", "B", "A"]);
    expect(chips.map((chip) => chip.cellIndex)).toEqual([167, 76, 11]);
    expect(chips[2].centerFraction).toBeCloseTo(11.5 / 168, 5);
  });

  test("carries the start of the bucket each chip sits over, so a pin survives the window sliding", () => {
    const chips = incidentChips(cells, newestFirst, Option.none());

    expect(chips.map((chip) => chip.bucketStartMs)).toEqual(
      chips.map((chip) => cells[chip.cellIndex].startMs)
    );
  });

  test("labels a chip with the incident's duration and an open one 'ongoing'", () => {
    const chips = incidentChips(cells, newestFirst, Option.some(ongoing));

    expect(chips.map((chip) => chip.label)).toEqual(["ongoing", "44m", "17m"]);
    expect(chips.map((chip) => chip.isOngoing)).toEqual([true, false, false]);
  });

  test("carries the incident's status and a height for its length", () => {
    const [, mid, short] = incidentChips(cells, newestFirst, Option.none());

    expect(short.status).toBe("down");
    expect(mid.status).toBe("degraded");
    expect(mid.heightPx).toBeGreaterThan(short.heightPx);
  });

  test("labels an incident that has not been confirmed open by its duration", () => {
    const [first] = incidentChips(cells, newestFirst, Option.none());

    expect(first.label).toBe("3m");
    expect(first.isOngoing).toBe(false);
  });

  test("drops an incident that began outside the cells shown", () => {
    const before = outageFixture({
      start: new Date(local(1)).toISOString(),
      end: new Date(local(1, 1)).toISOString(),
    });

    expect(incidentChips(cells, [before], Option.none())).toEqual([]);
  });

  test("puts an incident that began as the last cell ended outside the window", () => {
    const window = cellsFrom(
      Date.parse("2026-07-26T11:00:00.000Z"),
      1,
      HOUR_MS
    );
    const startingAt = (iso: string) =>
      outageFixture({ start: iso, end: "2026-07-26T12:30:00.000Z" });

    expect(
      incidentChips(
        window,
        [startingAt("2026-07-26T12:00:00.000Z")],
        Option.none()
      )
    ).toEqual([]);
    const [chip] = incidentChips(
      window,
      [startingAt("2026-07-26T11:59:59.999Z")],
      Option.none()
    );
    expect(chip.cellIndex).toBe(0);
  });

  test("has no chips when there are no cells to put them over", () => {
    expect(incidentChips([], [down], Option.none())).toEqual([]);
  });

  test("has no chips with no incidents", () => {
    expect(incidentChips(cells, [], Option.none())).toEqual([]);
  });
});

describe("stacksByDay", () => {
  test("stacks hourly cells that span more than a day", () => {
    expect(stacksByDay(sevenDayCells(), "1h")).toBe(true);
  });

  test("does not stack other bucket sizes or a single day", () => {
    expect(stacksByDay(cellsFrom(local(8), 288, 300_000), "5m")).toBe(false);
    expect(stacksByDay(cellsFrom(local(8), 24, HOUR_MS), "1h")).toBe(false);
  });
});

describe("dayRows with no cells", () => {
  test("has no rows", () => {
    expect(dayRows([], local(15), [])).toEqual([]);
  });
});

describe("dayRows", () => {
  const cells = sevenDayCells();
  const rows = dayRows(cells, local(15, 14, 32), []);

  test("makes a row for every local day the window touches, newest first", () => {
    expect(rows.map((row) => row.label)).toEqual([
      "Today",
      `${weekday(14)} 14`,
      `${weekday(13)} 13`,
      `${weekday(12)} 12`,
      `${weekday(11)} 11`,
      `${weekday(10)} 10`,
      `${weekday(9)} 9`,
      `${weekday(8)} 8`,
    ]);
  });

  test("gives each row 24 hour slots, empty where the window does not reach", () => {
    expect(rows.every((row) => row.slots.length === 24)).toBe(true);
    expect(rows[0].slots.slice(0, 15).every(Option.isSome)).toBe(true);
    expect(rows[0].slots.slice(15).every(Option.isNone)).toBe(true);
    expect(rows[7].slots.slice(0, 15).every(Option.isNone)).toBe(true);
    expect(rows[7].slots.slice(15).every(Option.isSome)).toBe(true);
  });

  test("carries each cell's index into the whole window", () => {
    const slot = rows[1].slots[0];

    expect(slot).toEqual(
      Option.some({ cell: cells[9 + 24 * 5], index: 9 + 24 * 5 })
    );
  });

  test("lists the refs of the incidents that began that day", () => {
    const withRefs = dayRows(cells, local(15, 14, 32), [
      { ref: "A", cellIndex: 11 },
      { ref: "B", cellIndex: 76 },
      { ref: "C", cellIndex: 167 },
    ]);

    expect(withRefs.map((row) => row.refs)).toEqual([
      ["C"],
      [],
      [],
      [],
      ["B"],
      [],
      ["A"],
      [],
    ]);
  });
});

describe("dayRows across a daylight saving change", () => {
  const LOS_ANGELES = "America/Los_Angeles";
  const hourlyCells = (startIso: string, count: number) =>
    cellsFrom(Date.parse(startIso), count, HOUR_MS);
  const presentCount = (row: {
    slots: ReadonlyArray<Option.Option<unknown>>;
  }) => row.slots.filter(Option.isSome).length;

  test("gives the 25-hour fall-back day a slot for every hour, the repeated one included", () => {
    withTimeZone(LOS_ANGELES, () => {
      const cells = hourlyCells("2026-10-31T20:00:00.000Z", 40);
      const rows = dayRows(cells, cells[39].startMs, []);

      expect(rows.map((row) => row.slots.length)).toEqual([24, 25, 24]);
      expect(presentCount(rows[1])).toBe(25);
    });
  });

  test("gives the 23-hour spring-forward day no empty slot where the skipped hour was", () => {
    withTimeZone(LOS_ANGELES, () => {
      const cells = hourlyCells("2026-03-07T20:00:00.000Z", 40);
      const rows = dayRows(cells, cells[39].startMs, []);

      expect(rows.map((row) => row.slots.length)).toEqual([24, 23, 24]);
      expect(presentCount(rows[1])).toBe(23);
    });
  });

  test("pads only before the range start on the first day and after the last cell on the last", () => {
    withTimeZone(LOS_ANGELES, () => {
      const cells = hourlyCells("2026-10-31T20:00:00.000Z", 40);
      const [last, , first] = dayRows(cells, cells[39].startMs, []);

      expect(first.slots.slice(0, 13).every(Option.isNone)).toBe(true);
      expect(first.slots.slice(13).every(Option.isSome)).toBe(true);
      expect(last.slots.slice(0, 4).every(Option.isSome)).toBe(true);
      expect(last.slots.slice(4).every(Option.isNone)).toBe(true);
    });
  });

  test("keeps every slot's cell at the index it has in the window, in time order", () => {
    withTimeZone(LOS_ANGELES, () => {
      const cells = hourlyCells("2026-10-31T20:00:00.000Z", 40);
      const rows = dayRows(cells, cells[39].startMs, []);
      const indexes = Array_.reverse(rows)
        .flatMap((row) => row.slots.filter(Option.isSome))
        .map((slot) => slot.value.index);

      expect(indexes).toEqual(cells.map((_, index) => index));
    });
  });
});

describe("describeRibbon", () => {
  const statusAt = (index: number): CellStatus =>
    index === 11 || index === 159
      ? "down"
      : index === 76 || index === 77
        ? "degraded"
        : "up";
  const cells = sevenDayCells(statusAt);

  test("names the window, the bucket size and which buckets were down or degraded", () => {
    const text = describeRibbon(cells, "1h");

    expect(text).toMatch(/^Hourly status, .+ to now\./);
    expect(text).toContain("Down: ");
    expect(text).toContain("Degraded: ");
    expect(text).toContain("All other hours up.");
  });

  test("says there is no status to show for an empty window", () => {
    expect(describeRibbon([], "1h")).toBe("No status to show.");
  });

  test("words a short window as exact sentences, each listed bucket kept whole by a semicolon", () => {
    const window = cellsFrom(
      Date.UTC(2026, 9, 12, 10),
      4,
      HOUR_MS,
      (index) => (index === 1 ? "down" : index === 2 ? "degraded" : "up"),
      Date.UTC(2026, 9, 20)
    );

    expect(withTimeZone("UTC", () => describeRibbon(window, "1h"))).toBe(
      "Hourly status, Mon, Oct 12, 10:00 AM to Mon, Oct 12, 2:00 PM. Down: Mon, Oct 12, 11:00 AM. Degraded: Mon, Oct 12, 12:00 PM. All other hours up."
    );
  });

  test("separates several buckets of one status with semicolons, since each already holds commas", () => {
    const window = cellsFrom(
      Date.UTC(2026, 9, 12, 10),
      4,
      HOUR_MS,
      (index) => (index === 1 || index === 2 ? "down" : "up"),
      Date.UTC(2026, 9, 20)
    );

    expect(withTimeZone("UTC", () => describeRibbon(window, "1h"))).toContain(
      "Down: Mon, Oct 12, 11:00 AM; Mon, Oct 12, 12:00 PM."
    );
  });

  test("lists the start of each affected bucket", () => {
    const text = describeRibbon(cells, "1h");
    const start = (index: number) =>
      new Date(cells[index].startMs).toLocaleString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
        ...CLOCK_FORMAT,
      });

    expect(text).toContain(`Down: ${start(11)}; ${start(159)}.`);
    expect(text).toContain(`Degraded: ${start(76)}; ${start(77)}.`);
  });

  test("says everything was up for a clean window", () => {
    const text = describeRibbon(sevenDayCells(), "1h");

    expect(text).not.toContain("Down:");
    expect(text).not.toContain("Degraded:");
    expect(text).toContain("All hours up.");
  });

  test("counts the buckets with no data", () => {
    const text = describeRibbon(
      sevenDayCells((index) => (index < 5 ? "noInfo" : "up")),
      "1h"
    );

    expect(text).toContain("No data: 5 hours.");
  });

  test("caps a long list and says how many more there are", () => {
    const text = describeRibbon(
      sevenDayCells((index) => (index < 20 ? "down" : "up")),
      "1h"
    );

    expect(text).toMatch(/Down: (.+; ){7}[^;]+ and 12 more\./);
    expect(text.match(/;/g)).toHaveLength(7);
  });

  test("ends at the last bucket's end when the window is not live", () => {
    const past = cellsFrom(local(1), 24, HOUR_MS, () => "up", local(20));

    expect(describeRibbon(past, "1h")).not.toContain("to now");
  });

  test("names a daily bucket by its UTC day west of UTC", () => {
    const dayMs = 24 * HOUR_MS;
    const cells = cellsFrom(
      Date.UTC(2026, 9, 10),
      5,
      dayMs,
      (i) => (i === 2 ? "down" : "up"),
      Date.UTC(2026, 9, 20)
    );

    expect(
      withTimeZone("America/Los_Angeles", () => describeRibbon(cells, "1d"))
    ).toContain("Down: Mon, Oct 12.");
  });

  test("describes a daily window by its days", () => {
    const text = describeRibbon(
      cellsFrom(local(1), 10, 24 * HOUR_MS, (i) => (i === 3 ? "down" : "up")),
      "1d" satisfies Granularity
    );

    expect(text).toMatch(/^Daily status, /);
    expect(text).toContain("All other days up.");
  });
});

describe("segmentForKey", () => {
  test("steps to the neighbouring cell with the arrow keys", () => {
    expect(segmentForKey("ArrowRight", Option.some(3), 10)).toEqual(
      Option.some(4)
    );
    expect(segmentForKey("ArrowLeft", Option.some(3), 10)).toEqual(
      Option.some(2)
    );
  });

  test("stops at either end rather than wrapping", () => {
    expect(segmentForKey("ArrowRight", Option.some(9), 10)).toEqual(
      Option.some(9)
    );
    expect(segmentForKey("ArrowLeft", Option.some(0), 10)).toEqual(
      Option.some(0)
    );
  });

  test("jumps to the ends with Home and End", () => {
    expect(segmentForKey("Home", Option.some(5), 10)).toEqual(Option.some(0));
    expect(segmentForKey("End", Option.some(5), 10)).toEqual(Option.some(9));
  });

  test("starts from the matching end when nothing is selected", () => {
    expect(segmentForKey("ArrowRight", Option.none(), 10)).toEqual(
      Option.some(0)
    );
    expect(segmentForKey("ArrowLeft", Option.none(), 10)).toEqual(
      Option.some(9)
    );
  });

  test("ignores any other key and an empty ribbon", () => {
    expect(segmentForKey("Tab", Option.some(3), 10)).toEqual(Option.none());
    expect(segmentForKey("ArrowRight", Option.none(), 0)).toEqual(
      Option.none()
    );
  });
});

const spanOf = (
  placement: ChipPlacement,
  ribbonWidth: number
): { left: number; right: number } => {
  const centerPx = placement.centerFraction * ribbonWidth;
  const left = {
    right: ribbonWidth - placement.widthPx,
    end: centerPx - placement.widthPx + CHIP_OVERHANG_PX,
    start: centerPx - CHIP_OVERHANG_PX,
    center: centerPx - placement.widthPx / 2,
  }[placement.anchor];
  return { left, right: left + placement.widthPx };
};

describe("layoutChips", () => {
  const chipAt = (
    cellIndex: number,
    overrides: Partial<IncidentChip> = {}
  ): IncidentChip => ({
    outage: outageFixture(),
    ref: String.fromCharCode(65 + (cellIndex % 26)),
    status: "down",
    cellIndex,
    bucketStartMs: cellIndex * HOUR_MS,
    centerFraction: (cellIndex + 0.5) / 168,
    heightPx: 28,
    label: "10m",
    isOngoing: false,
    ...overrides,
  });

  test("has nothing to lay out with no chips", () => {
    expect(layoutChips([], DEFAULT_RIBBON_WIDTH_PX)).toEqual([]);
  });

  test("keeps chips that are far apart on the first lane, each on its own", () => {
    const placements = layoutChips(
      [chipAt(10), chipAt(70), chipAt(130)],
      DEFAULT_RIBBON_WIDTH_PX
    );

    expect(placements.map((placement) => placement.lane)).toEqual([0, 0, 0]);
    expect(placements.map((placement) => placement.chips.length)).toEqual([
      1, 1, 1,
    ]);
  });

  test("moves a chip that would cover its neighbour to the second lane", () => {
    const placements = layoutChips(
      [chipAt(100), chipAt(102)],
      DEFAULT_RIBBON_WIDTH_PX
    );

    expect(placements.map((placement) => placement.lane)).toEqual([0, 1]);
    expect(placements.every((placement) => placement.chips.length === 1)).toBe(
      true
    );
  });

  test("merges a chip that fits neither lane into a cluster named by its first and last letter", () => {
    const placements = layoutChips(
      [chipAt(100), chipAt(101), chipAt(102)],
      DEFAULT_RIBBON_WIDTH_PX
    );
    const cluster = placements.find((placement) => placement.chips.length > 1);

    expect(cluster?.chips.map((chip) => chip.ref)).toEqual(["W", "X", "Y"]);
    expect(cluster?.label).toBe("W–Y");
  });

  test("pins the first incident of a cluster", () => {
    const placements = layoutChips(
      [chipAt(100), chipAt(101), chipAt(102)],
      DEFAULT_RIBBON_WIDTH_PX
    );
    const cluster = placements.find((placement) => placement.chips.length > 1);

    expect(cluster?.pinIndex).toBe(100);
    expect(cluster?.pinStartMs).toBe(100 * HOUR_MS);
  });

  test("puts every chip in exactly one placement, however crowded", () => {
    const chips = Array.from({ length: 30 }, (_, i) => chipAt(100 + (i % 6)));
    const placements = layoutChips(chips, DEFAULT_RIBBON_WIDTH_PX);

    expect(placements.flatMap((placement) => placement.chips)).toHaveLength(30);
  });

  test("never lets two placements on one lane overlap, however crowded or wide the ribbon", () => {
    for (const ribbonWidth of [DEFAULT_RIBBON_WIDTH_PX, 560, 320]) {
      for (const spacing of [1, 2, 3, 5, 9]) {
        const chips = Array.from({ length: 40 }, (_, i) =>
          chipAt(Math.min(167, i * spacing), {
            label: i % 3 === 0 ? "ongoing" : "1h 5m",
          })
        );
        const placements = layoutChips(chips, ribbonWidth);

        for (const lane of [0, 1]) {
          const spans = placements
            .filter((placement) => placement.lane === lane)
            .map((placement) => spanOf(placement, ribbonWidth))
            .sort((a, b) => a.left - b.left);
          for (let i = 1; i < spans.length; i++) {
            expect(spans[i].left).toBeGreaterThanOrEqual(spans[i - 1].right);
          }
        }
      }
    }
  });

  test("keeps two chips on one lane in an 800px ribbon that would overlap in a 560px one", () => {
    const chips = [chipAt(60), chipAt(77)];

    expect(layoutChips(chips, 800).map((placement) => placement.lane)).toEqual([
      0, 0,
    ]);
    expect(layoutChips(chips, 560).map((placement) => placement.lane)).toEqual([
      0, 1,
    ]);
  });

  test("folds chips into a cluster sooner in a narrow ribbon", () => {
    const chips = [chipAt(60), chipAt(70), chipAt(80)];

    expect(
      layoutChips(chips, 800).every((placement) => placement.chips.length === 1)
    ).toBe(true);
    expect(
      layoutChips(chips, 320).some((placement) => placement.chips.length > 1)
    ).toBe(true);
  });

  test("hangs the chip of a running incident from the right edge", () => {
    const [placement] = layoutChips(
      [chipAt(167, { isOngoing: true, label: "ongoing" })],
      DEFAULT_RIBBON_WIDTH_PX
    );

    expect(placement.anchor).toBe("right");
  });

  test("hangs a chip near the end of the ribbon inward, and one near the start the other way", () => {
    const [end] = layoutChips([chipAt(160)], DEFAULT_RIBBON_WIDTH_PX);
    const [start] = layoutChips([chipAt(2)], DEFAULT_RIBBON_WIDTH_PX);
    const [middle] = layoutChips([chipAt(80)], DEFAULT_RIBBON_WIDTH_PX);

    expect(end.anchor).toBe("end");
    expect(start.anchor).toBe("start");
    expect(middle.anchor).toBe("center");
  });
});

describe("labelsClearOfNow", () => {
  const tick = (fraction: number, label: string) => ({ fraction, label });
  const clearOfNow = (ticks: ReadonlyArray<ReturnType<typeof tick>>) =>
    labelsClearOfNow(ticks, DEFAULT_RIBBON_WIDTH_PX);

  test("keeps labels well before the right edge", () => {
    expect(clearOfNow([tick(0, "Fri 9"), tick(0.5, "Mon 12")])).toEqual([
      tick(0, "Fri 9"),
      tick(0.5, "Mon 12"),
    ]);
  });

  test("keeps a short label that ends before Now begins", () => {
    expect(clearOfNow([tick(0.91, "Today")])).toEqual([tick(0.91, "Today")]);
  });

  test("drops a label that would run into Now", () => {
    expect(clearOfNow([tick(0.95, "Oct 14")])).toEqual([]);
  });

  test("drops a longer label sooner than a shorter one", () => {
    expect(clearOfNow([tick(0.92, "Mon 12")])).toEqual([]);
    expect(clearOfNow([tick(0.92, "Mon")])).toHaveLength(1);
  });

  test("drops a label in a narrow ribbon that fits in a wide one", () => {
    const label = tick(0.9, "Mon 12");

    expect(labelsClearOfNow([label], 800)).toEqual([label]);
    expect(labelsClearOfNow([label], 560)).toEqual([]);
  });
});

describe("ribbonWidthPx", () => {
  test("uses the measured width once there is one", () => {
    expect(ribbonWidthPx(Option.some(560))).toBe(560);
  });

  test("falls back to a typical width until the ribbon has been measured", () => {
    expect(ribbonWidthPx(Option.none())).toBe(DEFAULT_RIBBON_WIDTH_PX);
  });
});
