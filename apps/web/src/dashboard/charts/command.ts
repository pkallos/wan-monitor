import { GranularitySchema, MetricSchema } from "@shared/api/routes/metrics";
import { SpeedMetricSchema } from "@shared/api/routes/speedtest";
import type { EChartsType } from "echarts/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts/types/dist/shared";
import type { Scope } from "effect";
import { Effect, Option, Schema as S } from "effect";
import { Command, Mount } from "foldkit";
import {
  chartEvents,
  getChart,
  removeChart,
  setChart,
} from "@/dashboard/charts/chartHost";
import {
  type ChartPalette,
  readChartPalette,
} from "@/dashboard/charts/chartTheme";
import {
  computeSplitNumberForWidth,
  makeJitterChartOption,
  makeLatencyChartOption,
  makePacketLossChartOption,
  makeSpeedChartOption,
} from "@/dashboard/charts/options";
import { calculateLatencyStats } from "@/dashboard/charts/stats";
import { fillTimeline } from "@/dashboard/charts/timeline";
import {
  carryZoom,
  FULL_ZOOM,
  type PaintedWindow,
  type ZoomRange,
} from "@/dashboard/charts/zoom";
import { Incident } from "@/dashboard/incidents";
import {
  CompletedSyncJitterChart,
  CompletedSyncLatencyChart,
  CompletedSyncPacketLossChart,
  CompletedSyncSpeedChart,
  FailedMountJitterChart,
  FailedMountLatencyChart,
  FailedMountPacketLossChart,
  FailedMountSpeedChart,
  FailedSyncJitterChart,
  FailedSyncLatencyChart,
  FailedSyncPacketLossChart,
  FailedSyncSpeedChart,
  SucceededMountJitterChart,
  SucceededMountLatencyChart,
  SucceededMountPacketLossChart,
  SucceededMountSpeedChart,
} from "@/dashboard/message";

// The quality charts share one hover cursor and one zoom. echarts.connect()
// would also open a tooltip on every member for each hover, so the crosshair
// is drawn by hand onto each sibling's zrender layer and the zoom is
// forwarded by hand.
const QUALITY_CHARTS_GROUP = "quality-charts";

const groupMembers = new Map<string, Set<EChartsType>>();
const crosshairs = new Map<
  EChartsType,
  InstanceType<typeof echarts.graphic.Line>
>();

const clearCrosshair = (chart: EChartsType): void => {
  const existing = crosshairs.get(chart);
  if (existing === undefined) return;
  chart.getZr().remove(existing);
  crosshairs.delete(chart);
};

const drawCrosshair = (
  chart: EChartsType,
  pixelX: number,
  stroke: string
): void => {
  clearCrosshair(chart);
  const line = new echarts.graphic.Line({
    shape: { x1: pixelX, y1: 0, x2: pixelX, y2: chart.getHeight() },
    style: { stroke, lineDash: [4, 4], lineWidth: 1 },
    silent: true,
    z: 1000,
  });
  chart.getZr().add(line);
  crosshairs.set(chart, line);
};

// echarts' own event-listener typings erase every payload to `unknown`, so
// this is decoded (not cast) at the boundary before use.
const AxisPointerEventSchema = S.Struct({
  axesInfo: S.optional(
    S.Array(
      S.Struct({
        axisDim: S.String,
        axisIndex: S.Number,
        value: S.Number,
      })
    )
  ),
});
const decodeAxisPointerEvent = S.decodeUnknownOption(AxisPointerEventSchema);

// What echarts reports when the viewer zooms: one entry per zoom component.
const DataZoomEventSchema = S.Struct({
  batch: S.Array(S.Struct({ start: S.Number, end: S.Number })),
});
const decodeDataZoomEvent = S.decodeUnknownOption(DataZoomEventSchema);

// Joins `chart` to `group`'s hover and zoom sync and returns the cleanup to
// run on unmount.
const joinChartGroup = (chart: EChartsType, group: string): (() => void) => {
  const members = groupMembers.get(group) ?? new Set<EChartsType>();
  members.add(chart);
  groupMembers.set(group, members);

  const onUpdateAxisPointer = (event: unknown) => {
    Option.match(decodeAxisPointerEvent(event), {
      onNone: () => {},
      onSome: (decoded) => {
        const xAxisInfo = decoded.axesInfo?.find(
          (info) => info.axisDim === "x"
        );
        if (xAxisInfo === undefined) return;
        const { inkSecondary } = readChartPalette();
        for (const sibling of members) {
          if (sibling === chart) continue;
          const pixelX = sibling.convertToPixel(
            { xAxisIndex: xAxisInfo.axisIndex },
            xAxisInfo.value
          );
          if (typeof pixelX === "number") {
            drawCrosshair(sibling, pixelX, inkSecondary);
          } else {
            clearCrosshair(sibling);
          }
        }
      },
    });
  };

  const onGlobalOut = () => {
    for (const sibling of members) {
      if (sibling === chart) continue;
      clearCrosshair(sibling);
    }
  };

  const onDataZoom = (event: unknown) => {
    Option.match(decodeDataZoomEvent(event), {
      onNone: () => {},
      onSome: ({ batch }) => {
        const [range] = batch;
        if (range === undefined) return;
        for (const sibling of members) {
          if (sibling === chart) continue;
          // Silent, so the sibling does not report the zoom back.
          sibling.dispatchAction(
            { type: "dataZoom", start: range.start, end: range.end },
            { silent: true }
          );
        }
      },
    });
  };

  chart.on("updateAxisPointer", onUpdateAxisPointer);
  chart.on("datazoom", onDataZoom);
  chart.getZr().on("globalout", onGlobalOut);

  return () => {
    chart.off("updateAxisPointer", onUpdateAxisPointer);
    chart.off("datazoom", onDataZoom);
    chart.getZr().off("globalout", onGlobalOut);
    clearCrosshair(chart);
    members.delete(chart);
  };
};

/**
 * Resizes a chart to its container and re-derives its tick count from the new
 * width. A chart that has not been painted has no grid yet, and merging an
 * axis into it makes echarts lay out an axis with no coordinate system, which
 * throws.
 */
export const resizeChart = (chart: EChartsType): void => {
  chart.resize();
  const series = chart.getOption()?.series;
  if (Array.isArray(series) && series.length > 0) {
    chart.setOption({
      xAxis: { splitNumber: computeSplitNumberForWidth(chart.getWidth()) },
    });
  }
};

// Shared across every chart Mount: initializes an ECharts instance on the
// host element, wires it to resize with its container and the window, and
// registers it in chartHost so a Sync Command can find it later. Every Mount
// below wraps this with its own chart-specific Succeeded/Failed messages,
// since a Message union member has to be concretely named.
const mountEchartsInstance = (
  hostId: string,
  element: unknown,
  group?: string,
  bind: (chart: EChartsType) => () => void = () => () => {}
): Effect.Effect<void, Error, Scope.Scope> =>
  Effect.gen(function* () {
    if (!(element instanceof HTMLElement)) {
      return yield* Effect.fail(new Error("Chart host is not an HTMLElement."));
    }

    yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          const chart = echarts.init(element, undefined, {
            renderer: "canvas",
          });
          const resizeObserver = new ResizeObserver(() => resizeChart(chart));
          resizeObserver.observe(element);
          const onWindowResize = () => chart.resize();
          window.addEventListener("resize", onWindowResize);
          const stopWheel = (event: WheelEvent) => {
            if (!event.ctrlKey) event.stopPropagation();
          };
          element.addEventListener("wheel", stopWheel, {
            capture: true,
            passive: true,
          });
          setChart(hostId, chart);
          const leaveGroup =
            group !== undefined ? joinChartGroup(chart, group) : undefined;
          const unbind = bind(chart);
          return {
            resizeObserver,
            onWindowResize,
            stopWheel,
            leaveGroup,
            unbind,
          };
        },
        catch: (error) =>
          error instanceof Error
            ? error
            : new Error(`Failed to mount chart: ${error}`),
      }),
      ({ resizeObserver, onWindowResize, stopWheel, leaveGroup, unbind }) =>
        Effect.sync(() => {
          element.removeEventListener("wheel", stopWheel, { capture: true });
          unbind();
          resizeObserver.disconnect();
          window.removeEventListener("resize", onWindowResize);
          leaveGroup?.();
          removeChart(hostId);
        })
    );
  });

// Shared across every chart Sync: looks up the live chart, runs the given
// (synchronous, third-party) paint step with the palette resolved from
// `<html>`'s current theme, and maps the outcome to whichever chart-specific
// result message the caller supplies.
const syncChart = <F, Sc>(
  hostId: string,
  onFailure: (reason: string) => F,
  onSuccess: () => Sc,
  paint: (chart: EChartsType, palette: ChartPalette) => void
): Effect.Effect<F | Sc> =>
  Option.match(getChart(hostId), {
    onNone: () =>
      Effect.succeed(
        onFailure(`Could not find a live chart for hostId ${hostId}.`)
      ),
    onSome: (chart) =>
      Effect.try({
        try: () => {
          paint(chart, readChartPalette());
          return onSuccess();
        },
        catch: (error) =>
          onFailure(error instanceof Error ? error.message : String(error)),
      }).pipe(Effect.match({ onFailure: (f) => f, onSuccess: (s) => s })),
  });

// Read back from echarts, which holds the zoom the viewer has reached.
const ZoomOptionSchema = S.Struct({
  dataZoom: S.Array(S.Struct({ start: S.Number, end: S.Number })),
});
const decodeZoomOption = S.decodeUnknownOption(ZoomOptionSchema);

const currentZoom = (chart: EChartsType): ZoomRange =>
  Option.match(decodeZoomOption(chart.getOption()), {
    onNone: () => FULL_ZOOM,
    onSome: ({ dataZoom }) => dataZoom[0] ?? FULL_ZOOM,
  });

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

// Read at each paint, so a change to the OS setting applies from the next one.
const withMotionPreference = (option: EChartsOption): EChartsOption => ({
  ...option,
  animation: !globalThis.matchMedia?.(REDUCED_MOTION_QUERY).matches,
});

const paintedWindows = new WeakMap<EChartsType, PaintedWindow>();

// Replacing the whole option resets echarts' zoom, so the zoom the viewer has
// reached is read back before the paint and handed to the new option.
const paintTimeline = (
  chart: EChartsType,
  window: PaintedWindow,
  makeOption: (zoom: ZoomRange) => EChartsOption
): void => {
  const previous = paintedWindows.get(chart);
  const zoom =
    previous === undefined
      ? FULL_ZOOM
      : carryZoom(currentZoom(chart), previous, window);
  chart.setOption(withMotionPreference(makeOption(zoom)), true);
  paintedWindows.set(chart, window);
};

// What echarts reports when a brush stroke ends: the span, on the x axis's own
// scale, that the viewer dragged across.
const BrushEndEventSchema = S.Struct({
  areas: S.Array(S.Struct({ coordRange: S.Tuple([S.Number, S.Number]) })),
});
const decodeBrushEnd = S.decodeUnknownOption(BrushEndEventSchema);

/**
 * Hands each committed brush stroke on the latency chart to the page as a
 * `brush` chart event, then clears the stroke: the page redraws for the range
 * it selects, so a selection left behind would only mark the old one.
 */
const bindRangeBrush = (chart: EChartsType): (() => void) => {
  const onBrushEnd = (event: unknown) => {
    Option.match(decodeBrushEnd(event), {
      onNone: () => {},
      onSome: ({ areas }) => {
        const [area] = areas;
        if (area === undefined) return;
        const [startMs, endMs] = area.coordRange;
        chartEvents.dispatchEvent(
          new CustomEvent("brush", { detail: { startMs, endMs } })
        );
        chart.dispatchAction({ type: "brush", areas: [] });
      },
    });
  };
  chart.on("brushEnd", onBrushEnd);
  return () => chart.off("brushEnd", onBrushEnd);
};

const POINTER_FINE_QUERY = "(pointer: fine)";

/**
 * Makes a plain drag across the chart a brush stroke. A touch screen drags to
 * scroll the page, so only a precise pointer gets it. Re-applied after every
 * paint, as a full option replace resets the chart's cursor.
 */
const activateRangeBrush = (chart: EChartsType): void => {
  if (!globalThis.matchMedia?.(POINTER_FINE_QUERY).matches) return;
  chart.dispatchAction({
    type: "takeGlobalCursor",
    key: "brush",
    brushOption: { brushType: "lineX", brushMode: "single" },
  });
};

// The window comes from the fetch that produced the data, never from a clock
// read here (see `TimelineWindow` in `model.ts`), which keeps a repaint of
// unchanged data pixel-identical.
const TimelineChartArgs = {
  hostId: S.String,
  metrics: S.Array(MetricSchema),
  startTimeMs: S.Number,
  endTimeMs: S.Number,
  granularity: GranularitySchema,
  incidents: S.Array(Incident),
};

export const LATENCY_CHART_HOST_ID = "latency-chart";

export const MountLatencyChart = Mount.define("MountLatencyChart", {
  args: { hostId: S.String },
  messages: [SucceededMountLatencyChart, FailedMountLatencyChart],
  execute: ({ hostId, element }) =>
    mountEchartsInstance(
      hostId,
      element,
      QUALITY_CHARTS_GROUP,
      bindRangeBrush
    ).pipe(
      Effect.map(() => SucceededMountLatencyChart({ hostId })),
      Effect.catch((error) =>
        Effect.succeed(FailedMountLatencyChart({ reason: error.message }))
      )
    ),
});

export const SyncLatencyChart = Command.define("SyncLatencyChart", {
  args: {
    ...TimelineChartArgs,
    /** One entry per host in the per-host view, or none for the all-hosts line. */
    hostSeries: S.Array(
      S.Struct({ host: S.String, metrics: S.Array(MetricSchema) })
    ),
  },
  messages: [CompletedSyncLatencyChart, FailedSyncLatencyChart],
  execute: ({
    hostId,
    metrics,
    hostSeries,
    startTimeMs,
    endTimeMs,
    granularity,
    incidents,
  }) =>
    syncChart(
      hostId,
      (reason) => FailedSyncLatencyChart({ reason }),
      CompletedSyncLatencyChart,
      (chart, palette) => {
        const slots = fillTimeline(
          metrics,
          startTimeMs,
          endTimeMs,
          granularity
        );
        paintTimeline(
          chart,
          { startMs: startTimeMs, endMs: endTimeMs },
          (zoom) =>
            makeLatencyChartOption({
              slots,
              hostSeries: hostSeries.map(({ host, metrics: hostMetrics }) => ({
                host,
                slots: fillTimeline(
                  hostMetrics,
                  startTimeMs,
                  endTimeMs,
                  granularity
                ),
              })),
              stats: calculateLatencyStats(metrics),
              palette,
              incidents,
              startMs: startTimeMs,
              endMs: endTimeMs,
              splitNumber: computeSplitNumberForWidth(chart.getWidth()),
              widthPx: chart.getWidth(),
              zoom,
            })
        );
        activateRangeBrush(chart);
      }
    ),
});

export const PACKET_LOSS_CHART_HOST_ID = "packet-loss-chart";

export const MountPacketLossChart = Mount.define("MountPacketLossChart", {
  args: { hostId: S.String },
  messages: [SucceededMountPacketLossChart, FailedMountPacketLossChart],
  execute: ({ hostId, element }) =>
    mountEchartsInstance(hostId, element, QUALITY_CHARTS_GROUP).pipe(
      Effect.map(() => SucceededMountPacketLossChart({ hostId })),
      Effect.catch((error) =>
        Effect.succeed(FailedMountPacketLossChart({ reason: error.message }))
      )
    ),
});

export const SyncPacketLossChart = Command.define("SyncPacketLossChart", {
  args: TimelineChartArgs,
  messages: [CompletedSyncPacketLossChart, FailedSyncPacketLossChart],
  execute: ({
    hostId,
    metrics,
    startTimeMs,
    endTimeMs,
    granularity,
    incidents,
  }) =>
    syncChart(
      hostId,
      (reason) => FailedSyncPacketLossChart({ reason }),
      CompletedSyncPacketLossChart,
      (chart, palette) => {
        const slots = fillTimeline(
          metrics,
          startTimeMs,
          endTimeMs,
          granularity
        );
        paintTimeline(
          chart,
          { startMs: startTimeMs, endMs: endTimeMs },
          (zoom) =>
            makePacketLossChartOption({
              slots,
              palette,
              incidents,
              startMs: startTimeMs,
              endMs: endTimeMs,
              splitNumber: computeSplitNumberForWidth(chart.getWidth()),
              widthPx: chart.getWidth(),
              zoom,
            })
        );
      }
    ),
});

export const JITTER_CHART_HOST_ID = "jitter-chart";

export const MountJitterChart = Mount.define("MountJitterChart", {
  args: { hostId: S.String },
  messages: [SucceededMountJitterChart, FailedMountJitterChart],
  execute: ({ hostId, element }) =>
    mountEchartsInstance(hostId, element, QUALITY_CHARTS_GROUP).pipe(
      Effect.map(() => SucceededMountJitterChart({ hostId })),
      Effect.catch((error) =>
        Effect.succeed(FailedMountJitterChart({ reason: error.message }))
      )
    ),
});

export const SyncJitterChart = Command.define("SyncJitterChart", {
  args: TimelineChartArgs,
  messages: [CompletedSyncJitterChart, FailedSyncJitterChart],
  execute: ({
    hostId,
    metrics,
    startTimeMs,
    endTimeMs,
    granularity,
    incidents,
  }) =>
    syncChart(
      hostId,
      (reason) => FailedSyncJitterChart({ reason }),
      CompletedSyncJitterChart,
      (chart, palette) => {
        const slots = fillTimeline(
          metrics,
          startTimeMs,
          endTimeMs,
          granularity
        );
        paintTimeline(
          chart,
          { startMs: startTimeMs, endMs: endTimeMs },
          (zoom) =>
            makeJitterChartOption({
              slots,
              palette,
              incidents,
              startMs: startTimeMs,
              endMs: endTimeMs,
              splitNumber: computeSplitNumberForWidth(chart.getWidth()),
              widthPx: chart.getWidth(),
              zoom,
            })
        );
      }
    ),
});

export const SPEED_CHART_HOST_ID = "speed-chart";

export const MountSpeedChart = Mount.define("MountSpeedChart", {
  args: { hostId: S.String },
  messages: [SucceededMountSpeedChart, FailedMountSpeedChart],
  execute: ({ hostId, element }) =>
    mountEchartsInstance(hostId, element).pipe(
      Effect.map(() => SucceededMountSpeedChart({ hostId })),
      Effect.catch((error) =>
        Effect.succeed(FailedMountSpeedChart({ reason: error.message }))
      )
    ),
});

export const SyncSpeedChart = Command.define("SyncSpeedChart", {
  args: {
    hostId: S.String,
    metrics: S.Array(SpeedMetricSchema),
    startTimeMs: S.Number,
    endTimeMs: S.Number,
  },
  messages: [CompletedSyncSpeedChart, FailedSyncSpeedChart],
  execute: ({ hostId, metrics, startTimeMs, endTimeMs }) =>
    syncChart(
      hostId,
      (reason) => FailedSyncSpeedChart({ reason }),
      CompletedSyncSpeedChart,
      (chart, palette) => {
        chart.setOption(
          withMotionPreference(
            makeSpeedChartOption({
              metrics,
              palette,
              startMs: startTimeMs,
              endMs: endTimeMs,
              splitNumber: computeSplitNumberForWidth(chart.getWidth()),
            })
          ),
          true
        );
      }
    ),
});
