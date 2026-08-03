import { Option } from "effect";
import { describe, expect, test } from "vitest";
import {
  Custom,
  formatDateRangeLabel,
  getDateRangeWindow,
  getPresetRange,
  granularityForRange,
  granularityForSpeedtestRange,
  PRESET_LABELS,
  PRESET_ORDER,
  Preset,
} from "@/dashboard/dateRange";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe("PRESET_LABELS and PRESET_ORDER", () => {
  test("every preset in PRESET_ORDER has a label", () => {
    for (const preset of PRESET_ORDER) {
      expect(PRESET_LABELS[preset]).toBeTypeOf("string");
    }
  });

  test("PRESET_ORDER lists presets in the expected display order", () => {
    expect(PRESET_ORDER).toEqual([
      "last1h",
      "last24h",
      "last7d",
      "last30d",
      "mtd",
      "qtd",
      "ytd",
      "last12m",
      "allTime",
    ]);
  });

  test("PRESET_ORDER renders every known preset", () => {
    expect([...PRESET_ORDER].sort()).toEqual(Object.keys(PRESET_LABELS).sort());
  });
});

describe("getPresetRange", () => {
  const NOW_MS = Date.parse("2026-07-26T12:00:00.000Z");

  test("last1h starts 1 hour earlier", () => {
    expect(getPresetRange("last1h", NOW_MS)).toEqual({
      startTime: "2026-07-26T11:00:00.000Z",
      endTime: "2026-07-26T12:00:00.000Z",
    });
  });

  test("last24h starts 24 hours earlier", () => {
    expect(getPresetRange("last24h", NOW_MS)).toEqual({
      startTime: "2026-07-25T12:00:00.000Z",
      endTime: "2026-07-26T12:00:00.000Z",
    });
  });

  test("last7d starts 7 days earlier", () => {
    expect(getPresetRange("last7d", NOW_MS)).toEqual({
      startTime: "2026-07-19T12:00:00.000Z",
      endTime: "2026-07-26T12:00:00.000Z",
    });
  });

  test("last30d starts 30 days earlier", () => {
    expect(getPresetRange("last30d", NOW_MS)).toEqual({
      startTime: "2026-06-26T12:00:00.000Z",
      endTime: "2026-07-26T12:00:00.000Z",
    });
  });

  test("mtd starts at 00:00:00.000Z on the 1st of the current UTC month", () => {
    expect(getPresetRange("mtd", NOW_MS)).toEqual({
      startTime: "2026-07-01T00:00:00.000Z",
      endTime: "2026-07-26T12:00:00.000Z",
    });
  });

  test("mtd on the first day of the month still starts at that month's beginning", () => {
    const firstOfMonth = Date.parse("2026-07-01T05:00:00.000Z");
    expect(getPresetRange("mtd", firstOfMonth)).toEqual({
      startTime: "2026-07-01T00:00:00.000Z",
      endTime: "2026-07-01T05:00:00.000Z",
    });
  });

  test("qtd starts at the beginning of the current UTC quarter (Jul is Q3)", () => {
    expect(getPresetRange("qtd", NOW_MS)).toEqual({
      startTime: "2026-07-01T00:00:00.000Z",
      endTime: "2026-07-26T12:00:00.000Z",
    });
  });

  test.each([
    ["2026-01-15T09:00:00.000Z", "2026-01-01T00:00:00.000Z"],
    ["2026-02-15T09:00:00.000Z", "2026-01-01T00:00:00.000Z"],
    ["2026-03-15T09:00:00.000Z", "2026-01-01T00:00:00.000Z"],
    ["2026-04-15T09:00:00.000Z", "2026-04-01T00:00:00.000Z"],
    ["2026-05-15T09:00:00.000Z", "2026-04-01T00:00:00.000Z"],
    ["2026-06-15T09:00:00.000Z", "2026-04-01T00:00:00.000Z"],
    ["2026-07-15T09:00:00.000Z", "2026-07-01T00:00:00.000Z"],
    ["2026-08-15T09:00:00.000Z", "2026-07-01T00:00:00.000Z"],
    ["2026-09-15T09:00:00.000Z", "2026-07-01T00:00:00.000Z"],
    ["2026-10-15T09:00:00.000Z", "2026-10-01T00:00:00.000Z"],
    ["2026-11-15T09:00:00.000Z", "2026-10-01T00:00:00.000Z"],
    ["2026-12-15T09:00:00.000Z", "2026-10-01T00:00:00.000Z"],
  ])("qtd from %s starts the quarter at %s", (nowIso, expectedStart) => {
    expect(getPresetRange("qtd", Date.parse(nowIso)).startTime).toBe(
      expectedStart
    );
  });

  test("mtd, qtd and ytd coincide on January 1st", () => {
    const newYear = Date.parse("2026-01-01T00:30:00.000Z");
    const yearStart = "2026-01-01T00:00:00.000Z";

    expect(getPresetRange("mtd", newYear).startTime).toBe(yearStart);
    expect(getPresetRange("qtd", newYear).startTime).toBe(yearStart);
    expect(getPresetRange("ytd", newYear).startTime).toBe(yearStart);
  });

  test("every preset ends at nowMs and starts no later than it", () => {
    for (const preset of PRESET_ORDER) {
      const { startTime, endTime } = getPresetRange(preset, NOW_MS);
      expect(endTime, preset).toBe("2026-07-26T12:00:00.000Z");
      expect(Date.parse(startTime), preset).toBeLessThanOrEqual(NOW_MS);
    }
  });

  test("ytd starts at 00:00:00.000Z on January 1st of the current UTC year", () => {
    expect(getPresetRange("ytd", NOW_MS)).toEqual({
      startTime: "2026-01-01T00:00:00.000Z",
      endTime: "2026-07-26T12:00:00.000Z",
    });
  });

  test("last12m starts exactly 12 calendar months earlier on the same day and time", () => {
    expect(getPresetRange("last12m", NOW_MS)).toEqual({
      startTime: "2025-07-26T12:00:00.000Z",
      endTime: "2026-07-26T12:00:00.000Z",
    });
  });

  test("last12m counts calendar months, so a span containing Feb 29 does not drift a day", () => {
    const acrossLeapDay = Date.parse("2024-06-15T12:00:00.000Z");
    expect(getPresetRange("last12m", acrossLeapDay).startTime).toBe(
      "2023-06-15T12:00:00.000Z"
    );
  });

  test("last12m from a leap day overflows into March per JS Date.UTC's own month-length normalization", () => {
    const leapDay = Date.parse("2024-02-29T12:00:00.000Z");
    expect(getPresetRange("last12m", leapDay)).toEqual({
      startTime: "2023-03-01T12:00:00.000Z",
      endTime: "2024-02-29T12:00:00.000Z",
    });
  });

  test("allTime falls back to the Unix epoch when no earliest datapoint is known", () => {
    expect(getPresetRange("allTime", NOW_MS)).toEqual({
      startTime: "1970-01-01T00:00:00.000Z",
      endTime: "2026-07-26T12:00:00.000Z",
    });
  });

  test("allTime starts at the earliest known datapoint instead of the epoch", () => {
    const earliestDataMs = Date.parse("2026-03-10T08:00:00.000Z");
    expect(
      getPresetRange("allTime", NOW_MS, Option.some(earliestDataMs))
    ).toEqual({
      startTime: "2026-03-10T08:00:00.000Z",
      endTime: "2026-07-26T12:00:00.000Z",
    });
  });

  test("only allTime is affected by maybeEarliestDataMs; other presets ignore it", () => {
    const earliestDataMs = Date.parse("2026-07-01T00:00:00.000Z");
    expect(
      getPresetRange("last7d", NOW_MS, Option.some(earliestDataMs))
    ).toEqual(getPresetRange("last7d", NOW_MS));
  });
});

describe("getDateRangeWindow", () => {
  const NOW_MS = Date.parse("2026-07-26T12:00:00.000Z");

  test("resolves a Preset selection via getPresetRange", () => {
    expect(getDateRangeWindow(Preset({ preset: "last7d" }), NOW_MS)).toEqual(
      getPresetRange("last7d", NOW_MS)
    );
  });

  test("returns a Custom selection's stored window as-is, ignoring nowMs", () => {
    const custom = Custom({
      startTime: "2020-01-01T00:00:00.000Z",
      endTime: "2020-02-01T00:00:00.000Z",
    });

    expect(getDateRangeWindow(custom, NOW_MS)).toEqual({
      startTime: "2020-01-01T00:00:00.000Z",
      endTime: "2020-02-01T00:00:00.000Z",
    });
  });

  test("resolves an allTime Preset's start from maybeEarliestDataMs", () => {
    const earliestDataMs = Date.parse("2025-11-01T00:00:00.000Z");

    expect(
      getDateRangeWindow(
        Preset({ preset: "allTime" }),
        NOW_MS,
        Option.some(earliestDataMs)
      )
    ).toEqual({
      startTime: "2025-11-01T00:00:00.000Z",
      endTime: "2026-07-26T12:00:00.000Z",
    });
  });
});

describe("formatDateRangeLabel", () => {
  test("formats a same-year range without repeating the year", () => {
    expect(
      formatDateRangeLabel({
        startTime: "2026-07-01T00:00:00.000Z",
        endTime: "2026-07-30T12:00:00.000Z",
      })
    ).toBe("Jul 1 - Jul 30, 2026");
  });

  test("labels the UTC day, not the viewer's local day, at a midnight boundary", () => {
    expect(
      formatDateRangeLabel({
        startTime: "2026-07-01T00:00:00.000Z",
        endTime: "2026-08-01T00:00:00.000Z",
      })
    ).toBe("Jul 1 - Aug 1, 2026");
  });

  test("formats a cross-year range with both years shown", () => {
    expect(
      formatDateRangeLabel({
        startTime: "2025-12-15T00:00:00.000Z",
        endTime: "2026-01-05T00:00:00.000Z",
      })
    ).toBe("Dec 15, 2025 - Jan 5, 2026");
  });
});

describe("granularityForRange", () => {
  const NOW_MS = Date.parse("2026-07-26T12:00:00.000Z");
  const windowOfSpan = (spanMs: number) => ({
    startTime: "2026-01-01T00:00:00.000Z",
    endTime: new Date(
      Date.parse("2026-01-01T00:00:00.000Z") + spanMs
    ).toISOString(),
  });

  test("exactly 6h resolves to 1m", () => {
    expect(granularityForRange(windowOfSpan(6 * HOUR_MS))).toBe("1m");
  });

  test("just over 6h resolves to 5m", () => {
    expect(granularityForRange(windowOfSpan(6 * HOUR_MS + 1))).toBe("5m");
  });

  test("exactly 1d resolves to 5m", () => {
    expect(granularityForRange(windowOfSpan(DAY_MS))).toBe("5m");
  });

  test("just over 1d resolves to 15m", () => {
    expect(granularityForRange(windowOfSpan(DAY_MS + 1))).toBe("15m");
  });

  test("exactly 3d resolves to 15m", () => {
    expect(granularityForRange(windowOfSpan(3 * DAY_MS))).toBe("15m");
  });

  test("just over 3d resolves to 1h", () => {
    expect(granularityForRange(windowOfSpan(3 * DAY_MS + 1))).toBe("1h");
  });

  test("exactly 14d resolves to 1h", () => {
    expect(granularityForRange(windowOfSpan(14 * DAY_MS))).toBe("1h");
  });

  test("exactly 30d resolves to 1h", () => {
    expect(granularityForRange(windowOfSpan(30 * DAY_MS))).toBe("1h");
  });

  test("just over 30d resolves to 6h", () => {
    expect(granularityForRange(windowOfSpan(30 * DAY_MS + 1))).toBe("6h");
  });

  test("exactly 90d resolves to 6h", () => {
    expect(granularityForRange(windowOfSpan(90 * DAY_MS))).toBe("6h");
  });

  test("just over 90d resolves to 1d", () => {
    expect(granularityForRange(windowOfSpan(90 * DAY_MS + 1))).toBe("1d");
  });

  test("last1h preset's window resolves to 1m granularity", () => {
    expect(granularityForRange(getPresetRange("last1h", NOW_MS))).toBe("1m");
  });

  test("last24h preset's window resolves to 5m granularity", () => {
    expect(granularityForRange(getPresetRange("last24h", NOW_MS))).toBe("5m");
  });
});

describe("granularityForSpeedtestRange", () => {
  const NOW_MS = Date.parse("2026-07-26T12:00:00.000Z");
  const windowOfSpan = (spanMs: number) => ({
    startTime: "2026-01-01T00:00:00.000Z",
    endTime: new Date(
      Date.parse("2026-01-01T00:00:00.000Z") + spanMs
    ).toISOString(),
  });
  const SEVEN_DAY_MS = 7 * DAY_MS;

  test("just under 7d requests no aggregation", () => {
    expect(
      granularityForSpeedtestRange(windowOfSpan(SEVEN_DAY_MS - 1))
    ).toBeUndefined();
  });

  test("exactly 7d requests the same aggregation granularityForRange would use", () => {
    const window = windowOfSpan(SEVEN_DAY_MS);
    expect(granularityForSpeedtestRange(window)).toBe(
      granularityForRange(window)
    );
    expect(granularityForSpeedtestRange(window)).toBe("1h");
  });

  test("just over 7d requests aggregation", () => {
    const window = windowOfSpan(SEVEN_DAY_MS + 1);
    expect(granularityForSpeedtestRange(window)).toBe(
      granularityForRange(window)
    );
  });

  test("a 30-day span aggregates into the same bucket a 30-day ping range would use", () => {
    const window = windowOfSpan(30 * DAY_MS);
    expect(granularityForSpeedtestRange(window)).toBe("1h");
    expect(granularityForSpeedtestRange(window)).toBe(
      granularityForRange(window)
    );
  });

  test("a well under 7d span (last24h preset) requests no aggregation", () => {
    expect(
      granularityForSpeedtestRange(getPresetRange("last24h", NOW_MS))
    ).toBeUndefined();
  });
});
