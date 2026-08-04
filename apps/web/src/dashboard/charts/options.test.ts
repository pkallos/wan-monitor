import EchartsTimeScale, {
  calcNiceForTimeScale,
} from "echarts/lib/scale/Time.js";
import { describe, expect, test } from "vitest";
import {
  type AxisTickInfo,
  computeSplitNumberForWidth,
  formatAxisLabel,
  formatTooltipHeader,
  makeJitterChartOption,
  makeLatencyChartOption,
  makePacketLossChartOption,
  makeSpeedChartOption,
  spansCalendarUnit,
} from "@/dashboard/charts/options";
import {
  calculateJitterStats,
  calculateLatencyStats,
  calculatePacketLossStats,
  calculateSpeedStats,
} from "@/dashboard/charts/stats";
import { fillTimeline } from "@/dashboard/charts/timeline";

const startMs = Date.parse("2026-07-26T10:00:00.000Z");
const endMs = Date.parse("2026-07-26T10:15:00.000Z");
const DEFAULT_SPLIT_NUMBER = 6;

// Every case below builds its ticks from local constructors — `new Date(y, m,
// d, ...)` — rather than UTC ISO strings, and asserts against the same
// `toLocale*` calls the implementation makes, so the suite stays correct
// regardless of the worker's timezone (vitest pins LC_ALL/LANG to en-US but
// not TZ — see vitest.config.ts).
const localMidnight = (year: number, month: number, day: number) =>
  new Date(year, month, day).getTime();
const localTime = (
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
  seconds = 0
) => new Date(year, month, day, hours, minutes, seconds).getTime();

const tick = (
  lowerTimeUnit: AxisTickInfo["lowerTimeUnit"],
  level = 0
): AxisTickInfo => ({ lowerTimeUnit, level });

describe("formatAxisLabel", () => {
  // Asserting a shape rather than a literal keeps these independent of the
  // worker's timezone, which shifts both the clock time and the calendar day.
  // No trailing `$` on the time-based patterns: a 12-hour locale (this
  // suite's pinned en-US included) appends " AM"/"PM".
  const TIME_OF_DAY = /^\d{1,2}:\d{2}/;
  const TIME_OF_DAY_WITH_SECONDS = /^\d{1,2}:\d{2}:\d{2}/;
  const HOUR_ONLY = /^\d{1,2}(\s?[AP]M)?$/i;
  const MONTH_AND_DAY = /^[A-Za-z]{3} \d{1,2}$/;
  const MONTH_ONLY = /^[A-Za-z]{3}$/;
  const YEAR_ONLY = /^\d{4}$/;
  const BARE_DAY = /^\d{1,2}$/;

  const window7d = {
    startMs: localMidnight(2026, 6, 29),
    endMs: localMidnight(2026, 7, 4),
  };
  const windowYtdSameYear = {
    startMs: localMidnight(2026, 0, 1),
    endMs: localMidnight(2026, 7, 4),
  };
  const windowYearCrossing = {
    startMs: localMidnight(2025, 7, 4),
    endMs: localMidnight(2026, 7, 4),
  };
  const windowWithinOneMonth = {
    startMs: localMidnight(2026, 6, 1),
    endMs: localMidnight(2026, 6, 20),
  };

  test("a minute-tier tick always carries hour and minute", () => {
    const value = localTime(2026, 6, 26, 14, 5);
    expect(formatAxisLabel(value, tick("minute"), window7d)).toMatch(
      TIME_OF_DAY
    );
  });

  test("second/millisecond ticks (reachable via a sub-minute custom range) carry full h:m:s", () => {
    const value = localTime(2026, 6, 26, 14, 5, 20);
    expect(formatAxisLabel(value, tick("second"), window7d)).toMatch(
      TIME_OF_DAY_WITH_SECONDS
    );
    expect(formatAxisLabel(value, tick("millisecond"), window7d)).toMatch(
      TIME_OF_DAY_WITH_SECONDS
    );
  });

  test("a tick with no time info at all falls back to the most detailed, unambiguous shape", () => {
    const value = localTime(2026, 6, 26, 14, 5, 20);
    expect(formatAxisLabel(value, undefined, window7d)).toMatch(
      TIME_OF_DAY_WITH_SECONDS
    );
  });

  describe("hour-tier: shortens to a bare hour only in 12-hour locales", () => {
    const value = localTime(2026, 6, 26, 14, 0);

    test("12-hour locale omits minutes", () => {
      expect(formatAxisLabel(value, tick("hour"), window7d, true)).toMatch(
        HOUR_ONLY
      );
    });

    test("24-hour locale keeps minutes (avoids e.g. German/French/Japanese widening)", () => {
      expect(formatAxisLabel(value, tick("hour"), window7d, false)).toMatch(
        TIME_OF_DAY
      );
    });
  });

  describe("day tier: self-anchors only when no coarser month tick will ever render", () => {
    test("bare day when the window spans multiple months (a month tick anchors it elsewhere)", () => {
      const value = localMidnight(2026, 6, 30);
      expect(formatAxisLabel(value, tick("day"), window7d)).toMatch(BARE_DAY);
    });

    test("month-and-day when the window stays within a single month (no anchor will ever exist)", () => {
      const value = localMidnight(2026, 6, 15);
      expect(formatAxisLabel(value, tick("day"), windowWithinOneMonth)).toMatch(
        MONTH_AND_DAY
      );
    });
  });

  test("month tier is always a bare month name — it only exists when the window already spans ≥2 months, so it's self-anchoring", () => {
    const value = localMidnight(2026, 7, 1);
    expect(formatAxisLabel(value, tick("month"), window7d)).toMatch(MONTH_ONLY);
  });

  describe("year tier: bare year only when the window actually crosses one", () => {
    test("same-year window (e.g. year to date) renders the year tick as a bare month", () => {
      const value = localMidnight(2026, 0, 1);
      expect(formatAxisLabel(value, tick("year"), windowYtdSameYear)).toMatch(
        MONTH_ONLY
      );
    });

    test("year-crossing window renders the year tick as the bare year", () => {
      const value = localMidnight(2026, 0, 1);
      expect(formatAxisLabel(value, tick("year"), windowYearCrossing)).toMatch(
        YEAR_ONLY
      );
    });
  });

  test("a window starting a few hours before local midnight doesn't falsely read as year-crossing", () => {
    // Regression for a real case: the "year to date" preset resolves its
    // start in UTC (dateRange.ts), which in a negative-UTC-offset zone lands
    // a few hours before local midnight on Dec 31 of the prior year even
    // though every tick that actually renders falls on or after Jan 1.
    const window = {
      startMs: localTime(2025, 11, 31, 16, 0),
      endMs: localMidnight(2026, 7, 4),
    };
    const value = localMidnight(2026, 4, 1);
    expect(formatAxisLabel(value, tick("month"), window)).toMatch(MONTH_ONLY);
  });

  test("wraps the label in echarts' own {primary|...} bold marker at level >= 1, matching what hideOverlap prioritizes", () => {
    const value = localMidnight(2026, 6, 30);
    expect(formatAxisLabel(value, tick("day", 0), window7d)).not.toContain(
      "{primary|"
    );
    expect(formatAxisLabel(value, tick("day", 1), window7d)).toBe(
      `{primary|${formatAxisLabel(value, tick("day", 0), window7d)}}`
    );
  });

  test("a local-midnight tick reads correctly through a DST transition", () => {
    // Spring-forward day in the US (2026-03-08); local getters, not epoch
    // arithmetic, drive both echarts' own tick placement and this label.
    const window = {
      startMs: localMidnight(2026, 2, 1),
      endMs: localMidnight(2026, 2, 15),
    };
    const value = localMidnight(2026, 2, 8);
    expect(formatAxisLabel(value, tick("day"), window)).toMatch(MONTH_AND_DAY);
  });
});

describe("spansCalendarUnit", () => {
  test("year: false within a single calendar year", () => {
    expect(
      spansCalendarUnit(
        "year",
        localMidnight(2026, 0, 1),
        localMidnight(2026, 7, 4)
      )
    ).toBe(false);
  });

  test("year: true across a genuine year boundary", () => {
    expect(
      spansCalendarUnit(
        "year",
        localMidnight(2025, 7, 4),
        localMidnight(2026, 7, 4)
      )
    ).toBe(true);
  });

  test("year: a UTC-resolved start a few hours before local midnight doesn't falsely cross", () => {
    expect(
      spansCalendarUnit(
        "year",
        localTime(2025, 11, 31, 16, 0),
        localMidnight(2026, 7, 4)
      )
    ).toBe(false);
  });

  test("month: false within a single calendar month", () => {
    expect(
      spansCalendarUnit(
        "month",
        localMidnight(2026, 6, 1),
        localMidnight(2026, 6, 20)
      )
    ).toBe(false);
  });

  test("month: true across a month boundary", () => {
    expect(
      spansCalendarUnit(
        "month",
        localMidnight(2026, 6, 29),
        localMidnight(2026, 7, 4)
      )
    ).toBe(true);
  });
});

describe("computeSplitNumberForWidth", () => {
  test("clamps to the minimum on a narrow phone width", () => {
    expect(computeSplitNumberForWidth(300)).toBe(4);
  });

  test("clamps to the maximum on a wide monitor width", () => {
    expect(computeSplitNumberForWidth(2000)).toBe(10);
  });

  test("interpolates between the clamps for a mid-range width", () => {
    const result = computeSplitNumberForWidth(700);
    expect(result).toBeGreaterThanOrEqual(4);
    expect(result).toBeLessThanOrEqual(10);
  });

  test("never goes negative for a width narrower than the grid margins", () => {
    expect(computeSplitNumberForWidth(10)).toBe(4);
  });
});

describe("formatTooltipHeader", () => {
  test("renders a full, localized date and time (not echarts' raw internal template)", () => {
    const value = localTime(2026, 7, 4, 14, 35);
    const header = formatTooltipHeader(value);

    expect(header).toBe(
      new Date(value).toLocaleString([], {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    );
    expect(header).not.toMatch(/^\d{4}-\d{2}-\d{2}/);
  });
});

// These generate ticks through echarts' own real TimeScale — the exact
// algorithm that produced both the "12am 12am 12am" regression and the
// missing-year regression this file used to hand-encode assumptions about.
// Deep-importing `echarts/lib/scale/Time.js` couples this suite to
// echarts@6.1.0's internal module layout (not its public `echarts`/
// `echarts/core` entry); if a dependency bump ever breaks this import or
// changes tick generation, the `formatAxisLabel`/`spansCalendarUnit` suites
// above remain sufficient on their own and this block can be deleted.
describe("real ECharts tick generation regression guards", () => {
  const realTicks = (
    windowStartMs: number,
    windowEndMs: number
  ): Array<{ value: number; time?: AxisTickInfo }> => {
    const scale = new EchartsTimeScale({ locale: undefined, useUTC: false });
    scale.setExtent(windowStartMs, windowEndMs);
    calcNiceForTimeScale(scale, { splitNumber: DEFAULT_SPLIT_NUMBER });
    return scale.getTicks();
  };

  const labelsFor = (windowStartMs: number, windowEndMs: number): string[] =>
    realTicks(windowStartMs, windowEndMs).map((t) =>
      formatAxisLabel(t.value, t.time, {
        startMs: windowStartMs,
        endMs: windowEndMs,
      })
    );

  test.each([
    ["7-day", localMidnight(2026, 6, 29), localMidnight(2026, 7, 4)],
    ["30-day", localMidnight(2026, 6, 5), localMidnight(2026, 7, 4)],
  ])(
    "%s window: no two adjacent real ticks render an identical label",
    (_name, windowStartMs, windowEndMs) => {
      const labels = labelsFor(windowStartMs, windowEndMs);
      expect(labels.length).toBeGreaterThan(1);
      for (let i = 1; i < labels.length; i++) {
        expect(labels[i]).not.toBe(labels[i - 1]);
      }
    }
  );

  test("year to date (same year): no real tick ever renders a bare 4-digit year", () => {
    const windowStartMs = localMidnight(2026, 0, 1);
    const windowEndMs = localMidnight(2026, 7, 4);
    const labels = labelsFor(windowStartMs, windowEndMs);

    expect(labels.some((label) => /\d{4}/.test(label))).toBe(false);
  });

  test("last 12 months (crosses a year): exactly one real tick renders the bare year", () => {
    const windowStartMs = localMidnight(2025, 7, 4);
    const windowEndMs = localMidnight(2026, 7, 4);
    const labels = labelsFor(windowStartMs, windowEndMs);
    const yearLabels = labels.filter((label) =>
      /^\{primary\|\d{4}\}$/.test(label)
    );

    expect(yearLabels).toHaveLength(1);
  });

  test("7-day window crossing a month boundary: the month appears exactly once, anchoring the bare day ticks around it", () => {
    const windowStartMs = localMidnight(2026, 6, 29);
    const windowEndMs = localMidnight(2026, 7, 4);
    const ticks = realTicks(windowStartMs, windowEndMs);
    const monthTicks = ticks.filter((t) => t.time?.lowerTimeUnit === "month");
    const dayTicks = ticks.filter((t) => t.time?.lowerTimeUnit === "day");

    expect(monthTicks).toHaveLength(1);
    expect(dayTicks.length).toBeGreaterThan(0);
    for (const dayTick of dayTicks) {
      const label = formatAxisLabel(dayTick.value, dayTick.time, {
        startMs: windowStartMs,
        endMs: windowEndMs,
      });
      expect(label.replace(/\{primary\||\}/g, "")).toMatch(/^\d{1,2}$/);
    }
  });
});

describe("makeLatencyChartOption", () => {
  const metrics = [{ timestamp: "2026-07-26T10:05:30.000Z", latency: 20 }];
  const slots = fillTimeline(metrics, startMs, endMs, "5m");
  const stats = calculateLatencyStats(metrics);

  test("plots one [timestamp, value] pair per slot, nulling gaps", () => {
    const option = makeLatencyChartOption({
      slots,
      stats,
      theme: "light",
      startMs,
      endMs,
      splitNumber: DEFAULT_SPLIT_NUMBER,
    });
    const series = option.series as Array<{
      data: Array<[number, number | null]>;
    }>;

    expect(series[0].data).toEqual([
      [startMs, null],
      [startMs + 5 * 60_000, 20],
      [startMs + 10 * 60_000, null],
    ]);
  });

  test("draws an average reference line when there is data", () => {
    const option = makeLatencyChartOption({
      slots,
      stats,
      theme: "light",
      startMs,
      endMs,
      splitNumber: DEFAULT_SPLIT_NUMBER,
    });
    const series = option.series as Array<{
      markLine?: { data: Array<{ yAxis: number }> };
    }>;

    expect(series[0].markLine?.data[0].yAxis).toBe(20);
  });

  test("omits the reference line when there is no data", () => {
    const emptySlots = fillTimeline([], startMs, endMs, "5m");
    const option = makeLatencyChartOption({
      slots: emptySlots,
      stats: calculateLatencyStats([]),
      theme: "light",
      startMs,
      endMs,
      splitNumber: DEFAULT_SPLIT_NUMBER,
    });
    const series = option.series as Array<{ markLine?: unknown }>;

    expect(series[0].markLine).toBeUndefined();
  });

  test("sets an explicit xAxis domain and splitNumber from the resolved window and chart width", () => {
    const option = makeLatencyChartOption({
      slots,
      stats,
      theme: "light",
      startMs,
      endMs,
      splitNumber: 8,
    });
    const xAxis = option.xAxis as {
      min: number;
      max: number;
      splitNumber: number;
    };

    expect(xAxis.min).toBe(startMs);
    expect(xAxis.max).toBe(endMs);
    expect(xAxis.splitNumber).toBe(8);
  });

  test("labels the x-axis through the tick-tier-aware formatter", () => {
    const option = makeLatencyChartOption({
      slots,
      stats,
      theme: "light",
      startMs,
      endMs,
      splitNumber: DEFAULT_SPLIT_NUMBER,
    });
    const xAxis = option.xAxis as {
      axisLabel: {
        formatter: (
          value: number,
          index: number,
          extra?: { time?: AxisTickInfo }
        ) => string;
      };
    };
    const extra = { time: tick("minute") };

    expect(xAxis.axisLabel.formatter(startMs, 0, extra)).toBe(
      formatAxisLabel(startMs, extra.time, { startMs, endMs })
    );
  });

  test("reports the tooltip header and formatted value through the custom formatter", () => {
    const option = makeLatencyChartOption({
      slots,
      stats,
      theme: "light",
      startMs,
      endMs,
      splitNumber: DEFAULT_SPLIT_NUMBER,
    });
    const tooltip = option.tooltip as {
      formatter: (params: unknown) => string;
    };
    const params = [
      {
        axisValue: startMs,
        marker: "<span/>",
        seriesName: "Latency",
        value: [startMs, 12.34],
      },
    ];

    const rendered = tooltip.formatter(params);
    expect(rendered).toContain(formatTooltipHeader(startMs));
    expect(rendered).toContain("<span/>Latency: 12.3 ms");
  });
});

describe("makePacketLossChartOption", () => {
  const metrics = [{ timestamp: "2026-07-26T10:05:00.000Z", packet_loss: 2 }];

  test("plots a plain danger-colored line with no severity-band shading", () => {
    const option = makePacketLossChartOption({
      slots: fillTimeline(metrics, startMs, endMs, "5m"),
      stats: calculatePacketLossStats(metrics),
      theme: "light",
      startMs,
      endMs,
      splitNumber: DEFAULT_SPLIT_NUMBER,
    });
    const series = option.series as Array<{
      lineStyle: { color: string };
      markArea?: unknown;
    }>;

    expect(series[0].lineStyle.color).toBe("#e53e3e");
    expect(series[0].markArea).toBeUndefined();
  });

  test("sets an explicit xAxis domain from the resolved window bounds", () => {
    const option = makePacketLossChartOption({
      slots: fillTimeline(metrics, startMs, endMs, "5m"),
      stats: calculatePacketLossStats(metrics),
      theme: "light",
      startMs,
      endMs,
      splitNumber: DEFAULT_SPLIT_NUMBER,
    });
    const xAxis = option.xAxis as { min: number; max: number };

    expect(xAxis.min).toBe(startMs);
    expect(xAxis.max).toBe(endMs);
  });

  test("plots 0% loss as a real value and a missing slot as a gap, with no point markers", () => {
    const zeroLossMetrics = [
      { timestamp: "2026-07-26T10:05:00.000Z", packet_loss: 0 },
    ];
    const option = makePacketLossChartOption({
      slots: fillTimeline(zeroLossMetrics, startMs, endMs, "5m"),
      stats: calculatePacketLossStats(zeroLossMetrics),
      theme: "light",
      startMs,
      endMs,
      splitNumber: DEFAULT_SPLIT_NUMBER,
    });
    const series = option.series as Array<{
      data: Array<[number, number | null]>;
      showSymbol: boolean;
      connectNulls: boolean;
    }>;

    expect(series[0].data).toEqual([
      [startMs, null],
      [startMs + 5 * 60_000, 0],
      [startMs + 10 * 60_000, null],
    ]);
    expect(series[0].showSymbol).toBe(false);
    expect(series[0].connectNulls).toBe(false);
  });
});

describe("makeJitterChartOption", () => {
  const metrics = [{ timestamp: "2026-07-26T10:05:00.000Z", jitter: 3 }];

  test("draws the acceptable-jitter threshold line at 10ms", () => {
    const option = makeJitterChartOption({
      slots: fillTimeline(metrics, startMs, endMs, "5m"),
      stats: calculateJitterStats(metrics),
      theme: "light",
      startMs,
      endMs,
      splitNumber: DEFAULT_SPLIT_NUMBER,
    });
    const series = option.series as Array<{
      markLine: { data: Array<{ yAxis: number }> };
      areaStyle: unknown;
    }>;

    expect(series[0].markLine.data[0].yAxis).toBe(10);
    expect(series[0].areaStyle).toBeDefined();
  });

  test("sets an explicit xAxis domain from the resolved window bounds", () => {
    const option = makeJitterChartOption({
      slots: fillTimeline(metrics, startMs, endMs, "5m"),
      stats: calculateJitterStats(metrics),
      theme: "light",
      startMs,
      endMs,
      splitNumber: DEFAULT_SPLIT_NUMBER,
    });
    const xAxis = option.xAxis as { min: number; max: number };

    expect(xAxis.min).toBe(startMs);
    expect(xAxis.max).toBe(endMs);
  });
});

describe("makeSpeedChartOption", () => {
  test("plots download and upload as two independent series with no gap filling", () => {
    const metrics = [
      {
        timestamp: "2026-07-26T10:00:00.000Z",
        download_speed: 100,
        upload_speed: 10,
      },
      {
        timestamp: "2026-07-26T10:07:00.000Z",
        download_speed: 200,
        upload_speed: 20,
      },
    ];

    const option = makeSpeedChartOption({
      metrics,
      stats: calculateSpeedStats(metrics),
      theme: "light",
      startMs,
      endMs,
      splitNumber: DEFAULT_SPLIT_NUMBER,
    });
    const series = option.series as Array<{
      name: string;
      data: Array<[number, number]>;
    }>;

    expect(series).toHaveLength(2);
    expect(series[0].name).toBe("Download");
    expect(series[0].data).toEqual([
      [Date.parse("2026-07-26T10:00:00.000Z"), 100],
      [Date.parse("2026-07-26T10:07:00.000Z"), 200],
    ]);
    expect(series[1].name).toBe("Upload");
  });

  test("reserves grid space so the bottom legend doesn't overlap the plot area", () => {
    const option = makeSpeedChartOption({
      metrics: [],
      stats: calculateSpeedStats([]),
      theme: "light",
      startMs,
      endMs,
      splitNumber: DEFAULT_SPLIT_NUMBER,
    });
    const grid = option.grid as { bottom: number };
    const legend = option.legend as { bottom: number };

    expect(legend.bottom).toBeDefined();
    expect(grid.bottom).toBeGreaterThan(legend.bottom);
  });

  test("sets an explicit xAxis domain from the resolved window bounds", () => {
    const option = makeSpeedChartOption({
      metrics: [],
      stats: calculateSpeedStats([]),
      theme: "light",
      startMs,
      endMs,
      splitNumber: DEFAULT_SPLIT_NUMBER,
    });
    const xAxis = option.xAxis as { min: number; max: number };

    expect(xAxis.min).toBe(startMs);
    expect(xAxis.max).toBe(endMs);
  });

  test("labels the x-axis through the same tick-tier-aware formatter as the other charts", () => {
    const option = makeSpeedChartOption({
      metrics: [],
      stats: calculateSpeedStats([]),
      theme: "light",
      startMs,
      endMs,
      splitNumber: DEFAULT_SPLIT_NUMBER,
    });
    const xAxis = option.xAxis as {
      axisLabel: {
        formatter: (
          value: number,
          index: number,
          extra?: { time?: AxisTickInfo }
        ) => string;
      };
    };
    const extra = { time: tick("minute") };

    expect(xAxis.axisLabel.formatter(startMs, 0, extra)).toBe(
      formatAxisLabel(startMs, extra.time, { startMs, endMs })
    );
    expect(xAxis.axisLabel.formatter(startMs, 0, extra)).toMatch(
      /^\d{1,2}:\d{2}/
    );
  });
});
