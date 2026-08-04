import type { Metric } from "@shared/api/routes/metrics";
import type { SpeedMetric } from "@shared/api/routes/speedtest";
import type { EChartsOption } from "echarts/types/dist/shared";
import { Array as Array_, Option, Order } from "effect";
import type {
  JitterStats,
  LatencyStats,
  PacketLossStats,
  SpeedStats,
} from "@/dashboard/charts/stats";
import type { TimelineSlot } from "@/dashboard/charts/timeline";
import type { Theme } from "@/dashboard/theme";

const COLORS = {
  primary: "#3182ce",
  success: "#38a169",
  warning: "#d69e2e",
  danger: "#e53e3e",
  info: "#4299e1",
} as const;

const THEME_COLORS: Record<Theme, { grid: string; text: string }> = {
  light: { grid: "#e2e8f0", text: "#4a5568" },
  dark: { grid: "#2d3748", text: "#a0aec0" },
};

// Mirrors echarts' own `PrimaryTimeUnit` (scale/Time.js): every tick on a
// time axis is classified into exactly one of these, and that classification
// — not a hand-rolled midnight/month check — is what the axis label
// formatter keys off, so it never disagrees with where echarts actually put
// the tick.
export type PrimaryTimeUnit =
  | "year"
  | "month"
  | "day"
  | "hour"
  | "minute"
  | "second"
  | "millisecond";

export interface AxisTickInfo {
  lowerTimeUnit: PrimaryTimeUnit;
  level: number;
}

const isLocalMidnight = (date: Date): boolean =>
  date.getHours() === 0 &&
  date.getMinutes() === 0 &&
  date.getSeconds() === 0 &&
  date.getMilliseconds() === 0;

// Whether the window itself spans more than one calendar `unit` — distinct
// from a single tick's own alignment, since a tick can land exactly on a
// unit boundary (e.g. Jan 1) without the *window* actually needing to
// disambiguate anything (e.g. this year's "year to date").
//
// The window bounds come from UTC-resolved preset math (dateRange.ts), so in
// a negative-UTC-offset zone a UTC boundary start renders locally a few
// hours before local midnight — e.g. "year to date" begins at
// 2026-01-01T00:00Z, which is 2025-12-31T16:00 Pacific. No tick ever lands
// in that narrow sliver (the first tick is the next local *day* boundary at
// or after it), so this ceils `startMs` forward by at most one day — never
// a full unit — before comparing, correcting exactly that artifact without
// overshooting past real ticks that legitimately exist in the earlier unit
// (e.g. a genuine year-crossing window's Sep/Nov ticks the year before).
const ceilToNextLocalMidnight = (date: Date): Date =>
  isLocalMidnight(date)
    ? date
    : new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);

export const spansCalendarUnit = (
  unit: "year" | "month",
  startMs: number,
  endMs: number
): boolean => {
  const effectiveStart = ceilToNextLocalMidnight(new Date(startMs));
  const end = new Date(endMs);
  return unit === "year"
    ? effectiveStart.getFullYear() !== end.getFullYear()
    : effectiveStart.getFullYear() !== end.getFullYear() ||
        effectiveStart.getMonth() !== end.getMonth();
};

const HOUR_ONLY_OPTIONS: Intl.DateTimeFormatOptions = { hour: "numeric" };
const HOUR_MINUTE_OPTIONS: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
};
const HOUR_MINUTE_SECOND_OPTIONS: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
};

const detectUse12Hour = (): boolean =>
  new Intl.DateTimeFormat().resolvedOptions().hour12 ?? false;

/**
 * Labels a single axis tick. `tick` is exactly what echarts' own function
 * formatter receives as `extra.time` (scale/Time.js `leveledFormat`) — this
 * never re-derives which calendar tier a tick belongs to, only how to
 * render that tier, and whether the *window* needs a coarser tier
 * disambiguated (year/month) is answered by `spansCalendarUnit`, not by the
 * tick itself.
 *
 * `use12Hour` defaults to the real runtime locale detection but can be
 * overridden so tests can pin both branches deterministically.
 */
export const formatAxisLabel = (
  value: number,
  tick: AxisTickInfo | undefined,
  window: { startMs: number; endMs: number },
  use12Hour: boolean = detectUse12Hour()
): string => {
  const date = new Date(value);

  const label = ((): string => {
    switch (tick?.lowerTimeUnit) {
      case "year":
        return spansCalendarUnit("year", window.startMs, window.endMs)
          ? date.toLocaleDateString([], { year: "numeric" })
          : date.toLocaleDateString([], { month: "short" });
      case "month":
        return date.toLocaleDateString([], { month: "short" });
      case "day":
        return spansCalendarUnit("month", window.startMs, window.endMs)
          ? String(date.getDate())
          : date.toLocaleDateString([], { month: "short", day: "numeric" });
      case "hour":
        return date.toLocaleTimeString(
          [],
          use12Hour ? HOUR_ONLY_OPTIONS : HOUR_MINUTE_OPTIONS
        );
      case "minute":
        return date.toLocaleTimeString([], HOUR_MINUTE_OPTIONS);
      // `second`/`millisecond` ticks only appear on a sub-minute custom
      // range; a tick with no `time` info at all (e.g. echarts' own
      // notNice boundary ticks) falls back to the same, most-detailed shape
      // — always unambiguous, never wrong.
      default:
        return date.toLocaleTimeString([], HOUR_MINUTE_SECOND_OPTIONS);
    }
  })();

  // Mirrors echarts' own convention (util/time.js: `{primary|...}` at
  // level >= 1) so the bolded ticks are exactly the ones `hideOverlap` keeps
  // when the axis is crowded.
  return (tick?.level ?? 0) >= 1 ? `{primary|${label}}` : label;
};

const TOOLTIP_HEADER_OPTIONS: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

// The tooltip shows exactly one hovered instant, never several labels at
// once, so — unlike the axis — it doesn't need a tiered cascade: a single
// fully-qualified date/time is always unambiguous. Echarts' own tooltip
// header (`TimeScale.prototype.getLabel`) bypasses `axisLabel.formatter`
// entirely and renders an unlocalized internal template instead, so this
// replaces it outright via `tooltip.formatter`.
export const formatTooltipHeader = (value: number): string =>
  new Date(value).toLocaleString([], TOOLTIP_HEADER_OPTIONS);

// Matches `makeBaseAxes`' grid margins below.
const GRID_MARGIN_PX = 55 + 16;
const TARGET_LABEL_PX = 60;
const MIN_SPLIT_NUMBER = 4;
const MAX_SPLIT_NUMBER = 10;

/**
 * Echarts' tick count is a pure function of `(startMs, endMs, splitNumber)`
 * — never of container pixel width — so a fixed `splitNumber` shows the same
 * tick count on a phone as on a wide monitor. This derives `splitNumber`
 * from the chart's actual plot width instead, clamped to a range that stays
 * useful at this app's chart heights (180px quality charts, 250px speed).
 */
export const computeSplitNumberForWidth = (widthPx: number): number => {
  const plotWidthPx = Math.max(widthPx - GRID_MARGIN_PX, 0);
  const raw = Math.round(plotWidthPx / TARGET_LABEL_PX);
  return Math.min(Math.max(raw, MIN_SPLIT_NUMBER), MAX_SPLIT_NUMBER);
};

// Dotted lines on both axes, faint enough to stay in the background behind
// the data.
const makeSplitLine = (color: string) => ({
  show: true,
  lineStyle: { color, type: "dashed" as const, width: 1, opacity: 0.5 },
});

const makeBaseAxes = (
  theme: Theme,
  startMs: number,
  endMs: number,
  splitNumber: number
) => {
  const { grid, text } = THEME_COLORS[theme];
  return {
    grid: { left: 55, right: 16, top: 16, bottom: 28 },
    // Known echarts limitation, not fixable from this option set: when the
    // window crosses a month boundary, the day-tier ticks on the far side of
    // that boundary can land one day off the regular cadence (e.g. `29 31
    // Aug 2 3` instead of `29 31 Aug 2 4`), since a month whose day count
    // isn't evenly divisible by the chosen day interval leaves a leftover
    // tick from the internal boundary calculation. Reproduces at every
    // splitNumber, including echarts' own default, and is closed upstream as
    // "not planned": https://github.com/apache/echarts/issues/17198. Fixing
    // it would mean overriding tick placement via `axisTick.customValues`,
    // which drops echarts' own tick-tier classification and would require
    // re-deriving it by hand — reintroducing exactly the fragility this
    // formatter (`formatAxisLabel`) was rewritten to avoid.
    xAxis: {
      type: "time" as const,
      min: startMs,
      max: endMs,
      splitNumber,
      axisLabel: {
        color: text,
        fontSize: 11,
        formatter: (
          value: number,
          _index: number,
          extra: { time?: AxisTickInfo } | undefined
        ) => formatAxisLabel(value, extra?.time, { startMs, endMs }),
        // Echarts' time-axis default already merges `rich.primary` with
        // `fontWeight: 'bold'` and no explicit color (inheriting `color`
        // above); this makes that inheritance explicit rather than relying
        // on the merge order surviving a future theme change.
        rich: { primary: { color: text } },
        // Echarts prioritizes by tick tier when hiding collisions (higher
        // date/month ticks over plain time-of-day), so a cramped axis drops
        // the redundant time label rather than mangling both into overlap.
        hideOverlap: true,
      },
      axisPointer: {
        show: true,
        type: "line" as const,
        lineStyle: { color: text, type: "dashed" as const },
      },
      splitLine: makeSplitLine(grid),
    },
    // Declares that this chart's axis pointer should move in step with
    // every other chart in the same echarts.connect() group when either is
    // hovered — echarts.connect() alone only syncs dataZoom, not the
    // pointer.
    axisPointer: {
      link: [{ xAxisIndex: "all" as const }],
    },
  };
};

// Each chart's tooltip carries its own unit/precision, so this builds the
// shared trigger/axisPointer config with a chart-specific value formatter
// rather than living on `makeBaseAxes`. A full `formatter` (rather than
// `valueFormatter`) is required to control the header text; `params[i]`'s
// `marker`/`seriesName` are supplied by echarts itself, so only the header
// and value text need building here.
const makeTooltip = (formatValue: (value: number) => string) => ({
  trigger: "axis" as const,
  axisPointer: { type: "line" as const },
  formatter: (params: unknown): string => {
    if (!Array.isArray(params) || params.length === 0) return "";
    const [first] = params as Array<{ axisValue: unknown }>;
    const header =
      typeof first.axisValue === "number"
        ? formatTooltipHeader(first.axisValue)
        : "";
    const rows = (
      params as Array<{ marker: string; seriesName: string; value: unknown }>
    )
      .map(({ marker, seriesName, value }) => {
        const raw = Array.isArray(value) ? value[1] : value;
        const formatted = typeof raw === "number" ? formatValue(raw) : "-";
        return `${marker}${seriesName}: ${formatted}`;
      })
      .join("<br/>");
    return `${header}<br/>${rows}`;
  },
});

// ECharts' own types declare `data` as a mutable array, so this boundary
// helper returns one rather than this module's usual ReadonlyArray — the
// array is always freshly allocated here, never aliased, so mutability is
// harmless.
const toSeriesData = <A>(
  slots: ReadonlyArray<TimelineSlot<A>>,
  getValue: (point: A) => number | null
): Array<[number, number | null]> =>
  Array_.map(slots, (slot): [number, number | null] => [
    slot.timestamp,
    Option.match(slot.point, {
      onNone: () => null,
      onSome: getValue,
    }),
  ]);

export const makeLatencyChartOption = ({
  slots,
  stats,
  theme,
  startMs,
  endMs,
  splitNumber,
}: {
  slots: ReadonlyArray<TimelineSlot<Pick<Metric, "timestamp" | "latency">>>;
  stats: LatencyStats;
  theme: Theme;
  startMs: number;
  endMs: number;
  splitNumber: number;
}): EChartsOption => ({
  ...makeBaseAxes(theme, startMs, endMs, splitNumber),
  yAxis: {
    type: "value",
    min: 0,
    axisLabel: {
      color: THEME_COLORS[theme].text,
      fontSize: 11,
      formatter: "{value} ms",
    },
    splitLine: makeSplitLine(THEME_COLORS[theme].grid),
  },
  tooltip: makeTooltip((value) => `${value.toFixed(1)} ms`),
  series: [
    {
      type: "line",
      name: "Latency",
      data: toSeriesData(slots, (point) => point.latency ?? null),
      showSymbol: false,
      smooth: true,
      lineStyle: { color: COLORS.primary, width: 2 },
      areaStyle: { color: COLORS.primary, opacity: 0.15 },
      connectNulls: false,
      markLine:
        stats.avg === "-"
          ? undefined
          : {
              symbol: "none",
              lineStyle: { color: COLORS.info, type: "dashed" },
              label: {
                position: "insideStartTop",
                formatter: "Avg",
                color: THEME_COLORS[theme].text,
              },
              data: [{ yAxis: Number(stats.avg) }],
            },
    },
  ],
});

export const makePacketLossChartOption = ({
  slots,
  theme,
  startMs,
  endMs,
  splitNumber,
}: {
  slots: ReadonlyArray<TimelineSlot<Pick<Metric, "timestamp" | "packet_loss">>>;
  stats: PacketLossStats;
  theme: Theme;
  startMs: number;
  endMs: number;
  splitNumber: number;
}): EChartsOption => ({
  ...makeBaseAxes(theme, startMs, endMs, splitNumber),
  yAxis: {
    type: "value",
    min: 0,
    axisLabel: {
      color: THEME_COLORS[theme].text,
      fontSize: 11,
      formatter: "{value}%",
    },
    splitLine: makeSplitLine(THEME_COLORS[theme].grid),
  },
  tooltip: makeTooltip((value) => `${value.toFixed(2)}%`),
  series: [
    {
      type: "line",
      name: "Packet Loss",
      data: toSeriesData(slots, (point) => point.packet_loss ?? null),
      // A flat 0% run draws as a real line on the axis baseline; a gap in
      // the data (no slot) draws nothing, since connectNulls is false.
      showSymbol: false,
      smooth: true,
      lineStyle: { color: COLORS.danger, width: 2 },
      areaStyle: { color: COLORS.danger, opacity: 0.15 },
      connectNulls: false,
    },
  ],
});

const ACCEPTABLE_JITTER_THRESHOLD_MS = 10;

export const makeJitterChartOption = ({
  slots,
  theme,
  startMs,
  endMs,
  splitNumber,
}: {
  slots: ReadonlyArray<TimelineSlot<Pick<Metric, "timestamp" | "jitter">>>;
  stats: JitterStats;
  theme: Theme;
  startMs: number;
  endMs: number;
  splitNumber: number;
}): EChartsOption => ({
  ...makeBaseAxes(theme, startMs, endMs, splitNumber),
  yAxis: {
    type: "value",
    min: 0,
    axisLabel: {
      color: THEME_COLORS[theme].text,
      fontSize: 11,
      formatter: "{value} ms",
    },
    splitLine: makeSplitLine(THEME_COLORS[theme].grid),
  },
  tooltip: makeTooltip((value) => `${value.toFixed(2)} ms`),
  series: [
    {
      type: "line",
      name: "Jitter",
      data: toSeriesData(slots, (point) => point.jitter ?? null),
      showSymbol: false,
      smooth: true,
      lineStyle: { color: COLORS.info, width: 2 },
      areaStyle: { color: COLORS.info, opacity: 0.2 },
      connectNulls: false,
      markLine: {
        symbol: "none",
        lineStyle: { color: COLORS.warning, type: "dashed" },
        label: {
          position: "insideStartTop",
          formatter: "Acceptable",
          color: COLORS.warning,
        },
        data: [{ yAxis: ACCEPTABLE_JITTER_THRESHOLD_MS }],
      },
    },
  ],
});

export const makeSpeedChartOption = ({
  metrics,
  theme,
  startMs,
  endMs,
  splitNumber,
}: {
  metrics: ReadonlyArray<
    Pick<SpeedMetric, "timestamp" | "download_speed" | "upload_speed">
  >;
  stats: SpeedStats;
  theme: Theme;
  startMs: number;
  endMs: number;
  splitNumber: number;
}): EChartsOption => {
  const sorted = Array_.sortWith(
    metrics,
    (metric) => new Date(metric.timestamp).getTime(),
    Order.Number
  );
  const toPair = (
    getValue: (metric: (typeof sorted)[number]) => number
  ): Array<[number, number]> =>
    Array_.map(sorted, (metric): [number, number] => [
      new Date(metric.timestamp).getTime(),
      getValue(metric),
    ]);

  const base = makeBaseAxes(theme, startMs, endMs, splitNumber);

  return {
    ...base,
    // Extends the shared bottom margin to also fit the legend row below the
    // x-axis labels — echarts lays out the legend and grid independently, so
    // without this the legend's default bottom position overlaps the axis.
    grid: { ...base.grid, bottom: 52 },
    yAxis: {
      type: "value",
      min: 0,
      axisLabel: {
        color: THEME_COLORS[theme].text,
        fontSize: 11,
        formatter: "{value} Mbps",
      },
      splitLine: makeSplitLine(THEME_COLORS[theme].grid),
    },
    tooltip: makeTooltip((value) => `${value.toFixed(1)} Mbps`),
    legend: { bottom: 4, textStyle: { color: THEME_COLORS[theme].text } },
    series: [
      {
        type: "line",
        name: "Download",
        data: toPair((metric) => metric.download_speed),
        smooth: true,
        lineStyle: { color: COLORS.primary, width: 2 },
        areaStyle: { color: COLORS.primary, opacity: 0.1 },
      },
      {
        type: "line",
        name: "Upload",
        data: toPair((metric) => metric.upload_speed),
        smooth: true,
        lineStyle: { color: COLORS.success, width: 2 },
        areaStyle: { color: COLORS.success, opacity: 0.1 },
      },
    ],
  };
};
