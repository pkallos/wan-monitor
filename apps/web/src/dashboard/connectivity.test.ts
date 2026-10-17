import { Option } from "effect";
import { describe, expect, test } from "vitest";
import {
  bucketIndexOf,
  bucketStartMs,
  buildCells,
  CELL_CLASSES,
  CELL_LABELS,
  cellBody,
  cellTitle,
} from "@/dashboard/connectivity";
import { withTimeZone } from "@/dashboard/testFixtures";

const point = (
  timestamp: string,
  status: "up" | "degraded" | "down",
  shares: { up: number; degraded: number; down: number }
) => ({
  timestamp,
  status,
  upPercentage: shares.up,
  degradedPercentage: shares.degraded,
  downPercentage: shares.down,
});

describe("CELL_CLASSES", () => {
  test("gives every cell status its own fill", () => {
    const fills = Object.values(CELL_CLASSES).map(
      (classes) => classes.split(" ")[0]
    );

    expect(new Set(fills).size).toBe(fills.length);
  });

  test("backs degraded, down and no data with a pattern as well as a colour", () => {
    expect(CELL_CLASSES.degraded).toContain("pattern-hatch");
    expect(CELL_CLASSES.down).toContain("pattern-strike");
    expect(CELL_CLASSES.noInfo).toContain("pattern-nodata");
  });

  test("draws no status from a raw colour, only the semantic tokens", () => {
    for (const classes of Object.values(CELL_CLASSES)) {
      expect(classes).toMatch(/^(bg-(up|deg|down|track)|pattern-nodata)\b/);
    }
  });
});

describe("buildCells", () => {
  const startMs = Date.parse("2026-07-26T10:00:00.000Z");
  const endMs = Date.parse("2026-07-26T10:15:00.000Z");
  const cells = (
    points: Parameters<typeof buildCells>[0] = [],
    maybeEarliestDataMs: Option.Option<number> = Option.none(),
    nowMs = endMs
  ) => buildCells(points, startMs, endMs, "5m", maybeEarliestDataMs, nowMs);

  test("fills gaps in the window with noInfo cells", () => {
    expect(
      cells().map(({ startMs, endMs, status }) => ({ startMs, endMs, status }))
    ).toEqual([
      { startMs, endMs: startMs + 300_000, status: "noInfo" },
      {
        startMs: startMs + 300_000,
        endMs: startMs + 600_000,
        status: "noInfo",
      },
      {
        startMs: startMs + 600_000,
        endMs: startMs + 900_000,
        status: "noInfo",
      },
    ]);
  });

  test("starts at the cell holding the start of the window", () => {
    const result = buildCells(
      [],
      startMs + 120_000,
      endMs,
      "5m",
      Option.none(),
      endMs
    );

    expect(result[0].startMs).toBe(startMs);
    expect(result).toHaveLength(3);
  });

  test("includes the cell still filling at the end of the window", () => {
    const result = buildCells(
      [],
      startMs,
      endMs - 180_000,
      "5m",
      Option.none(),
      endMs
    );

    expect(result.map((cell) => cell.startMs)).toEqual([
      startMs,
      startMs + 300_000,
      startMs + 600_000,
    ]);
  });

  test("passes through the server's status and shares unchanged", () => {
    const result = cells([
      point("2026-07-26T10:00:00.000Z", "down", {
        up: 0,
        degraded: 20,
        down: 80,
      }),
      point("2026-07-26T10:05:00.000Z", "degraded", {
        up: 20,
        degraded: 60,
        down: 20,
      }),
      point("2026-07-26T10:10:00.000Z", "up", {
        up: 100,
        degraded: 0,
        down: 0,
      }),
    ]);

    expect(result.map((cell) => cell.status)).toEqual([
      "down",
      "degraded",
      "up",
    ]);
    expect(result[0].maybeShares).toEqual(
      Option.some({ up: 0, degraded: 20, down: 80 })
    );
  });

  test("gives a gap no shares", () => {
    expect(cells()[0].maybeShares).toEqual(Option.none());
  });

  test("marks cells before the first ever sample as notMonitored", () => {
    // Monitoring began in the third cell, so the two before it describe a
    // period nobody was watching, not a period the monitor went quiet.
    const result = cells([], Option.some(startMs + 600_000));

    expect(result.map((cell) => cell.status)).toEqual([
      "notMonitored",
      "notMonitored",
      "noInfo",
    ]);
  });

  test("counts the cell holding the first sample as monitored", () => {
    const result = cells([], Option.some(startMs + 120_000));

    expect(result[0].status).toBe("noInfo");
  });

  test("treats gaps after monitoring started as noInfo, not notMonitored", () => {
    const result = cells([], Option.some(startMs - 86_400_000));

    expect(result.map((cell) => cell.status)).toEqual([
      "noInfo",
      "noInfo",
      "noInfo",
    ]);
  });

  test("never overrides a real reading with notMonitored", () => {
    const result = cells(
      [
        point("2026-07-26T10:00:00.000Z", "down", {
          up: 0,
          degraded: 0,
          down: 100,
        }),
      ],
      Option.some(startMs + 600_000)
    );

    expect(result[0].status).toBe("down");
  });

  test("flags the cell that contains the present moment", () => {
    const result = cells([], Option.none(), startMs + 650_000);

    expect(result.map((cell) => cell.isCurrent)).toEqual([false, false, true]);
  });

  test("hands the present to the bucket that starts at it, not the one that ends there", () => {
    const hourly = (nowMs: number) =>
      buildCells(
        [],
        Date.parse("2026-07-26T10:00:00.000Z"),
        Date.parse("2026-07-26T12:00:00.000Z"),
        "1h",
        Option.none(),
        nowMs
      ).map((cell) => cell.isCurrent);

    expect(hourly(Date.parse("2026-07-26T11:00:00.000Z"))).toEqual([
      false,
      true,
    ]);
    expect(hourly(Date.parse("2026-07-26T10:59:59.999Z"))).toEqual([
      true,
      false,
    ]);
  });

  test("flags nothing when the present moment is outside the window", () => {
    const result = cells([], Option.none(), endMs + 3_600_000);

    expect(result.some((cell) => cell.isCurrent)).toBe(false);
  });

  test("is empty for an inverted window", () => {
    expect(buildCells([], endMs, startMs, "5m", Option.none(), endMs)).toEqual(
      []
    );
  });
});

describe("CELL_LABELS", () => {
  test("uses the history vocabulary", () => {
    expect(CELL_LABELS.up).toBe("Up");
    expect(CELL_LABELS.degraded).toBe("Degraded");
    expect(CELL_LABELS.down).toBe("Down");
    expect(CELL_LABELS.noInfo).toBe("No data");
    expect(CELL_LABELS.notMonitored).toBe("Before monitoring started");
  });
});

describe("cellTitle", () => {
  const at = (hour: number, minute = 0) =>
    new Date(2026, 9, 11, hour, minute).getTime();
  const cell = (startMs: number, endMs: number, isCurrent = false) => ({
    startMs,
    endMs,
    status: "up" as const,
    maybeShares: Option.none(),
    isCurrent,
  });
  const dayLabel = new Date(2026, 9, 11).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  test("gives the day and the clock span of a sub-day bucket", () => {
    expect(cellTitle(cell(at(19), at(20)), "1h")).toBe(
      `${dayLabel}, 7:00 PM–8:00 PM`
    );
  });

  test("shows the minutes of a fine bucket", () => {
    expect(cellTitle(cell(at(19, 5), at(19, 10)), "5m")).toBe(
      `${dayLabel}, 7:05 PM–7:10 PM`
    );
  });

  test("gives only the day of a daily bucket", () => {
    const startMs = Date.UTC(2026, 9, 11);
    const endMs = Date.UTC(2026, 9, 12);

    expect(
      withTimeZone("UTC", () => cellTitle(cell(startMs, endMs), "1d"))
    ).toBe("Sun, Oct 11");
  });

  test("names a daily bucket by its UTC day west of UTC, where local midnight falls on the day before", () => {
    const startMs = Date.UTC(2026, 9, 12);
    const endMs = Date.UTC(2026, 9, 13);

    expect(
      withTimeZone("America/Los_Angeles", () =>
        cellTitle(cell(startMs, endMs), "1d")
      )
    ).toBe("Mon, Oct 12");
  });

  test("marks the cell that is filling now", () => {
    expect(cellTitle(cell(at(19), at(20), true), "1h")).toBe(
      `${dayLabel}, 7:00 PM–8:00 PM · Now`
    );
  });
});

describe("cellBody", () => {
  const cell = (
    status: Parameters<typeof cellBody>[0]["status"],
    shares?: { up: number; degraded: number; down: number }
  ) => ({
    startMs: 0,
    endMs: 1,
    status,
    maybeShares: Option.fromNullishOr(shares),
    isCurrent: false,
  });

  test("says a fully up bucket was up", () => {
    expect(cellBody(cell("up", { up: 100, degraded: 0, down: 0 }))).toBe(
      "100% up"
    );
  });

  test("names the status and the share of each state present", () => {
    expect(cellBody(cell("down", { up: 97.5, degraded: 0, down: 2.5 }))).toBe(
      "Down · 97.5% up, 2.5% down"
    );
    expect(cellBody(cell("degraded", { up: 70, degraded: 30, down: 0 }))).toBe(
      "Degraded · 70% up, 30% degraded"
    );
  });

  test("lists all three shares when all are present", () => {
    expect(cellBody(cell("down", { up: 50, degraded: 25, down: 25 }))).toBe(
      "Down · 50% up, 25% degraded, 25% down"
    );
  });

  test("rounds a share to one decimal and drops a trailing zero", () => {
    expect(
      cellBody(cell("degraded", { up: 66.666, degraded: 33.334, down: 0 }))
    ).toBe("Degraded · 66.7% up, 33.3% degraded");
  });

  test("says only the status for a bucket with no readings", () => {
    expect(cellBody(cell("noInfo"))).toBe("No data");
    expect(cellBody(cell("notMonitored"))).toBe("Before monitoring started");
  });
});

describe("bucketStartMs and bucketIndexOf", () => {
  const HOUR_MS = 3_600_000;
  const window = {
    startTimeMs: Date.UTC(2026, 9, 11, 10, 20),
    endTimeMs: Date.UTC(2026, 9, 11, 14, 5),
    granularity: "1h" as const,
  };

  test("starts the first bucket at the aligned window start, then steps by the bucket size", () => {
    expect(bucketStartMs(window, 0)).toBe(Date.UTC(2026, 9, 11, 10));
    expect(bucketStartMs(window, 3)).toBe(Date.UTC(2026, 9, 11, 13));
  });

  test("agrees with the cells built for the same window", () => {
    const cells = buildCells(
      [],
      window.startTimeMs,
      window.endTimeMs,
      window.granularity,
      Option.none(),
      window.endTimeMs
    );

    expect(cells.map((cell) => cell.startMs)).toEqual(
      cells.map((_, index) => bucketStartMs(window, index))
    );
  });

  test("finds the index of a bucket that is still in the window", () => {
    expect(bucketIndexOf(window, Date.UTC(2026, 9, 11, 12))).toEqual(
      Option.some(2)
    );
  });

  test("keeps pointing at the same bucket after the window slides forward", () => {
    const slid = {
      ...window,
      startTimeMs: window.startTimeMs + HOUR_MS,
      endTimeMs: window.endTimeMs + HOUR_MS,
    };

    expect(bucketIndexOf(slid, Date.UTC(2026, 9, 11, 12))).toEqual(
      Option.some(1)
    );
  });

  test("finds nothing for a bucket that left the window or lies past its end", () => {
    expect(bucketIndexOf(window, Date.UTC(2026, 9, 11, 9))).toEqual(
      Option.none()
    );
    expect(bucketIndexOf(window, Date.UTC(2026, 9, 11, 15))).toEqual(
      Option.none()
    );
  });

  test("finds nothing for a start that is not on a bucket boundary", () => {
    expect(bucketIndexOf(window, Date.UTC(2026, 9, 11, 12, 30))).toEqual(
      Option.none()
    );
  });
});
