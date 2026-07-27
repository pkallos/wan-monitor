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

// Always hour:minute, never a day-boundary label, even across multi-day
// ranges.
const formatAxisTime = (value: number): string =>
  new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

// Dotted lines on both axes, faint enough to stay in the background behind
// the data.
const makeSplitLine = (color: string) => ({
  show: true,
  lineStyle: { color, type: "dashed" as const, width: 1, opacity: 0.5 },
});

const makeBaseAxes = (theme: Theme) => {
  const { grid, text } = THEME_COLORS[theme];
  return {
    grid: { left: 55, right: 16, top: 16, bottom: 28 },
    xAxis: {
      type: "time" as const,
      axisLabel: {
        color: text,
        fontSize: 11,
        formatter: formatAxisTime,
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
// rather than living on `makeBaseAxes`.
const makeTooltip = (formatValue: (value: number) => string) => ({
  trigger: "axis" as const,
  axisPointer: { type: "line" as const },
  valueFormatter: (value: unknown) =>
    typeof value === "number" ? formatValue(value) : "-",
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
}: {
  slots: ReadonlyArray<TimelineSlot<Pick<Metric, "timestamp" | "latency">>>;
  stats: LatencyStats;
  theme: Theme;
}): EChartsOption => ({
  ...makeBaseAxes(theme),
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
}: {
  slots: ReadonlyArray<TimelineSlot<Pick<Metric, "timestamp" | "packet_loss">>>;
  stats: PacketLossStats;
  theme: Theme;
}): EChartsOption => ({
  ...makeBaseAxes(theme),
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
}: {
  slots: ReadonlyArray<TimelineSlot<Pick<Metric, "timestamp" | "jitter">>>;
  stats: JitterStats;
  theme: Theme;
}): EChartsOption => ({
  ...makeBaseAxes(theme),
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
}: {
  metrics: ReadonlyArray<
    Pick<SpeedMetric, "timestamp" | "download_speed" | "upload_speed">
  >;
  stats: SpeedStats;
  theme: Theme;
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

  return {
    ...makeBaseAxes(theme),
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
    legend: { textStyle: { color: THEME_COLORS[theme].text } },
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
