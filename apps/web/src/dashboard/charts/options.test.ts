import { PACKET_LOSS_THRESHOLDS } from "@wan-monitor/shared";
import EchartsTimeScale, {
  calcNiceForTimeScale,
} from "echarts/lib/scale/Time.js";
import { Schema as S } from "effect";
import { describe, expect, test } from "vitest";
import type { ChartPalette } from "@/dashboard/charts/chartTheme";
import {
  type AxisTickInfo,
  computeSplitNumberForWidth,
  formatAxisLabel,
  formatTooltipHeader,
  LATENCY_THRESHOLD_MS,
  makeJitterChartOption,
  makeLatencyChartOption,
  makePacketLossChartOption,
  makeSpeedChartOption,
  spansCalendarUnit,
} from "@/dashboard/charts/options";
import { calculateLatencyStats } from "@/dashboard/charts/stats";
import { fillTimeline } from "@/dashboard/charts/timeline";

const startMs = Date.parse("2026-07-26T10:00:00.000Z");
const endMs = Date.parse("2026-07-26T10:15:00.000Z");
const DEFAULT_SPLIT_NUMBER = 6;

// Deliberately not the app's real token values: every assertion below proves
// a colour is threaded through from the palette, never hardcoded.
const PALETTE: ChartPalette = {
  card: "#c0",
  ink: "#c1",
  inkSecondary: "#c2",
  rule: "#c3",
  accent: "#c4",
  degraded: "#c5",
  down: "#c6",
  band: "rgba(1, 2, 3, 0.4)",
  series: ["#s1", "#s2", "#s3", "#s4", "#s5", "#s6"],
  fontFamily: "Test Sans",
};

// Each assertion reads the part of a built option it is about through a
// schema, so a changed shape fails the test instead of reading `undefined`.
const decodeSeries = <A, I>(schema: S.Codec<A, I>, part: unknown): A =>
  S.decodeUnknownSync(schema)(part);

const Point = S.Tuple([S.Number, S.NullOr(S.Number)]);
const PlottedSeries = S.Array(S.Struct({ data: S.Array(Point) }));

const isFunction = (input: unknown): input is (...args: never[]) => unknown =>
  typeof input === "function";
const AxisLabelFormatter = S.declare(
  (
    input: unknown
  ): input is (
    value: number,
    index: number,
    extra?: { time?: AxisTickInfo }
  ) => string => isFunction(input)
);
const TooltipFormatter = S.declare(
  (input: unknown): input is (params: unknown) => string => isFunction(input)
);

const XAxis = S.Struct({
  min: S.Number,
  max: S.Number,
  splitNumber: S.Number,
  axisLabel: S.Struct({ formatter: AxisLabelFormatter, color: S.String }),
  splitLine: S.Struct({ lineStyle: S.Struct({ color: S.String }) }),
});
const YAxis = S.Struct({
  axisLabel: S.Struct({ color: S.String }),
  splitLine: S.Struct({ lineStyle: S.Struct({ color: S.String }) }),
});
const Tooltip = S.Struct({
  formatter: TooltipFormatter,
  backgroundColor: S.String,
  borderColor: S.String,
  textStyle: S.Struct({ color: S.String, fontFamily: S.String }),
  extraCssText: S.String,
});

const MarkLabel = S.Struct({
  show: S.optional(S.Boolean),
  formatter: S.optional(S.String),
  position: S.optional(S.String),
  color: S.optional(S.String),
  backgroundColor: S.optional(S.String),
  offset: S.optional(S.Tuple([S.Number, S.Number])),
});
const MarkLineDatum = S.Struct({
  xAxis: S.optional(S.Number),
  yAxis: S.optional(S.Number),
  lineStyle: S.optional(
    S.Struct({
      color: S.optional(S.String),
      type: S.optional(S.String),
      width: S.optional(S.Number),
    })
  ),
  label: S.optional(MarkLabel),
});
const AreaEdge = S.Struct({
  xAxis: S.optional(S.Number),
  yAxis: S.optional(S.Union([S.Number, S.Literal("max")])),
  itemStyle: S.optional(S.Struct({ color: S.String, opacity: S.Number })),
});
const MarkedSeries = S.Array(
  S.Struct({
    markArea: S.optional(
      S.Struct({
        silent: S.Boolean,
        data: S.Array(S.Tuple([AreaEdge, AreaEdge])),
      })
    ),
    markLine: S.optional(S.Struct({ data: S.Array(MarkLineDatum) })),
  })
);

const MedianLine = S.Struct({
  yAxis: S.Number,
  lineStyle: S.Struct({ color: S.String }),
  label: S.Struct({
    formatter: S.String,
    position: S.String,
    color: S.String,
    offset: S.optional(S.Tuple([S.Number, S.Number])),
  }),
});
const SpeedSeries = S.Array(
  S.Struct({
    type: S.String,
    name: S.String,
    data: S.Array(Point),
    markLine: S.optional(S.Struct({ data: S.Array(MedianLine) })),
    lineStyle: S.optional(
      S.Struct({ width: S.Number, color: S.optional(S.String) })
    ),
    itemStyle: S.optional(S.Struct({ color: S.optional(S.String) })),
    symbol: S.optional(S.String),
  })
);

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
  const build = (
    overrides: Partial<Parameters<typeof makeLatencyChartOption>[0]> = {}
  ) =>
    makeLatencyChartOption({
      slots,
      stats,
      palette: PALETTE,
      incidents: [],
      startMs,
      endMs,
      splitNumber: DEFAULT_SPLIT_NUMBER,
      ...overrides,
    });

  test("plots one [timestamp, value] pair per slot, nulling gaps", () => {
    const series = decodeSeries(PlottedSeries, build().series);

    expect(series[0].data).toEqual([
      [startMs, null],
      [startMs + 5 * 60_000, 20],
      [startMs + 10 * 60_000, null],
    ]);
  });

  test("draws an average reference line when there is data", () => {
    const [series] = decodeSeries(MarkedSeries, build().series);

    expect(series.markLine?.data[0].yAxis).toBe(20);
  });

  test("names the average with its value, at the end of the line", () => {
    const [series] = decodeSeries(MarkedSeries, build().series);
    const average = series.markLine?.data[0].label;

    expect(average?.formatter).toBe("Avg 20.0 ms");
    expect(average?.position).toBe("insideEndTop");
    expect(average?.color).toBe(PALETTE.inkSecondary);
    expect(average?.backgroundColor).toBe(PALETTE.card);
  });

  test("averages the p50 line it crosses, not the latency of the same buckets", () => {
    const rows = [
      {
        timestamp: "2026-07-26T10:00:00.000Z",
        latency: 90,
        latency_p50: 10,
        latency_p95: 95,
      },
      {
        timestamp: "2026-07-26T10:05:00.000Z",
        latency: 90,
        latency_p50: 30,
        latency_p95: 95,
      },
    ];
    const [series] = decodeSeries(
      MarkedSeries,
      build({
        slots: fillTimeline(rows, startMs, endMs, "5m"),
        stats: calculateLatencyStats(rows),
      }).series
    );

    expect(series.markLine?.data[0].yAxis).toBe(20);
    expect(series.markLine?.data[0].label?.formatter).toBe("Avg 20.0 ms");
  });

  test("omits the reference line when there is no data", () => {
    const [series] = decodeSeries(
      MarkedSeries,
      build({
        slots: fillTimeline([], startMs, endMs, "5m"),
        stats: calculateLatencyStats([]),
      }).series
    );

    expect(series.markLine).toBeUndefined();
  });

  test("sets an explicit xAxis domain and splitNumber from the resolved window and chart width", () => {
    const xAxis = decodeSeries(XAxis, build({ splitNumber: 8 }).xAxis);

    expect(xAxis.min).toBe(startMs);
    expect(xAxis.max).toBe(endMs);
    expect(xAxis.splitNumber).toBe(8);
  });

  test("labels the x-axis through the tick-tier-aware formatter", () => {
    const { axisLabel } = decodeSeries(XAxis, build().xAxis);
    const extra = { time: tick("minute") };

    expect(axisLabel.formatter(startMs, 0, extra)).toBe(
      formatAxisLabel(startMs, extra.time, { startMs, endMs })
    );
  });

  test("reports the tooltip header and formatted value through the custom formatter", () => {
    const { formatter } = decodeSeries(Tooltip, build().tooltip);
    const rendered = formatter([
      {
        axisValue: startMs,
        marker: "<span/>",
        seriesName: "Latency",
        value: [startMs, 12.34],
      },
    ]);

    expect(rendered).toContain(formatTooltipHeader(startMs));
    expect(rendered).toContain("<span/>Latency: 12.3 ms");
  });
});

describe("makePacketLossChartOption", () => {
  const metrics = [{ timestamp: "2026-07-26T10:05:00.000Z", packet_loss: 2 }];

  const lossOption = (slots = fillTimeline(metrics, startMs, endMs, "5m")) =>
    makePacketLossChartOption({
      slots,
      palette: PALETTE,
      incidents: [],
      startMs,
      endMs,
      splitNumber: DEFAULT_SPLIT_NUMBER,
    });

  test("draws one danger-colored bar per bucket rather than a line", () => {
    const [series] = decodeSeries(
      S.Array(
        S.Struct({
          type: S.String,
          itemStyle: S.Struct({ color: S.String }),
          barMinWidth: S.Number,
        })
      ),
      lossOption().series
    );

    expect(series.type).toBe("bar");
    expect(series.itemStyle.color).toBe(PALETTE.down);
    expect(series.barMinWidth).toBeGreaterThanOrEqual(1);
  });

  test("draws one dashed line at the loss threshold, named for the status it triggers", () => {
    const heavy = [{ timestamp: "2026-07-26T10:05:00.000Z", packet_loss: 80 }];
    const [series] = decodeSeries(
      MarkedSeries,
      lossOption(fillTimeline(heavy, startMs, endMs, "5m")).series
    );

    expect(series.markArea).toBeUndefined();
    expect(series.markLine?.data).toEqual([
      {
        yAxis: PACKET_LOSS_THRESHOLDS.degradedFloor,
        lineStyle: { color: PALETTE.inkSecondary, type: "dashed", width: 1 },
        label: expect.objectContaining({
          show: true,
          position: "insideStartTop",
          formatter: "Degraded at 10%",
          color: PALETTE.inkSecondary,
          backgroundColor: PALETTE.card,
        }),
      },
    ]);
  });

  test("draws no line when the loss stays under the threshold, so no label floats above the plot", () => {
    const [series] = decodeSeries(MarkedSeries, lossOption().series);

    expect(series.markArea).toBeUndefined();
    expect(series.markLine).toBeUndefined();
  });

  test("sets an explicit xAxis domain from the resolved window bounds", () => {
    const xAxis = decodeSeries(XAxis, lossOption().xAxis);

    expect(xAxis.min).toBe(startMs);
    expect(xAxis.max).toBe(endMs);
  });

  test("plots 0% loss as a real value and a missing slot as a gap", () => {
    const zeroLossMetrics = [
      { timestamp: "2026-07-26T10:05:00.000Z", packet_loss: 0 },
    ];
    const [series] = decodeSeries(
      PlottedSeries,
      lossOption(fillTimeline(zeroLossMetrics, startMs, endMs, "5m")).series
    );

    expect(series.data).toEqual([
      [startMs, null],
      [startMs + 5 * 60_000, 0],
      [startMs + 10 * 60_000, null],
    ]);
  });

  test("zooms with the other quality charts", () => {
    expect(lossOption().dataZoom).toEqual([
      expect.objectContaining({ type: "inside", xAxisIndex: 0 }),
    ]);
  });

  test("shows a bucket's loss to two decimals in the tooltip", () => {
    const { formatter } = decodeSeries(Tooltip, lossOption().tooltip);

    expect(
      formatter([
        {
          axisValue: startMs,
          marker: "",
          seriesName: "Packet loss",
          value: [startMs, 0.5],
        },
      ])
    ).toContain("Packet loss: 0.50%");
  });
});

describe("makeJitterChartOption", () => {
  const metrics = [{ timestamp: "2026-07-26T10:05:00.000Z", jitter: 3 }];
  const jitterOption = () =>
    makeJitterChartOption({
      slots: fillTimeline(metrics, startMs, endMs, "5m"),
      palette: PALETTE,
      incidents: [],
      startMs,
      endMs,
      splitNumber: DEFAULT_SPLIT_NUMBER,
    });

  test("draws the acceptable-jitter reference line at 10ms, named as a reference", () => {
    const [series] = decodeSeries(
      S.Array(
        S.Struct({
          markLine: S.Struct({ data: S.Array(MarkLineDatum) }),
          areaStyle: S.Unknown,
        })
      ),
      jitterOption().series
    );

    expect(series.markLine.data[0].yAxis).toBe(10);
    expect(series.markLine.data[0].label).toEqual(
      expect.objectContaining({
        formatter: "Reference 10 ms",
        position: "insideStartTop",
      })
    );
    expect(series.areaStyle).toBeDefined();
  });

  test("sets an explicit xAxis domain from the resolved window bounds", () => {
    const xAxis = decodeSeries(XAxis, jitterOption().xAxis);

    expect(xAxis.min).toBe(startMs);
    expect(xAxis.max).toBe(endMs);
  });

  test("shows a bucket's jitter to two decimals in the tooltip", () => {
    const { formatter } = decodeSeries(Tooltip, jitterOption().tooltip);

    expect(
      formatter([
        {
          axisValue: startMs,
          marker: "",
          seriesName: "Jitter",
          value: [startMs, 2],
        },
      ])
    ).toContain("Jitter: 2.00 ms");
  });
});

describe("makeSpeedChartOption", () => {
  const HOUR_MS = 3_600_000;
  const speedOption = (
    metrics: Parameters<typeof makeSpeedChartOption>[0]["metrics"]
  ) =>
    makeSpeedChartOption({
      metrics,
      palette: PALETTE,
      startMs,
      endMs,
      splitNumber: DEFAULT_SPLIT_NUMBER,
    });
  const tests = (gapMs: number, count = 4) =>
    Array.from({ length: count }, (_, i) => ({
      timestamp: new Date(startMs + i * gapMs).toISOString(),
      download_speed: 100 + i * 100,
      upload_speed: 10 + i * 10,
    }));

  test("plots each download and upload test as a point of its own", () => {
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
    const series = decodeSeries(SpeedSeries, speedOption(metrics).series);
    const scatter = series.filter((entry) => entry.type === "scatter");

    expect(scatter.map((entry) => entry.name)).toEqual(["Download", "Upload"]);
    expect(scatter[0].data).toEqual([
      [Date.parse("2026-07-26T10:00:00.000Z"), 100],
      [Date.parse("2026-07-26T10:07:00.000Z"), 200],
    ]);
  });

  test("draws download in the first series colour and upload in the second", () => {
    const series = decodeSeries(
      SpeedSeries,
      speedOption(tests(HOUR_MS)).series
    );
    const [download, upload] = series.filter(
      (entry) => entry.type === "scatter"
    );

    expect(download.itemStyle?.color).toBe(PALETTE.series[0]);
    expect(upload.itemStyle?.color).toBe(PALETTE.series[1]);
    expect(download.itemStyle?.color).not.toBe(upload.itemStyle?.color);
  });

  test("keeps a different point shape for each series so colour is not the only cue", () => {
    const series = decodeSeries(
      SpeedSeries,
      speedOption(tests(HOUR_MS)).series
    );
    const [download, upload] = series.filter(
      (entry) => entry.type === "scatter"
    );

    expect(download.symbol).not.toBe(upload.symbol);
  });

  test("colours each joining line and median line like its own series", () => {
    const series = decodeSeries(
      SpeedSeries,
      speedOption(tests(HOUR_MS)).series
    );
    const joins = series.filter(
      (entry) => entry.type === "line" && entry.data.length > 0
    );
    const median = series.find((entry) => entry.name === "Median");
    const medianLines = (median?.markLine?.data ?? []).flatMap((line) => [
      line.lineStyle?.color,
      line.label.color,
    ]);

    expect(joins.map((line) => line.lineStyle?.color)).toEqual([
      PALETTE.series[0],
      PALETTE.series[1],
    ]);
    expect(medianLines).toEqual([
      PALETTE.series[0],
      PALETTE.series[0],
      PALETTE.series[1],
      PALETTE.series[1],
    ]);
  });

  test("keeps the Median legend entry neutral", () => {
    const series = decodeSeries(
      SpeedSeries,
      speedOption(tests(HOUR_MS)).series
    );
    const median = series.find((entry) => entry.name === "Median");

    expect(median?.lineStyle?.color).toBe(PALETTE.inkSecondary);
    expect(median?.itemStyle?.color).toBe(PALETTE.inkSecondary);
  });

  test("joins the points with a thin line when tests come hourly or more often", () => {
    const series = decodeSeries(
      SpeedSeries,
      speedOption(tests(HOUR_MS)).series
    );
    const lines = series.filter(
      (entry) => entry.type === "line" && entry.data.length > 0
    );

    expect(lines).toHaveLength(2);
    expect(lines.every((line) => (line.lineStyle?.width ?? 0) <= 1)).toBe(true);
  });

  test("draws only points when tests are further apart than that", () => {
    const series = decodeSeries(
      SpeedSeries,
      speedOption(tests(6 * HOUR_MS)).series
    );

    expect(
      series.filter((entry) => entry.type === "line" && entry.data.length > 0)
    ).toEqual([]);
  });

  test("draws a median reference line for download and upload, labelled with its figure", () => {
    const series = decodeSeries(
      SpeedSeries,
      speedOption(tests(HOUR_MS)).series
    );
    const median = series.find((entry) => entry.name === "Median");

    expect(median?.markLine?.data.map((line) => line.yAxis)).toEqual([250, 25]);
    expect(median?.markLine?.data.map((line) => line.label.formatter)).toEqual([
      "250 Mbps",
      "25 Mbps",
    ]);
  });

  // Two tests at `download` and a single outlier at `peak` keep the download
  // median at `download` while stretching the axis.
  const medianLabels = (download: number, upload: number, peak = download) => {
    const series = decodeSeries(
      SpeedSeries,
      speedOption(
        [download, download, peak].map((speed, i) => ({
          timestamp: new Date(startMs + i * HOUR_MS).toISOString(),
          download_speed: speed,
          upload_speed: upload,
        }))
      ).series
    );
    const median = series.find((entry) => entry.name === "Median");
    return (median?.markLine?.data ?? []).map((line) => line.label);
  };

  test("puts both median labels above their lines when the medians are far apart", () => {
    expect(medianLabels(900, 40).map((label) => label.position)).toEqual([
      "insideEndTop",
      "insideEndTop",
    ]);
  });

  test("puts the lower median label below its line when the medians are close and well clear of the axis", () => {
    expect(medianLabels(910, 906).map((label) => label.position)).toEqual([
      "insideEndTop",
      "insideEndBottom",
    ]);
  });

  test("treats medians as close by the plotted range, not by the higher median", () => {
    const labels = medianLabels(10, 9, 150);

    expect(labels[0].offset).not.toEqual(labels[1].offset);
  });

  test("keeps both labels above the axis, stacked, when close medians sit at the bottom", () => {
    const labels = medianLabels(20, 19, 500);

    expect(labels.map((label) => label.position)).toEqual([
      "insideEndTop",
      "insideEndTop",
    ]);
    expect(labels[0].offset).not.toEqual(labels[1].offset);
  });

  test("puts the lower label below its line whichever direction is higher, when clear of the axis", () => {
    expect(medianLabels(30, 38, 100)).toEqual([
      expect.objectContaining({ position: "insideEndBottom" }),
      expect.objectContaining({ position: "insideEndTop" }),
    ]);
  });

  test("lifts the higher label by one label height when the lower line is near the axis", () => {
    const uploadHigher = medianLabels(3, 5, 100);
    const downloadHigher = medianLabels(3, 2, 100);

    expect(uploadHigher[0].offset).toBeUndefined();
    expect(uploadHigher[1].offset).toEqual([0, -16]);
    expect(downloadHigher[0].offset).toEqual([0, -16]);
    expect(downloadHigher[1].offset).toBeUndefined();
    for (const label of [...uploadHigher, ...downloadHigher]) {
      expect(label.position).toBe("insideEndTop");
    }
  });

  test("medians a tenth of the plotted range apart are far enough apart to stay above their lines", () => {
    expect(medianLabels(50, 60, 100)).toEqual([
      expect.objectContaining({ position: "insideEndTop" }),
      expect.objectContaining({ position: "insideEndTop" }),
    ]);
    expect(medianLabels(50, 60, 100).map((label) => label.offset)).toEqual([
      undefined,
      undefined,
    ]);
  });

  test("a line exactly at the near-axis limit still takes a label below it", () => {
    expect(medianLabels(8, 10, 100)).toEqual([
      expect.objectContaining({ position: "insideEndBottom" }),
      expect.objectContaining({ position: "insideEndTop" }),
    ]);
  });

  test("a direction with no median keeps its other label where it is, whatever the plotted range", () => {
    const series = decodeSeries(
      SpeedSeries,
      speedOption(
        [5, 5, 100].map((speed, i) => ({
          timestamp: new Date(startMs + i * HOUR_MS).toISOString(),
          download_speed: speed,
        }))
      ).series
    );
    const lines =
      series.find((entry) => entry.name === "Median")?.markLine?.data ?? [];

    expect(lines.map((line) => line.label)).toEqual([
      expect.objectContaining({ position: "insideEndTop" }),
    ]);
    expect(lines[0].label.offset).toBeUndefined();
  });

  test("equal medians near the axis lift the download label and leave the upload one", () => {
    const labels = medianLabels(5, 5, 100);

    expect(labels.map((label) => label.offset)).toEqual([[0, -16], undefined]);
  });

  test("equal medians clear of the axis put the upload label below its line", () => {
    expect(medianLabels(50, 50, 100).map((label) => label.position)).toEqual([
      "insideEndTop",
      "insideEndBottom",
    ]);
  });

  test("draws no median line for a metric with no measured tests", () => {
    const series = decodeSeries(SpeedSeries, speedOption([]).series);
    const median = series.find((entry) => entry.name === "Median");

    expect(median?.markLine?.data).toEqual([]);
  });

  test("names only Download, Upload and Median in the legend", () => {
    const legend = decodeSeries(
      S.Struct({ data: S.Array(S.String) }),
      speedOption(tests(HOUR_MS)).legend
    );

    expect(legend.data).toEqual(["Download", "Upload", "Median"]);
  });

  test("shows a test's speed to one decimal in the tooltip", () => {
    const { formatter } = decodeSeries(
      Tooltip,
      speedOption(tests(HOUR_MS)).tooltip
    );

    expect(
      formatter([
        {
          axisValue: startMs,
          marker: "",
          seriesName: "Download",
          value: [startMs, 107.46],
        },
      ])
    ).toContain("Download: 107.5 Mbps");
  });

  test("keeps the connecting lines out of the tooltip rows", () => {
    const option = speedOption(tests(HOUR_MS));
    const { formatter } = decodeSeries(Tooltip, option.tooltip);
    const text = formatter([
      { axisValue: startMs, marker: "", seriesName: "Download", value: [0, 1] },
      {
        axisValue: startMs,
        marker: "",
        seriesName: "Download line",
        value: [0, 1],
      },
    ]);

    expect(text.match(/Download/g)).toHaveLength(1);
  });

  test("reserves grid space so the bottom legend doesn't overlap the plot area", () => {
    const option = makeSpeedChartOption({
      metrics: [],
      palette: PALETTE,
      startMs,
      endMs,
      splitNumber: DEFAULT_SPLIT_NUMBER,
    });
    const grid = decodeSeries(S.Struct({ bottom: S.Number }), option.grid);
    const legend = decodeSeries(S.Struct({ bottom: S.Number }), option.legend);

    expect(legend.bottom).toBeDefined();
    expect(grid.bottom).toBeGreaterThan(legend.bottom);
  });

  test("sets an explicit xAxis domain from the resolved window bounds", () => {
    const option = makeSpeedChartOption({
      metrics: [],
      palette: PALETTE,
      startMs,
      endMs,
      splitNumber: DEFAULT_SPLIT_NUMBER,
    });
    const xAxis = decodeSeries(XAxis, option.xAxis);

    expect(xAxis.min).toBe(startMs);
    expect(xAxis.max).toBe(endMs);
  });

  test("labels the x-axis through the same tick-tier-aware formatter as the other charts", () => {
    const option = makeSpeedChartOption({
      metrics: [],
      palette: PALETTE,
      startMs,
      endMs,
      splitNumber: DEFAULT_SPLIT_NUMBER,
    });
    const xAxis = decodeSeries(XAxis, option.xAxis);
    const extra = { time: tick("minute") };

    expect(xAxis.axisLabel.formatter(startMs, 0, extra)).toBe(
      formatAxisLabel(startMs, extra.time, { startMs, endMs })
    );
    expect(xAxis.axisLabel.formatter(startMs, 0, extra)).toMatch(
      /^\d{1,2}:\d{2}/
    );
  });
});

describe("chart palette", () => {
  const latency = (palette: ChartPalette) => {
    const metrics = [{ timestamp: "2026-07-26T10:05:30.000Z", latency: 20 }];
    return makeLatencyChartOption({
      slots: fillTimeline(metrics, startMs, endMs, "5m"),
      stats: calculateLatencyStats(metrics),
      palette,
      incidents: [],
      startMs,
      endMs,
      splitNumber: DEFAULT_SPLIT_NUMBER,
    });
  };

  const OTHER_PALETTE: ChartPalette = {
    card: "#d0",
    ink: "#d1",
    inkSecondary: "#d2",
    rule: "#d3",
    accent: "#d4",
    degraded: "#d5",
    down: "#d6",
    band: "rgba(4, 5, 6, 0.4)",
    series: ["#o1", "#o2", "#o3", "#o4", "#o5", "#o6"],
    fontFamily: "Other Sans",
  };

  test("colors the latency series with the accent and its area with the band", () => {
    const series = decodeSeries(
      S.Array(
        S.Struct({
          lineStyle: S.Struct({ color: S.String }),
          areaStyle: S.Struct({ color: S.String }),
        })
      ),
      latency(PALETTE).series
    );

    expect(series[0].lineStyle.color).toBe(PALETTE.accent);
    expect(series[0].areaStyle.color).toBe(PALETTE.band);
  });

  test("draws axis text in secondary ink and gridlines as rules", () => {
    const option = latency(PALETTE);
    const xAxis = decodeSeries(XAxis, option.xAxis);
    const yAxis = decodeSeries(YAxis, option.yAxis);

    expect(xAxis.axisLabel.color).toBe(PALETTE.inkSecondary);
    expect(xAxis.splitLine.lineStyle.color).toBe(PALETTE.rule);
    expect(yAxis.axisLabel.color).toBe(PALETTE.inkSecondary);
    expect(yAxis.splitLine.lineStyle.color).toBe(PALETTE.rule);
  });

  test("themes the tooltip as a card with a rule border and ink text", () => {
    const tooltip = decodeSeries(Tooltip, latency(PALETTE).tooltip);

    expect(tooltip.backgroundColor).toBe(PALETTE.card);
    expect(tooltip.borderColor).toBe(PALETTE.rule);
    expect(tooltip.textStyle.color).toBe(PALETTE.ink);
    expect(tooltip.textStyle.fontFamily).toBe(PALETTE.fontFamily);
    expect(tooltip.extraCssText).toContain("tabular-nums");
  });

  test("colors jitter in secondary ink with a degraded-colored threshold", () => {
    const metrics = [{ timestamp: "2026-07-26T10:05:00.000Z", jitter: 3 }];
    const option = makeJitterChartOption({
      slots: fillTimeline(metrics, startMs, endMs, "5m"),
      palette: PALETTE,
      incidents: [],
      startMs,
      endMs,
      splitNumber: DEFAULT_SPLIT_NUMBER,
    });
    const series = decodeSeries(
      S.Array(
        S.Struct({
          lineStyle: S.Struct({ color: S.String }),
          markLine: S.Struct({ lineStyle: S.Struct({ color: S.String }) }),
        })
      ),
      option.series
    );

    expect(series[0].lineStyle.color).toBe(PALETTE.inkSecondary);
    expect(series[0].markLine.lineStyle.color).toBe(PALETTE.degraded);
  });

  test("a different palette yields different colors, with nothing left from the first", () => {
    const first = JSON.stringify(latency(PALETTE).series);
    const second = JSON.stringify(latency(OTHER_PALETTE).series);

    expect(second).not.toBe(first);
    expect(second).not.toContain(PALETTE.accent);
    expect(second).not.toContain(PALETTE.band);
  });
});

describe("incident marks", () => {
  const incidents = [
    {
      ref: "B",
      startMs: startMs + 5 * 60_000,
      endMs: startMs + 10 * 60_000,
      status: "degraded" as const,
    },
    {
      ref: "A",
      startMs: startMs + 60_000,
      endMs: startMs + 2 * 60_000,
      status: "down" as const,
    },
  ];
  const metrics = [
    {
      timestamp: "2026-07-26T10:05:30.000Z",
      latency: 20,
      packet_loss: 1,
      jitter: 2,
    },
  ];
  const slots = fillTimeline(metrics, startMs, endMs, "5m");
  const base = { startMs, endMs, splitNumber: DEFAULT_SPLIT_NUMBER };

  const builders = {
    latency: () =>
      makeLatencyChartOption({
        ...base,
        slots,
        stats: calculateLatencyStats(metrics),
        palette: PALETTE,
        incidents,
      }),
    "packet loss": () =>
      makePacketLossChartOption({
        ...base,
        slots,
        palette: PALETTE,
        incidents,
      }),
    jitter: () =>
      makeJitterChartOption({
        ...base,
        slots,
        palette: PALETTE,
        incidents,
      }),
  };

  test.each(Object.entries(builders))(
    "%s shades each incident span in its status color",
    (_name, build) => {
      const [series] = decodeSeries(MarkedSeries, build().series);

      expect(series.markArea?.silent).toBe(true);
      expect(
        series.markArea?.data
          .filter(([from]) => from.xAxis !== undefined)
          .map(([from, to]) => [from.xAxis, to.xAxis, from.itemStyle?.color])
      ).toEqual([
        [incidents[0].startMs, incidents[0].endMs, PALETTE.degraded],
        [incidents[1].startMs, incidents[1].endMs, PALETTE.down],
      ]);
    }
  );

  test.each(Object.entries(builders))(
    "%s letters a line at each incident's start with the log's ref",
    (_name, build) => {
      const [series] = decodeSeries(MarkedSeries, build().series);
      const lines = series.markLine?.data.filter(
        (datum) => datum.xAxis !== undefined
      );

      expect(lines?.map((line) => [line.xAxis, line.label?.formatter])).toEqual(
        [
          [incidents[0].startMs, "B"],
          [incidents[1].startMs, "A"],
        ]
      );
      expect(lines?.map((line) => line.lineStyle?.color)).toEqual([
        PALETTE.degraded,
        PALETTE.down,
      ]);
      expect(lines?.every((line) => line.label?.color === PALETTE.ink)).toBe(
        true
      );
    }
  );

  test.each(Object.entries(builders))(
    "%s draws a down line solid and a degraded line dashed, so status is not colour alone",
    (_name, build) => {
      const [series] = decodeSeries(MarkedSeries, build().series);
      const typeOf = (xAxis: number) =>
        series.markLine?.data.find((datum) => datum.xAxis === xAxis)?.lineStyle
          ?.type;

      expect(typeOf(incidents[0].startMs)).toBe("dashed");
      expect(typeOf(incidents[1].startMs)).toBe("solid");
    }
  );

  test("keeps the average and acceptable-jitter reference lines alongside the marks", () => {
    const [latency] = decodeSeries(MarkedSeries, builders.latency().series);
    const [jitter] = decodeSeries(MarkedSeries, builders.jitter().series);

    expect(latency.markLine?.data[0]).toEqual(
      expect.objectContaining({ yAxis: 20 })
    );
    expect(jitter.markLine?.data[0]).toEqual(
      expect.objectContaining({ yAxis: 10 })
    );
  });

  test("adds no marks when there are no incidents", () => {
    const [latency] = decodeSeries(
      MarkedSeries,
      makeLatencyChartOption({
        ...base,
        slots,
        stats: calculateLatencyStats(metrics),
        palette: PALETTE,
        incidents: [],
      }).series
    );
    const [loss] = decodeSeries(
      MarkedSeries,
      makePacketLossChartOption({
        ...base,
        slots,
        palette: PALETTE,
        incidents: [],
      }).series
    );

    const spansInTime = (series: typeof latency) =>
      (series.markArea?.data ?? []).filter(
        ([from]) => from.xAxis !== undefined
      );

    expect(spansInTime(latency)).toEqual([]);
    expect(latency.markLine?.data).toEqual([
      expect.objectContaining({ yAxis: 20 }),
    ]);
    expect(spansInTime(loss)).toEqual([]);
    expect(loss.markLine).toBeUndefined();
  });

  test("marks incidents on the latency chart even before any latency was recorded", () => {
    const [latency] = decodeSeries(
      MarkedSeries,
      makeLatencyChartOption({
        ...base,
        slots: fillTimeline([], startMs, endMs, "5m"),
        stats: calculateLatencyStats([]),
        palette: PALETTE,
        incidents,
      }).series
    );

    expect(latency.markLine?.data.map((datum) => datum.xAxis)).toEqual([
      incidents[0].startMs,
      incidents[1].startMs,
    ]);
  });
});

describe("incident chips", () => {
  const DAY_MS = 86_400_000;
  const window = { startMs: 0, endMs: 30 * DAY_MS };
  const WIDTH_PX = 800;
  const incident = (ref: string, atMs: number) => ({
    ref,
    startMs: atMs,
    endMs: atMs + 60_000,
    status: "down" as const,
  });
  const chips = (
    incidents: ReadonlyArray<ReturnType<typeof incident>>,
    widthPx = WIDTH_PX
  ) => {
    const [series] = decodeSeries(
      MarkedSeries,
      makeJitterChartOption({
        slots: [],
        palette: PALETTE,
        incidents,
        ...window,
        splitNumber: DEFAULT_SPLIT_NUMBER,
        widthPx,
      }).series
    );
    return (series.markLine?.data ?? [])
      .filter((datum) => datum.xAxis !== undefined)
      .map((datum) => [datum.label?.show, datum.label?.formatter]);
  };

  test("incidents far apart each get a chip of their own", () => {
    expect(
      chips([incident("A", 5 * DAY_MS), incident("B", 20 * DAY_MS)])
    ).toEqual([
      [true, "A"],
      [true, "B"],
    ]);
  });

  test("close incidents share one chip lettered as the span, over the first", () => {
    expect(
      chips([
        incident("A", 20 * DAY_MS),
        incident("B", 20 * DAY_MS + 60_000),
        incident("C", 20 * DAY_MS + 120_000),
      ])
    ).toEqual([
      [true, "A–C"],
      [false, "B"],
      [false, "C"],
    ]);
  });

  test("a close pair is lettered with both ends of the span, and a distant one still gets its own", () => {
    expect(
      chips([
        incident("A", 3 * DAY_MS),
        incident("B", 20 * DAY_MS),
        incident("C", 20 * DAY_MS + 3_600_000),
      ])
    ).toEqual([
      [true, "A"],
      [true, "B–C"],
      [false, "C"],
    ]);
  });

  test("the same incidents are folded on a narrow chart and kept apart on a wide one", () => {
    const apart = [incident("A", 10 * DAY_MS), incident("B", 11 * DAY_MS)];

    expect(chips(apart, 1600).map(([show]) => show)).toEqual([true, true]);
    expect(chips(apart, 320).map(([show]) => show)).toEqual([true, false]);
  });

  test("incidents that began before the window draw no chip", () => {
    expect(chips([incident("A", -DAY_MS)])).toEqual([[false, "A"]]);
  });

  test("makes room above the plot for the chips, only when there are some", () => {
    const gridTop = (incidents: ReadonlyArray<ReturnType<typeof incident>>) =>
      decodeSeries(
        S.Struct({ top: S.Number }),
        makeJitterChartOption({
          slots: [],
          palette: PALETTE,
          incidents,
          ...window,
          splitNumber: DEFAULT_SPLIT_NUMBER,
        }).grid
      ).top;

    expect(gridTop([incident("A", 5 * DAY_MS)])).toBeGreaterThan(gridTop([]));
    expect(gridTop([incident("A", -DAY_MS)])).toBe(gridTop([]));
  });

  test("keeps the chip row clear of the per-host legend above it", () => {
    const top = (incidents: ReadonlyArray<ReturnType<typeof incident>>) =>
      decodeSeries(
        S.Struct({ top: S.Number }),
        makeLatencyChartOption({
          slots: [],
          hostSeries: [{ host: "8.8.8.8", slots: [] }],
          stats: calculateLatencyStats([]),
          palette: PALETTE,
          incidents,
          ...window,
          splitNumber: DEFAULT_SPLIT_NUMBER,
        }).grid
      ).top;

    expect(top([incident("A", 5 * DAY_MS)])).toBeGreaterThan(top([]));
  });
});

describe("incident chip geometry", () => {
  const PLOT_PX = 1024;
  const GRID_MARGINS_PX = 71;
  const window = { startMs: 0, endMs: PLOT_PX * 1000 };
  const CHIP_A_WIDTH_PX = 17;
  const MIN_CHIP_GAP_PX = 4;
  const SEPARATING_PX = CHIP_A_WIDTH_PX + MIN_CHIP_GAP_PX;
  const incidentAt = (ref: string, px: number) => ({
    ref,
    startMs: px * 1000,
    endMs: px * 1000 + 60_000,
    status: "down" as const,
  });
  const chipsFor = (
    incidents: ReadonlyArray<ReturnType<typeof incidentAt>>
  ) => {
    const [series] = decodeSeries(
      MarkedSeries,
      makeJitterChartOption({
        slots: [],
        palette: PALETTE,
        incidents,
        ...window,
        splitNumber: DEFAULT_SPLIT_NUMBER,
        widthPx: PLOT_PX + GRID_MARGINS_PX,
      }).series
    );
    return (series.markLine?.data ?? [])
      .filter((datum) => datum.xAxis !== undefined)
      .map((datum) => [datum.label?.show, datum.label?.formatter]);
  };

  test("two chips exactly the minimum gap apart stay separate", () => {
    expect(
      chipsFor([incidentAt("A", 100), incidentAt("B", 100 + SEPARATING_PX)])
    ).toEqual([
      [true, "A"],
      [true, "B"],
    ]);
  });

  test("two chips closer than the minimum gap fold into one", () => {
    expect(
      chipsFor([
        incidentAt("A", 100),
        incidentAt("B", 100 + SEPARATING_PX - 0.1),
      ])
    ).toEqual([
      [true, "A–B"],
      [false, "B"],
    ]);
  });

  test("a folded chip keeps the gap from the next one by its own wider extent", () => {
    const foldedPair = [incidentAt("A", 100), incidentAt("B", 110)];

    expect(chipsFor([...foldedPair, incidentAt("C", 128)])).toEqual([
      [true, "A–B"],
      [false, "B"],
      [true, "C"],
    ]);
    expect(chipsFor([...foldedPair, incidentAt("C", 127.9)])).toEqual([
      [true, "A–C"],
      [false, "B"],
      [false, "C"],
    ]);
  });

  test("a chip widened by folding folds with the chip before it when their extents meet", () => {
    expect(
      chipsFor([incidentAt("A", 70), incidentAt("B", 92), incidentAt("C", 102)])
    ).toEqual([
      [true, "A–C"],
      [false, "B"],
      [false, "C"],
    ]);
  });

  test("a fold that widens a chip carries on leftwards until every pair has room", () => {
    expect(
      chipsFor([
        incidentAt("A", 100),
        incidentAt("B", 121),
        incidentAt("C", 142),
        incidentAt("D", 143),
      ])
    ).toEqual([
      [true, "A–D"],
      [false, "B"],
      [false, "C"],
      [false, "D"],
    ]);
  });

  test("a chip folded leftwards stays centred on the first incident it covers", () => {
    const folded = [
      incidentAt("A", 50),
      incidentAt("B", 71),
      incidentAt("C", 85),
    ];

    expect(chipsFor([...folded, incidentAt("D", 90)])).toEqual([
      [true, "A–C"],
      [false, "B"],
      [false, "C"],
      [true, "D"],
    ]);
  });

  test("incidents starting exactly at either end of the window get chips", () => {
    expect(chipsFor([incidentAt("A", 0), incidentAt("B", PLOT_PX)])).toEqual([
      [true, "A"],
      [true, "B"],
    ]);
  });

  test("incidents starting a moment outside the window get none", () => {
    expect(
      chipsFor([
        { ...incidentAt("A", 0), startMs: -1 },
        { ...incidentAt("B", PLOT_PX), startMs: window.endMs + 1 },
      ])
    ).toEqual([
      [false, "A"],
      [false, "B"],
    ]);
  });

  test("a chart too narrow to hold the plot folds every chip into one", () => {
    const [series] = decodeSeries(
      MarkedSeries,
      makeJitterChartOption({
        slots: [],
        palette: PALETTE,
        incidents: [incidentAt("A", 0), incidentAt("B", PLOT_PX)],
        ...window,
        splitNumber: DEFAULT_SPLIT_NUMBER,
        widthPx: 40,
      }).series
    );

    expect(
      (series.markLine?.data ?? [])
        .filter((datum) => datum.xAxis !== undefined)
        .map((datum) => datum.label?.formatter)
    ).toEqual(["A–B", "B"]);
  });

  test("the chip row adds exactly its own height above the plot", () => {
    const gridTop = (incidents: ReadonlyArray<ReturnType<typeof incidentAt>>) =>
      decodeSeries(
        S.Struct({ top: S.Number }),
        makeJitterChartOption({
          slots: [],
          palette: PALETTE,
          incidents,
          ...window,
          splitNumber: DEFAULT_SPLIT_NUMBER,
        }).grid
      ).top;

    expect(gridTop([incidentAt("A", 100)]) - gridTop([])).toBe(28);
  });
});

describe("reference labels near the top of the plot", () => {
  const ABOVE = "insideStartTop";
  const BELOW = "insideStartBottom";
  const incident = {
    ref: "A",
    startMs: startMs + 300_000,
    endMs: startMs + 600_000,
    status: "down" as const,
  };
  const labelPosition = (series: unknown) =>
    decodeSeries(MarkedSeries, series)[0].markLine?.data.find((datum) =>
      /^(Reference|Degraded)/.test(datum.label?.formatter ?? "")
    )?.label?.position;
  const lossAt = (value: number) =>
    makePacketLossChartOption({
      slots: fillTimeline(
        [{ timestamp: "2026-07-26T10:05:00.000Z", packet_loss: value }],
        startMs,
        endMs,
        "5m"
      ),
      palette: PALETTE,
      incidents: [incident],
      startMs,
      endMs,
      splitNumber: DEFAULT_SPLIT_NUMBER,
    }).series;
  const latencyAt = (value: number) =>
    makeLatencyChartOption({
      slots: fillTimeline(
        [{ timestamp: "2026-07-26T10:05:00.000Z", latency: value }],
        startMs,
        endMs,
        "5m"
      ),
      stats: calculateLatencyStats([{ latency: value }]),
      palette: PALETTE,
      incidents: [incident],
      startMs,
      endMs,
      splitNumber: DEFAULT_SPLIT_NUMBER,
    }).series;
  const jitterAt = (value: number) =>
    makeJitterChartOption({
      slots: fillTimeline(
        [{ timestamp: "2026-07-26T10:05:00.000Z", jitter: value }],
        startMs,
        endMs,
        "5m"
      ),
      palette: PALETTE,
      incidents: [incident],
      startMs,
      endMs,
      splitNumber: DEFAULT_SPLIT_NUMBER,
    }).series;

  test("the packet loss label drops below its line when the data only just reaches it, clear of the chip row", () => {
    expect(labelPosition(lossAt(PACKET_LOSS_THRESHOLDS.degradedFloor))).toBe(
      BELOW
    );
  });

  test("the packet loss label stays above its line when there is room for it", () => {
    expect(labelPosition(lossAt(80))).toBe(ABOVE);
  });

  test("the latency label drops below its line when the data only just reaches it", () => {
    expect(labelPosition(latencyAt(LATENCY_THRESHOLD_MS))).toBe(BELOW);
    expect(labelPosition(latencyAt(LATENCY_THRESHOLD_MS * 3))).toBe(ABOVE);
  });

  test("the jitter label drops below its line when the data only just reaches it", () => {
    expect(labelPosition(jitterAt(10))).toBe(BELOW);
    expect(labelPosition(jitterAt(40))).toBe(ABOVE);
  });

  test("the latency label drops below its line until the peak is 20% past it", () => {
    expect(labelPosition(latencyAt(57))).toBe(BELOW);
    expect(labelPosition(latencyAt(60))).toBe(ABOVE);
    expect(labelPosition(latencyAt(63))).toBe(ABOVE);
  });

  test("the jitter label drops below its line until the peak is 20% past it", () => {
    expect(labelPosition(jitterAt(11.9))).toBe(BELOW);
    expect(labelPosition(jitterAt(12))).toBe(ABOVE);
    expect(labelPosition(jitterAt(12.1))).toBe(ABOVE);
  });
});

describe("latency percentiles and threshold line", () => {
  const metrics = [
    {
      timestamp: "2026-07-26T10:05:30.000Z",
      latency: 22,
      latency_p50: 20,
      latency_p95: 45,
    },
  ];
  const slots = fillTimeline(metrics, startMs, endMs, "5m");
  const option = (
    hostSeries: Parameters<typeof makeLatencyChartOption>[0]["hostSeries"] = []
  ) =>
    makeLatencyChartOption({
      slots,
      hostSeries,
      stats: calculateLatencyStats(metrics),
      palette: PALETTE,
      incidents: [],
      startMs,
      endMs,
      splitNumber: DEFAULT_SPLIT_NUMBER,
    });
  const Line = S.Array(
    S.Struct({
      name: S.String,
      stack: S.optional(S.String),
      data: S.Array(
        S.Tuple([S.Number, S.NullOr(S.Number), S.optionalKey(S.Number)])
      ),
      areaStyle: S.optional(S.Struct({ color: S.String })),
      lineStyle: S.optional(
        S.Struct({
          color: S.String,
          type: S.optional(S.String),
          width: S.optional(S.Number),
          opacity: S.optional(S.Number),
        })
      ),
      markArea: S.optional(S.Unknown),
      markLine: S.optional(S.Struct({ data: S.Array(MarkLineDatum) })),
    })
  );
  const isReference = (datum: { label?: { formatter?: string } }) =>
    datum.label?.formatter?.startsWith("Reference") === true;

  test("draws the p50 line with the p95 as a band riding on it", () => {
    const [p50, p95] = decodeSeries(Line, option().series);

    expect(p50.name).toBe("p50");
    expect(p95.name).toBe("p95");
    expect(p50.stack).toBe(p95.stack);
    expect(p50.data[1]).toEqual([startMs + 300_000, 20]);
    // The band is the gap above p50, carrying p95 itself as the value to show.
    expect(p95.data[1]).toEqual([startMs + 300_000, 25, 45]);
    expect(p95.areaStyle?.color).toBe(PALETTE.band);
  });

  test("outlines the band's upper edge at full strength, since its fill alone is too faint to read p95", () => {
    const [, p95] = decodeSeries(Line, option().series);

    expect(p95.lineStyle?.color).toBe(PALETTE.accent);
    expect(p95.lineStyle?.opacity).toBeUndefined();
    expect(p95.lineStyle?.width).toBeGreaterThan(0);
  });

  test("leaves a bucket with no readings as a gap in both lines", () => {
    const [p50, p95] = decodeSeries(Line, option().series);

    expect(p50.data[0]).toEqual([startMs, null]);
    expect(p95.data[0]).toEqual([startMs, null]);
  });

  test("falls back to the average line when the data carries no percentiles", () => {
    const bare = [{ timestamp: "2026-07-26T10:05:30.000Z", latency: 22 }];
    const [line, ...rest] = decodeSeries(
      Line,
      makeLatencyChartOption({
        slots: fillTimeline(bare, startMs, endMs, "5m"),
        stats: calculateLatencyStats(bare),
        palette: PALETTE,
        incidents: [],
        startMs,
        endMs,
        splitNumber: DEFAULT_SPLIT_NUMBER,
      }).series
    );

    expect(line.name).toBe("Latency");
    expect(rest).toEqual([]);
  });

  test("draws one dashed line at the latency threshold, named as a reference", () => {
    const slow = [
      {
        timestamp: "2026-07-26T10:05:30.000Z",
        latency: 120,
        latency_p50: 100,
        latency_p95: 200,
      },
    ];
    const [p50] = decodeSeries(
      Line,
      makeLatencyChartOption({
        slots: fillTimeline(slow, startMs, endMs, "5m"),
        stats: calculateLatencyStats(slow),
        palette: PALETTE,
        incidents: [],
        startMs,
        endMs,
        splitNumber: DEFAULT_SPLIT_NUMBER,
      }).series
    );
    const thresholds = p50.markLine?.data.filter(isReference);

    expect(p50.markArea).toBeUndefined();
    expect(thresholds).toEqual([
      {
        yAxis: LATENCY_THRESHOLD_MS,
        lineStyle: { color: PALETTE.inkSecondary, type: "dashed", width: 1 },
        label: expect.objectContaining({
          show: true,
          position: "insideStartTop",
          formatter: "Reference 50 ms",
          color: PALETTE.inkSecondary,
          backgroundColor: PALETTE.card,
        }),
      },
    ]);
  });

  test("draws the threshold line when the data reaches it exactly", () => {
    const exact = [
      {
        timestamp: "2026-07-26T10:05:30.000Z",
        latency: LATENCY_THRESHOLD_MS,
        latency_p50: LATENCY_THRESHOLD_MS,
        latency_p95: LATENCY_THRESHOLD_MS,
      },
    ];
    const [p50] = decodeSeries(
      Line,
      makeLatencyChartOption({
        slots: fillTimeline(exact, startMs, endMs, "5m"),
        stats: calculateLatencyStats(exact),
        palette: PALETTE,
        incidents: [],
        startMs,
        endMs,
        splitNumber: DEFAULT_SPLIT_NUMBER,
      }).series
    );

    expect(
      p50.markLine?.data.filter(isReference).map((datum) => datum.yAxis)
    ).toEqual([LATENCY_THRESHOLD_MS]);
  });

  test("draws no threshold line when the data never climbs to it", () => {
    const [p50] = decodeSeries(Line, option().series);

    expect(p50.markArea).toBeUndefined();
    expect(
      p50.markLine?.data.some((datum) => datum.yAxis === LATENCY_THRESHOLD_MS)
    ).toBe(false);
  });

  test("reads the p95 row of the tooltip from the band's third value", () => {
    const { formatter } = decodeSeries(Tooltip, option().tooltip);
    const text = formatter([
      { axisValue: startMs, marker: "", seriesName: "p50", value: [0, 20] },
      { axisValue: startMs, marker: "", seriesName: "p95", value: [0, 25, 45] },
    ]);

    expect(text).toContain("p50: 20.0 ms");
    expect(text).toContain("p95: 45.0 ms");
  });

  test("zooms on the x axis with the other quality charts, and offers a range brush", () => {
    const built = option();

    expect(built.dataZoom).toEqual([
      expect.objectContaining({
        type: "inside",
        xAxisIndex: 0,
        filterMode: "none",
      }),
    ]);
    expect(built.brush).toEqual(
      expect.objectContaining({ xAxisIndex: 0, brushType: "lineX" })
    );
  });

  test("keeps the toolbox the brush depends on out of sight", () => {
    expect(option().toolbox).toEqual({ show: false });
  });

  describe("one line per host", () => {
    const perHost = (host: string, latency: number) => ({
      host,
      slots: fillTimeline(
        [
          {
            timestamp: "2026-07-26T10:05:30.000Z",
            latency,
            latency_p50: latency,
          },
        ],
        startMs,
        endMs,
        "5m"
      ),
    });
    const hosts = [
      perHost("8.8.8.8", 12),
      perHost("1.1.1.1", 18),
      perHost("9.9.9.9", 24),
    ];

    test("draws each host as its own p50 line in the next series colour", () => {
      const series = decodeSeries(Line, option(hosts).series).slice(
        0,
        hosts.length
      );

      expect(series.map((line) => line.name)).toEqual([
        "8.8.8.8",
        "1.1.1.1",
        "9.9.9.9",
      ]);
      expect(series.map((line) => line.lineStyle?.color)).toEqual([
        "#s1",
        "#s2",
        "#s3",
      ]);
      expect(series[1].data[1]).toEqual([startMs + 300_000, 18]);
    });

    test("names the lines in a legend and has no p95 band", () => {
      const built = option(hosts);

      expect(built.legend).toEqual(
        expect.objectContaining({
          top: 0,
          data: ["8.8.8.8", "1.1.1.1", "9.9.9.9"],
        })
      );
      expect(
        decodeSeries(Line, built.series).some((line) => line.name === "p95")
      ).toBe(false);
    });

    test("draws the threshold line once, on a series with no points of its own", () => {
      const slow = [perHost("8.8.8.8", 120), perHost("1.1.1.1", 18)];
      const series = decodeSeries(Line, option(slow).series);
      const carrier = series[series.length - 1];

      expect(carrier.data).toEqual([]);
      expect(carrier.markLine?.data.map((datum) => datum.yAxis)).toEqual([
        LATENCY_THRESHOLD_MS,
      ]);
      expect(series.slice(0, slow.length).map((line) => line.markLine)).toEqual(
        [undefined, undefined]
      );
    });

    test("keeps incident marks off the host lines, so hiding a host cannot hide them", () => {
      const incident = {
        ref: "A",
        status: "down" as const,
        startMs: startMs + 60_000,
        endMs: startMs + 120_000,
      };
      const series = decodeSeries(
        Line,
        makeLatencyChartOption({
          slots,
          hostSeries: hosts,
          stats: calculateLatencyStats(metrics),
          palette: PALETTE,
          incidents: [incident],
          startMs,
          endMs,
          splitNumber: DEFAULT_SPLIT_NUMBER,
        }).series
      );
      const carrier = series[series.length - 1];

      expect(carrier.markArea).toBeDefined();
      expect(carrier.markLine?.data).toHaveLength(1);
      expect(
        series
          .slice(0, hosts.length)
          .map((line) => [line.markArea, line.markLine])
      ).toEqual([
        [undefined, undefined],
        [undefined, undefined],
        [undefined, undefined],
      ]);
    });

    // The all-hosts p95 is not drawn in this view, so it must not decide
    // whether the line sits inside the plot.
    test("decides the threshold from the host lines it draws, not the all-hosts p95", () => {
      const series = decodeSeries(
        Line,
        makeLatencyChartOption({
          slots: fillTimeline(
            [
              {
                timestamp: "2026-07-26T10:05:30.000Z",
                latency: 30,
                latency_p50: 30,
                latency_p95: 200,
              },
            ],
            startMs,
            endMs,
            "5m"
          ),
          hostSeries: hosts,
          stats: calculateLatencyStats(metrics),
          palette: PALETTE,
          incidents: [],
          startMs,
          endMs,
          splitNumber: DEFAULT_SPLIT_NUMBER,
        }).series
      );

      expect(series[series.length - 1].markLine).toBeUndefined();
    });

    test("draws the threshold once a host line reaches it, whatever the all-hosts figures", () => {
      const series = decodeSeries(
        Line,
        option([perHost("8.8.8.8", LATENCY_THRESHOLD_MS)]).series
      );

      expect(
        series[series.length - 1].markLine?.data.map((datum) => datum.yAxis)
      ).toEqual([LATENCY_THRESHOLD_MS]);
    });

    test("plots a host's median where it has one, and its mean where it does not", () => {
      const withBoth = {
        host: "8.8.8.8",
        slots: fillTimeline(
          [
            {
              timestamp: "2026-07-26T10:05:30.000Z",
              latency: 40,
              latency_p50: 20,
            },
          ],
          startMs,
          endMs,
          "5m"
        ),
      };
      const meanOnly = {
        host: "1.1.1.1",
        slots: fillTimeline(
          [{ timestamp: "2026-07-26T10:05:30.000Z", latency: 40 }],
          startMs,
          endMs,
          "5m"
        ),
      };
      const [median, mean] = decodeSeries(
        Line,
        option([withBoth, meanOnly]).series
      );

      expect(median.data[1]).toEqual([startMs + 300_000, 20]);
      expect(mean.data[1]).toEqual([startMs + 300_000, 40]);
    });

    test("wraps back to the first series colour for a seventh host", () => {
      const many = Array.from({ length: 7 }, (_, i) =>
        perHost(`10.0.0.${i}`, 10 + i)
      );
      const series = decodeSeries(Line, option(many).series);

      expect(series[6].lineStyle?.color).toBe(PALETTE.series[0]);
    });

    test("tells apart a host beyond the sixth by dashing its line", () => {
      const many = Array.from({ length: 7 }, (_, i) =>
        perHost(`10.0.0.${i}`, 10 + i)
      );
      const series = decodeSeries(Line, option(many).series);

      expect(series[5].lineStyle?.type).toBe("solid");
      expect(series[6].lineStyle?.type).toBe("dashed");
    });
  });
});

describe("every chart", () => {
  const metrics = [
    {
      timestamp: "2026-07-26T10:05:30.000Z",
      latency: 20,
      latency_p50: 19,
      latency_p95: 40,
      packet_loss: 1,
      jitter: 2,
    },
  ];
  const slots = fillTimeline(metrics, startMs, endMs, "5m");
  const base = { startMs, endMs, splitNumber: DEFAULT_SPLIT_NUMBER };

  test("draws straight lines, never smoothed ones", () => {
    const options = [
      makeLatencyChartOption({
        ...base,
        slots,
        stats: calculateLatencyStats(metrics),
        palette: PALETTE,
        incidents: [],
      }),
      makeJitterChartOption({
        ...base,
        slots,
        palette: PALETTE,
        incidents: [],
      }),
      makeSpeedChartOption({
        ...base,
        metrics: [
          {
            timestamp: "2026-07-26T10:00:00.000Z",
            download_speed: 100,
            upload_speed: 10,
          },
          {
            timestamp: "2026-07-26T10:30:00.000Z",
            download_speed: 100,
            upload_speed: 10,
          },
        ],
        palette: PALETTE,
      }),
    ];

    for (const built of options) {
      expect(JSON.stringify(built.series)).not.toContain('"smooth"');
    }
  });

  test("starts fully zoomed out unless told otherwise", () => {
    const built = [
      makeLatencyChartOption({
        ...base,
        slots,
        stats: calculateLatencyStats(metrics),
        palette: PALETTE,
        incidents: [],
      }),
      makePacketLossChartOption({
        ...base,
        slots,
        palette: PALETTE,
        incidents: [],
      }),
      makeJitterChartOption({
        ...base,
        slots,
        palette: PALETTE,
        incidents: [],
      }),
    ];

    for (const { dataZoom } of built) {
      expect(dataZoom).toEqual([
        expect.objectContaining({ start: 0, end: 100 }),
      ]);
    }
  });

  test("paints the zoom it is given", () => {
    const zoom = { start: 20, end: 50 };
    const built = [
      makeLatencyChartOption({
        ...base,
        slots,
        stats: calculateLatencyStats(metrics),
        palette: PALETTE,
        incidents: [],
        zoom,
      }),
      makePacketLossChartOption({
        ...base,
        slots,
        palette: PALETTE,
        incidents: [],
        zoom,
      }),
      makeJitterChartOption({
        ...base,
        slots,
        palette: PALETTE,
        incidents: [],
        zoom,
      }),
    ];

    for (const { dataZoom } of built) {
      expect(dataZoom).toEqual([expect.objectContaining(zoom)]);
    }
  });

  test("scrolls the page rather than zooming on a plain wheel turn", () => {
    const [zoom] = decodeSeries(
      S.Array(
        S.Struct({
          zoomOnMouseWheel: S.String,
          moveOnMouseWheel: S.Boolean,
          moveOnMouseMove: S.Boolean,
        })
      ),
      makeJitterChartOption({
        ...base,
        slots,
        palette: PALETTE,
        incidents: [],
      }).dataZoom
    );

    expect(zoom.zoomOnMouseWheel).toBe("ctrl");
    expect(zoom.moveOnMouseWheel).toBe(false);
    expect(zoom.moveOnMouseMove).toBe(false);
  });
});
