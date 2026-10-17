import type { Metric } from "@shared/api/routes/metrics";
import type { SpeedMetric } from "@shared/api/routes/speedtest";
import { PACKET_LOSS_THRESHOLDS } from "@wan-monitor/shared";
import type { EChartsOption } from "echarts/types/dist/shared";
import { Array as Array_, Option, Order } from "effect";
import type { ChartPalette } from "@/dashboard/charts/chartTheme";
import type { LatencyStats } from "@/dashboard/charts/stats";
import { speedMedians, testsAreDense } from "@/dashboard/charts/stats";
import type { TimelineSlot } from "@/dashboard/charts/timeline";
import { FULL_ZOOM, type ZoomRange } from "@/dashboard/charts/zoom";
import { isLocalMidnight } from "@/dashboard/format";
import type { Incident } from "@/dashboard/incidents";

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

const GRID_LEFT_PX = 55;
const GRID_RIGHT_PX = 16;
const GRID_TOP_PX = 16;
// Matches `makeBaseAxes`' grid margins below.
const GRID_MARGIN_PX = GRID_LEFT_PX + GRID_RIGHT_PX;

/** The chart width layout assumes when a caller has not measured one. */
const DEFAULT_CHART_WIDTH_PX = 800;
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
  palette: ChartPalette,
  startMs: number,
  endMs: number,
  splitNumber: number
) => {
  const text = palette.inkSecondary;
  return {
    textStyle: { fontFamily: palette.fontFamily },
    grid: {
      left: GRID_LEFT_PX,
      right: GRID_RIGHT_PX,
      top: GRID_TOP_PX,
      bottom: 28,
    },
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
      splitLine: makeSplitLine(palette.rule),
    },
  };
};

// Each chart's tooltip carries its own unit/precision, so this builds the
// shared trigger/axisPointer config with a chart-specific value formatter
// rather than living on `makeBaseAxes`. A full `formatter` (rather than
// `valueFormatter`) is required to control the header text; `params[i]`'s
// `marker`/`seriesName` are supplied by echarts itself, so only the header
// and value text need building here.
//
// A series plotted as an offset on a stack (the p95 band rides on p50) carries
// the value to show as a third element of each point, and a series that only
// draws a connecting line adds nothing to a row, so `skipSeries` drops it.
const makeTooltip = (
  palette: ChartPalette,
  formatValue: (value: number) => string,
  skipSeries: ReadonlySet<string> = new Set()
) => ({
  trigger: "axis" as const,
  axisPointer: {
    type: "line" as const,
    lineStyle: { color: palette.inkSecondary },
  },
  backgroundColor: palette.card,
  borderColor: palette.rule,
  borderWidth: 1,
  borderRadius: 12,
  padding: [8, 12],
  shadowBlur: 0,
  shadowColor: "transparent",
  textStyle: {
    color: palette.ink,
    fontSize: 12,
    fontFamily: palette.fontFamily,
  },
  extraCssText: "font-variant-numeric: tabular-nums;",
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
      .filter(({ seriesName }) => !skipSeries.has(seriesName))
      .map(({ marker, seriesName, value }) => {
        const raw = Array.isArray(value) ? (value[2] ?? value[1]) : value;
        const formatted = typeof raw === "number" ? formatValue(raw) : "-";
        return `${marker}${seriesName}: ${formatted}`;
      })
      .join("<br/>");
    return `${header}<br/>${rows}`;
  },
});

const makeValueAxis = (palette: ChartPalette, formatter: string) => ({
  type: "value" as const,
  min: 0,
  axisLabel: {
    color: palette.inkSecondary,
    fontSize: 11,
    formatter,
  },
  splitLine: makeSplitLine(palette.rule),
});

// Zooming is for the x axis only and rides the wheel with Ctrl held (or a
// trackpad pinch), so scrolling the page over a chart still scrolls it, and a
// plain drag is free for the latency chart's range brush.
const makeZoom = ({ start, end }: ZoomRange) => [
  {
    type: "inside" as const,
    xAxisIndex: 0,
    start,
    end,
    filterMode: "none" as const,
    zoomOnMouseWheel: "ctrl" as const,
    moveOnMouseWheel: false,
    moveOnMouseMove: false,
  },
];

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

const incidentColor = (
  palette: ChartPalette,
  status: Incident["status"]
): string => (status === "down" ? palette.down : palette.degraded);

/** A dashed line across the value axis at a reference level for the metric. */
type Threshold = Readonly<{ value: number; label: string }>;

const PACKET_LOSS_THRESHOLD: Threshold = {
  value: PACKET_LOSS_THRESHOLDS.degradedFloor,
  label: `Degraded at ${PACKET_LOSS_THRESHOLDS.degradedFloor}%`,
};

/**
 * Latency in milliseconds at or above which the latency chart draws its
 * threshold line. A fixed rule of thumb, not derived from the data.
 */
export const LATENCY_THRESHOLD_MS = 50;

const LATENCY_THRESHOLD: Threshold = {
  value: LATENCY_THRESHOLD_MS,
  label: `Reference ${LATENCY_THRESHOLD_MS} ms`,
};

const valuesOf = <A>(
  slots: ReadonlyArray<TimelineSlot<A>>,
  getValue: (point: A) => number | null
): ReadonlyArray<number | null> =>
  Array_.map(slots, (slot) =>
    Option.match(slot.point, { onNone: () => null, onSome: getValue })
  );

// Reference labels are boxed on the card colour so they stay legible where
// they cross the series; a threshold's sits at the start of its line and the
// average's at the end, so the two never share a side.
const referenceLabel = (
  palette: ChartPalette,
  text: string,
  position: "insideStartTop" | "insideStartBottom" | "insideEndTop"
) => ({
  show: true,
  position,
  formatter: text,
  color: palette.inkSecondary,
  fontSize: 11,
  backgroundColor: palette.card,
  borderRadius: 3,
  padding: [1, 4],
});

// The axis tops out at or just above the highest value, so a line that value
// only just reaches sits at the very top of the plot, and a label above it
// would land in the row of incident chips. A line the data has not reached is
// not in the plot at all.
const LABEL_ABOVE_HEADROOM_RATIO = 1.2;

const peakOf = (values: ReadonlyArray<number | null>): number =>
  Math.max(0, ...Array_.filter(values, (v) => v !== null));

const thresholdLabel = (
  palette: ChartPalette,
  threshold: Threshold,
  peak: number
) =>
  referenceLabel(
    palette,
    threshold.label,
    peak >= threshold.value &&
      peak < threshold.value * LABEL_ABOVE_HEADROOM_RATIO
      ? "insideStartBottom"
      : "insideStartTop"
  );

// A line the data never climbs to would sit above the plot, its label with it,
// so it is only drawn once a value reaches it.
const thresholdLines = (
  threshold: Threshold,
  values: ReadonlyArray<number | null>,
  palette: ChartPalette
) => {
  const peak = peakOf(values);
  return peak >= threshold.value
    ? [
        {
          yAxis: threshold.value,
          lineStyle: {
            color: palette.inkSecondary,
            type: "dashed" as const,
            width: 1,
          },
          label: thresholdLabel(palette, threshold, peak),
        },
      ]
    : [];
};

const markAreaOf = (
  incidents: ReadonlyArray<Incident>,
  palette: ChartPalette
) =>
  incidents.length === 0
    ? undefined
    : {
        silent: true,
        data: Array_.map(
          incidents,
          (
            incident
          ): [{ xAxis: number; itemStyle: object }, { xAxis: number }] => [
            {
              xAxis: incident.startMs,
              itemStyle: {
                color: incidentColor(palette, incident.status),
                opacity: 0.16,
              },
            },
            { xAxis: incident.endMs },
          ]
        ),
      };

// A chip is the incident's letter in a bordered box; its width is estimated
// from the text, as canvas text cannot be measured before it is drawn.
const CHIP_CHAR_PX = 7;
const CHIP_CHROME_PX = 10;
const CHIP_GAP_PX = 4;
/** The room above the plot that a row of chips needs. */
const CHIP_ROW_PX = 28;

const chipWidthPx = (text: string): number =>
  CHIP_CHROME_PX + CHIP_CHAR_PX * text.length;

const withChipRow = <G extends { top: number }>(
  grid: G,
  chipLabels: ReadonlyMap<string, string>
): G => ({
  ...grid,
  top: grid.top + (chipLabels.size > 0 ? CHIP_ROW_PX : 0),
});

type ChipCluster = Readonly<{
  head: Incident;
  last: Incident;
  label: string;
  centerPx: number;
  leftPx: number;
  rightPx: number;
}>;

// A chip is centred on its head incident, so a longer label grows both ways.
const clusterOf = (
  head: Incident,
  last: Incident,
  centerPx: number
): ChipCluster => {
  const label = head.ref === last.ref ? head.ref : `${head.ref}–${last.ref}`;
  const halfWidthPx = chipWidthPx(label) / 2;
  return {
    head,
    last,
    label,
    centerPx,
    leftPx: centerPx - halfWidthPx,
    rightPx: centerPx + halfWidthPx,
  };
};

const touches = (left: ChipCluster, right: ChipCluster): boolean =>
  right.leftPx < left.rightPx + CHIP_GAP_PX;

// A chip that widened by absorbing a neighbour can reach back into the chip
// before it, so the fold carries on leftwards until every pair has room.
const foldLeftwards = (
  clusters: ReadonlyArray<ChipCluster>
): ReadonlyArray<ChipCluster> => {
  const last = clusters[clusters.length - 1];
  const before = clusters[clusters.length - 2];
  if (last === undefined || before === undefined || !touches(before, last)) {
    return clusters;
  }
  return foldLeftwards([
    ...clusters.slice(0, -2),
    clusterOf(before.head, last.last, before.centerPx),
  ]);
};

const NO_CLUSTERS: ReadonlyArray<ChipCluster> = [];

/**
 * The text of each chip that is drawn, by incident ref. Incidents that start
 * close enough for their chips to touch share one chip over the first of them,
 * lettered as the span they cover ("A–C"), the way the availability ribbon
 * folds close incidents; a ref with no entry draws no chip of its own.
 */
const incidentChipLabels = (
  incidents: ReadonlyArray<Incident>,
  {
    startMs,
    endMs,
    widthPx,
  }: { startMs: number; endMs: number; widthPx: number }
): ReadonlyMap<string, string> => {
  const plotPx = Math.max(widthPx - GRID_MARGIN_PX, 1);
  const spanMs = Math.max(endMs - startMs, 1);
  const inWindow = Array_.filter(
    incidents,
    (incident) => incident.startMs >= startMs && incident.startMs <= endMs
  );
  const clusters = Array_.reduce(
    Array_.sortBy(Order.mapInput(Order.Number, (i: Incident) => i.startMs))(
      inWindow
    ),
    NO_CLUSTERS,
    (acc, incident) => {
      const own = clusterOf(
        incident,
        incident,
        GRID_LEFT_PX + ((incident.startMs - startMs) / spanMs) * plotPx
      );
      const previous = acc[acc.length - 1];
      return previous === undefined || !touches(previous, own)
        ? [...acc, own]
        : foldLeftwards([
            ...acc.slice(0, -1),
            clusterOf(previous.head, incident, previous.centerPx),
          ]);
    }
  );
  return new Map(Array_.map(clusters, ({ head, label }) => [head.ref, label]));
};

/**
 * A line at each incident's start. It is what stays visible when the shaded
 * span is narrower than a pixel, as a minutes-long outage is on a week-wide
 * chart. A down incident's line is solid and a degraded one's is dashed, so the
 * two differ by more than colour; the chip's letter matches the ref in the
 * incident log.
 */
const incidentMarkLines = (
  incidents: ReadonlyArray<Incident>,
  chipLabels: ReadonlyMap<string, string>,
  palette: ChartPalette
) =>
  Array_.map(incidents, (incident) => {
    const color = incidentColor(palette, incident.status);
    return {
      xAxis: incident.startMs,
      lineStyle: {
        color,
        width: 1.5,
        type:
          incident.status === "down" ? ("solid" as const) : ("dashed" as const),
      },
      label: {
        show: chipLabels.has(incident.ref),
        position: "end" as const,
        formatter: chipLabels.get(incident.ref) ?? incident.ref,
        color: palette.ink,
        fontSize: 11,
        fontWeight: 600,
        backgroundColor: palette.card,
        borderColor: color,
        borderWidth: 1,
        borderRadius: 4,
        padding: [1, 4],
      },
    };
  });

type LatencyPoint = Pick<
  Metric,
  "timestamp" | "latency" | "latency_p50" | "latency_p95"
>;

/** One host's latency over the window, bucketed like the all-hosts series. */
export type HostLatencySeries = Readonly<{
  host: string;
  slots: ReadonlyArray<TimelineSlot<LatencyPoint>>;
}>;

const hasPercentiles = (slots: ReadonlyArray<TimelineSlot<LatencyPoint>>) =>
  Array_.some(slots, (slot) =>
    Option.exists(slot.point, (point) => point.latency_p50 !== undefined)
  );

const lineSeries = (name: string, color: string, width = 2) => ({
  type: "line" as const,
  name,
  showSymbol: false,
  lineStyle: { color, width },
  itemStyle: { color },
  connectNulls: false,
});

// The p50 line, with the p95 above it as a band: the band is the gap between
// the two, so it rides on p50 as a stacked series whose points carry p95 as
// the value to show.
const latencyPercentileSeries = (
  slots: ReadonlyArray<TimelineSlot<LatencyPoint>>,
  palette: ChartPalette
) => {
  const p50 = toSeriesData(slots, (point) => point.latency_p50 ?? null);
  const band = Array_.map(slots, (slot): [number, number | null, number?] =>
    Option.match(slot.point, {
      onNone: () => [slot.timestamp, null],
      onSome: ({ latency_p50, latency_p95 }) =>
        latency_p50 === undefined || latency_p95 === undefined
          ? [slot.timestamp, null]
          : [
              slot.timestamp,
              Math.max(latency_p95 - latency_p50, 0),
              latency_p95,
            ],
    })
  );
  return [
    {
      ...lineSeries("p50", palette.accent),
      stack: "latency",
      data: p50,
    },
    {
      ...lineSeries("p95", palette.accent, 1),
      stack: "latency",
      data: band,
      // The band's fill is too faint to carry p95 on its own, so its upper edge
      // is drawn at full strength.
      lineStyle: { color: palette.accent, width: 1 },
      areaStyle: { color: palette.band },
    },
  ];
};

export const hostLatencyOf = (point: LatencyPoint): number | null =>
  point.latency_p50 ?? point.latency ?? null;

export const makeLatencyChartOption = ({
  slots,
  hostSeries = [],
  stats,
  palette,
  incidents,
  startMs,
  endMs,
  splitNumber,
  widthPx = DEFAULT_CHART_WIDTH_PX,
  zoom = FULL_ZOOM,
}: {
  slots: ReadonlyArray<TimelineSlot<LatencyPoint>>;
  /** One line per host instead of the all-hosts line, when present. */
  hostSeries?: ReadonlyArray<HostLatencySeries>;
  stats: LatencyStats;
  palette: ChartPalette;
  incidents: ReadonlyArray<Incident>;
  startMs: number;
  endMs: number;
  splitNumber: number;
  widthPx?: number;
  zoom?: ZoomRange;
}): EChartsOption => {
  const base = makeBaseAxes(palette, startMs, endMs, splitNumber);
  const chipLabels = incidentChipLabels(incidents, { startMs, endMs, widthPx });
  const isPerHost = hostSeries.length > 0;
  const thresholds = thresholdLines(
    LATENCY_THRESHOLD,
    isPerHost
      ? Array_.flatMap(hostSeries, (host) =>
          valuesOf(host.slots, hostLatencyOf)
        )
      : valuesOf(
          slots,
          (point) =>
            point.latency_p95 ?? point.latency_p50 ?? point.latency ?? null
        ),
    palette
  );
  // The average only means something for the single all-hosts line.
  const showsAverage = !isPerHost && stats.avg !== "-";
  const shared = {
    markArea: markAreaOf(incidents, palette),
    markLine:
      showsAverage || thresholds.length > 0 || incidents.length > 0
        ? {
            symbol: "none",
            silent: true,
            lineStyle: {
              color: palette.inkSecondary,
              type: "dashed" as const,
            },
            data: [
              ...(showsAverage
                ? [
                    {
                      yAxis: Number(stats.avg),
                      label: referenceLabel(
                        palette,
                        `Avg ${stats.avg} ms`,
                        "insideEndTop"
                      ),
                    },
                  ]
                : []),
              ...thresholds,
              ...incidentMarkLines(incidents, chipLabels, palette),
            ],
          }
        : undefined,
  };

  const series = isPerHost
    ? [
        ...Array_.map(hostSeries, (host, index) => ({
          ...lineSeries(host.host, hostColor(palette, index)),
          lineStyle: {
            color: hostColor(palette, index),
            width: 2,
            type:
              index < palette.series.length
                ? ("solid" as const)
                : ("dashed" as const),
          },
          data: toSeriesData(host.slots, hostLatencyOf),
        })),
        // Hiding a host in the legend must not take the incidents with it.
        {
          ...lineSeries(REFERENCE_SERIES, palette.inkSecondary),
          data: [],
          ...shared,
        },
      ]
    : hasPercentiles(slots)
      ? latencyPercentileSeries(slots, palette).map((entry, index) =>
          index === 0 ? { ...entry, ...shared } : entry
        )
      : [
          {
            ...lineSeries("Latency", palette.accent),
            data: toSeriesData(slots, (point) => point.latency ?? null),
            areaStyle: { color: palette.band },
            ...shared,
          },
        ];

  return {
    ...base,
    dataZoom: makeZoom(zoom),
    // The brush needs the toolbox component, which draws its own buttons
    // unless told not to; the stroke is started by a plain drag instead.
    toolbox: { show: false },
    brush: makeBrush(palette),
    // Per-host mode names its lines in a legend, and incident chips sit in a
    // row of their own; each needs room above the plot.
    grid: withChipRow(
      { ...base.grid, top: base.grid.top + (isPerHost ? LEGEND_ROW_PX : 0) },
      chipLabels
    ),
    legend: isPerHost
      ? {
          top: 0,
          right: 8,
          data: Array_.map(hostSeries, (host) => host.host),
          icon: "roundRect",
          itemWidth: 14,
          itemHeight: 3,
          itemGap: 16,
          textStyle: {
            color: palette.inkSecondary,
            fontFamily: palette.fontFamily,
          },
        }
      : undefined,
    yAxis: makeValueAxis(palette, "{value} ms"),
    tooltip: makeTooltip(palette, (value) => `${value.toFixed(1)} ms`),
    series,
  };
};

const REFERENCE_SERIES = "Reference lines";
const LEGEND_ROW_PX = 20;

const hostColor = (palette: ChartPalette, index: number): string =>
  palette.series[index % palette.series.length] ?? palette.accent;

// A plain drag across the latency chart selects a span of time; the page turns
// the committed selection into its date range (see `rangeFromBrush`).
const makeBrush = (palette: ChartPalette) => ({
  xAxisIndex: 0,
  brushType: "lineX" as const,
  brushMode: "single" as const,
  transformable: false,
  removeOnClick: true,
  brushStyle: {
    color: palette.band,
    borderColor: palette.accent,
    borderWidth: 1,
  },
});

// The bar for each bucket spans the bucket, which echarts works out from the
// spacing of the points, so every slot is present, a gap as a null.
export const makePacketLossChartOption = ({
  slots,
  palette,
  incidents,
  startMs,
  endMs,
  splitNumber,
  widthPx = DEFAULT_CHART_WIDTH_PX,
  zoom = FULL_ZOOM,
}: {
  slots: ReadonlyArray<TimelineSlot<Pick<Metric, "timestamp" | "packet_loss">>>;
  palette: ChartPalette;
  incidents: ReadonlyArray<Incident>;
  startMs: number;
  endMs: number;
  splitNumber: number;
  widthPx?: number;
  zoom?: ZoomRange;
}): EChartsOption => {
  const base = makeBaseAxes(palette, startMs, endMs, splitNumber);
  const chipLabels = incidentChipLabels(incidents, { startMs, endMs, widthPx });
  const lossThresholds = thresholdLines(
    PACKET_LOSS_THRESHOLD,
    valuesOf(slots, (point) => point.packet_loss ?? null),
    palette
  );
  return {
    ...base,
    grid: withChipRow(base.grid, chipLabels),
    dataZoom: makeZoom(zoom),
    yAxis: makeValueAxis(palette, "{value}%"),
    tooltip: makeTooltip(palette, (value) => `${value.toFixed(2)}%`),
    series: [
      {
        type: "bar",
        name: "Packet loss",
        data: toSeriesData(slots, (point) => point.packet_loss ?? null),
        barMinWidth: 1,
        barCategoryGap: "10%",
        itemStyle: { color: palette.down },
        markArea: markAreaOf(incidents, palette),
        markLine:
          lossThresholds.length === 0 && incidents.length === 0
            ? undefined
            : {
                symbol: "none",
                silent: true,
                data: [
                  ...lossThresholds,
                  ...incidentMarkLines(incidents, chipLabels, palette),
                ],
              },
      },
    ],
  };
};

const ACCEPTABLE_JITTER_THRESHOLD_MS = 10;
const JITTER_THRESHOLD: Threshold = {
  value: ACCEPTABLE_JITTER_THRESHOLD_MS,
  label: `Reference ${ACCEPTABLE_JITTER_THRESHOLD_MS} ms`,
};

export const makeJitterChartOption = ({
  slots,
  palette,
  incidents,
  startMs,
  endMs,
  splitNumber,
  widthPx = DEFAULT_CHART_WIDTH_PX,
  zoom = FULL_ZOOM,
}: {
  slots: ReadonlyArray<TimelineSlot<Pick<Metric, "timestamp" | "jitter">>>;
  palette: ChartPalette;
  incidents: ReadonlyArray<Incident>;
  startMs: number;
  endMs: number;
  splitNumber: number;
  widthPx?: number;
  zoom?: ZoomRange;
}): EChartsOption => {
  const base = makeBaseAxes(palette, startMs, endMs, splitNumber);
  const chipLabels = incidentChipLabels(incidents, { startMs, endMs, widthPx });
  return {
    ...base,
    grid: withChipRow(base.grid, chipLabels),
    dataZoom: makeZoom(zoom),
    yAxis: makeValueAxis(palette, "{value} ms"),
    tooltip: makeTooltip(palette, (value) => `${value.toFixed(2)} ms`),
    series: [
      {
        type: "line",
        name: "Jitter",
        data: toSeriesData(slots, (point) => point.jitter ?? null),
        showSymbol: false,
        lineStyle: { color: palette.inkSecondary, width: 2 },
        areaStyle: { color: palette.inkSecondary, opacity: 0.12 },
        itemStyle: { color: palette.inkSecondary },
        connectNulls: false,
        markArea: markAreaOf(incidents, palette),
        markLine: {
          symbol: "none",
          silent: true,
          lineStyle: { color: palette.degraded, type: "dashed" },
          data: [
            {
              yAxis: JITTER_THRESHOLD.value,
              label: thresholdLabel(
                palette,
                JITTER_THRESHOLD,
                peakOf(valuesOf(slots, (point) => point.jitter ?? null))
              ),
            },
            ...incidentMarkLines(incidents, chipLabels, palette),
          ],
        },
      },
    ],
  };
};

type MedianLabelPlacement = Readonly<{
  position: "insideEndTop" | "insideEndBottom";
  offset?: [number, number];
}>;

const MEDIAN_LABEL_HEIGHT_PX = 16;
// Labels collide once the medians sit within this share of the plotted range.
const CLOSE_MEDIANS_RATIO = 0.1;
// A label below a line this close to the axis would run into the tick labels.
const NEAR_AXIS_RATIO = 0.08;

const ABOVE: MedianLabelPlacement = { position: "insideEndTop" };

/**
 * Each median label sits above its own line. Medians close enough for those
 * labels to collide put the lower label below its line instead, unless that
 * line is near the axis: then both stay above and the higher label is lifted
 * by one label height. `peak` is the highest plotted value, which sets the
 * scale for "near the axis".
 */
const medianLabelPlacements = (
  medians: ReturnType<typeof speedMedians>,
  peak: number
): Record<"download" | "upload", MedianLabelPlacement> => {
  const { download, upload } = medians;
  if (download === null || upload === null) {
    return { download: ABOVE, upload: ABOVE };
  }
  const high = Math.max(download, upload);
  const low = Math.min(download, upload);
  if (high - low >= peak * CLOSE_MEDIANS_RATIO) {
    return { download: ABOVE, upload: ABOVE };
  }
  if (low < peak * NEAR_AXIS_RATIO) {
    const lifted: MedianLabelPlacement = {
      ...ABOVE,
      offset: [0, -MEDIAN_LABEL_HEIGHT_PX],
    };
    return download >= upload
      ? { download: lifted, upload: ABOVE }
      : { download: ABOVE, upload: lifted };
  }
  const below: MedianLabelPlacement = { position: "insideEndBottom" };
  return download >= upload
    ? { download: ABOVE, upload: below }
    : { download: below, upload: ABOVE };
};

const DOWNLOAD_LINE = "Download line";
const UPLOAD_LINE = "Upload line";

export const makeSpeedChartOption = ({
  metrics,
  palette,
  startMs,
  endMs,
  splitNumber,
}: {
  metrics: ReadonlyArray<
    Pick<SpeedMetric, "timestamp" | "download_speed" | "upload_speed">
  >;
  palette: ChartPalette;
  startMs: number;
  endMs: number;
  splitNumber: number;
}): EChartsOption => {
  const sorted = Array_.sortWith(
    metrics,
    (metric) => new Date(metric.timestamp).getTime(),
    Order.Number
  );
  // Null renders as a gap rather than a plotted zero, matching how the other
  // charts represent a reading that carries no value for their metric.
  const toPair = (
    getValue: (metric: (typeof sorted)[number]) => number | null
  ): Array<[number, number | null]> =>
    Array_.map(sorted, (metric): [number, number | null] => [
      new Date(metric.timestamp).getTime(),
      getValue(metric),
    ]);
  const download = toPair((metric) => metric.download_speed ?? null);
  const upload = toPair((metric) => metric.upload_speed ?? null);
  const isDense = testsAreDense(
    Array_.map(sorted, (metric) => new Date(metric.timestamp).getTime())
  );

  // A thin line joins the points only when tests come about hourly or more
  // often: further apart, a line would assert a trend between tests that says
  // nothing about the hours between them.
  const joinedBy = (name: string, data: typeof download, color: string) =>
    isDense
      ? [
          {
            type: "line" as const,
            name,
            data,
            symbol: "none",
            silent: true,
            lineStyle: { color, width: 1, opacity: 0.6 },
            connectNulls: false,
          },
        ]
      : [];

  const medianLine = (
    value: number | null,
    color: string,
    label: MedianLabelPlacement
  ) =>
    value === null
      ? []
      : [
          {
            yAxis: value,
            lineStyle: { color, type: "dashed" as const, width: 1.5 },
            label: {
              ...label,
              formatter: `${value.toFixed(0)} Mbps`,
              color,
              backgroundColor: palette.card,
              borderRadius: 3,
              padding: [1, 4],
            },
          },
        ];

  const [downloadColor, uploadColor] = palette.series;
  const medians = speedMedians(sorted);
  const placements = medianLabelPlacements(
    medians,
    Math.max(
      0,
      ...Array_.filter(
        Array_.map([...download, ...upload], ([, value]) => value),
        (value) => value !== null
      )
    )
  );
  const base = makeBaseAxes(palette, startMs, endMs, splitNumber);

  return {
    ...base,
    // Extends the shared bottom margin to also fit the legend row below the
    // x-axis labels — echarts lays out the legend and grid independently, so
    // without this the legend's default bottom position overlaps the axis.
    grid: { ...base.grid, bottom: 52 },
    yAxis: makeValueAxis(palette, "{value} Mbps"),
    tooltip: makeTooltip(
      palette,
      (value) => `${value.toFixed(1)} Mbps`,
      new Set([DOWNLOAD_LINE, UPLOAD_LINE])
    ),
    legend: {
      bottom: 4,
      data: ["Download", "Upload", "Median"],
      textStyle: {
        color: palette.inkSecondary,
        fontFamily: palette.fontFamily,
      },
    },
    series: [
      ...joinedBy(DOWNLOAD_LINE, download, downloadColor),
      ...joinedBy(UPLOAD_LINE, upload, uploadColor),
      {
        type: "scatter",
        name: "Download",
        data: download,
        symbol: "circle",
        symbolSize: 7,
        itemStyle: { color: downloadColor },
      },
      {
        type: "scatter",
        name: "Upload",
        data: upload,
        symbol: "diamond",
        symbolSize: 8,
        itemStyle: { color: uploadColor },
      },
      // Carries the legend entry and both reference lines; it has no points.
      {
        type: "line",
        name: "Median",
        data: [],
        symbol: "none",
        lineStyle: { color: palette.inkSecondary, type: "dashed", width: 1.5 },
        itemStyle: { color: palette.inkSecondary },
        markLine: {
          symbol: "none",
          silent: true,
          data: [
            ...medianLine(medians.download, downloadColor, placements.download),
            ...medianLine(medians.upload, uploadColor, placements.upload),
          ],
        },
      },
    ],
  };
};
