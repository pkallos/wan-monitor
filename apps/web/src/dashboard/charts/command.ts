import { MetricSchema } from "@shared/api/routes/metrics";
import { SpeedMetricSchema } from "@shared/api/routes/speedtest";
import type { EChartsType } from "echarts/core";
import * as echarts from "echarts/core";
import type { Scope } from "effect";
import { Clock, Effect, Option, Schema as S } from "effect";
import { Command, Mount } from "foldkit";
import { getChart, setChart } from "@/dashboard/charts/chartHost";
import {
  makeJitterChartOption,
  makeLatencyChartOption,
  makePacketLossChartOption,
  makeSpeedChartOption,
} from "@/dashboard/charts/options";
import {
  calculateJitterStats,
  calculateLatencyStats,
  calculatePacketLossStats,
  calculateSpeedStats,
} from "@/dashboard/charts/stats";
import { fillTimeline } from "@/dashboard/charts/timeline";
import {
  DateRangeSelection,
  getDateRangeWindow,
  granularityForRange,
  granularityForSpeedtestRange,
} from "@/dashboard/dateRange";
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
import { Theme } from "@/dashboard/theme";

// The latency/packet-loss/jitter charts share one hover cursor: hovering any
// one of them shows a synced vertical line on the others. echarts.connect()
// only syncs dataZoom between grouped instances, not the axis pointer, and
// dispatching 'updateAxisPointer'/'showTip' actions at ungrouped-by-hover
// siblings doesn't repaint their pointer either — so the synced crosshair on
// every other member of the group is drawn by hand, straight onto each
// sibling's zrender layer.
const QUALITY_CHARTS_GROUP = "quality-charts";

const groupMembers = new Map<string, Set<EChartsType>>();
const crosshairs = new Map<
  EChartsType,
  InstanceType<typeof echarts.graphic.Line>
>();

const CROSSHAIR_STYLE = { stroke: "#4a5568", lineDash: [4, 4], lineWidth: 1 };

const setCrosshair = (chart: EChartsType, pixelX: number | undefined): void => {
  const zr = chart.getZr();
  const existing = crosshairs.get(chart);
  if (existing !== undefined) {
    zr.remove(existing);
    crosshairs.delete(chart);
  }
  if (pixelX === undefined) return;
  const line = new echarts.graphic.Line({
    shape: { x1: pixelX, y1: 0, x2: pixelX, y2: chart.getHeight() },
    style: CROSSHAIR_STYLE,
    silent: true,
    z: 1000,
  });
  zr.add(line);
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

// Joins `chart` to `group`'s hover-sync set and returns the cleanup to run
// on unmount.
const linkAxisPointer = (chart: EChartsType, group: string): (() => void) => {
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
        for (const sibling of members) {
          if (sibling === chart) continue;
          const pixelX = sibling.convertToPixel(
            { xAxisIndex: xAxisInfo.axisIndex },
            xAxisInfo.value
          );
          setCrosshair(
            sibling,
            typeof pixelX === "number" ? pixelX : undefined
          );
        }
      },
    });
  };

  const onGlobalOut = () => {
    for (const sibling of members) {
      if (sibling === chart) continue;
      setCrosshair(sibling, undefined);
    }
  };

  chart.on("updateAxisPointer", onUpdateAxisPointer);
  chart.getZr().on("globalout", onGlobalOut);

  return () => {
    chart.off("updateAxisPointer", onUpdateAxisPointer);
    chart.getZr().off("globalout", onGlobalOut);
    setCrosshair(chart, undefined);
    members.delete(chart);
  };
};

// Shared across every chart Mount: initializes an ECharts instance on the
// host element, wires it to resize with its container and the window, and
// registers it in chartHost so a Sync Command can find it later. Every Mount
// below wraps this with its own chart-specific Succeeded/Failed messages,
// since a Message union member has to be concretely named.
const mountEchartsInstance = (
  hostId: string,
  element: unknown,
  group?: string
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
          const resizeObserver = new ResizeObserver(() => chart.resize());
          resizeObserver.observe(element);
          const onWindowResize = () => chart.resize();
          window.addEventListener("resize", onWindowResize);
          setChart(hostId, chart);
          const unlinkAxisPointer =
            group !== undefined ? linkAxisPointer(chart, group) : undefined;
          return { resizeObserver, onWindowResize, unlinkAxisPointer };
        },
        catch: (error) =>
          error instanceof Error
            ? error
            : new Error(`Failed to mount chart: ${error}`),
      }),
      ({ resizeObserver, onWindowResize, unlinkAxisPointer }) =>
        Effect.sync(() => {
          resizeObserver.disconnect();
          window.removeEventListener("resize", onWindowResize);
          unlinkAxisPointer?.();
        })
    );
  });

// Shared across every chart Sync: looks up the live chart, runs the given
// (synchronous, third-party) paint step, and maps the outcome to whichever
// chart-specific result message the caller supplies.
const syncChart = <F, Sc>(
  hostId: string,
  onFailure: (reason: string) => F,
  onSuccess: () => Sc,
  paint: (chart: EChartsType) => void
): Effect.Effect<F | Sc> =>
  Option.match(getChart(hostId), {
    onNone: () =>
      Effect.succeed(
        onFailure(`Could not find a live chart for hostId ${hostId}.`)
      ),
    onSome: (chart) =>
      Effect.try({
        try: () => {
          paint(chart);
          return onSuccess();
        },
        catch: (error) =>
          onFailure(error instanceof Error ? error.message : String(error)),
      }).pipe(Effect.match({ onFailure: (f) => f, onSuccess: (s) => s })),
  });

// Resolves a chart's x-axis bounds and tick granularity, reading "now"
// through Clock rather than the system clock directly since only a Command
// may touch time.
const resolveTimelineWindow = (
  dateRange: DateRangeSelection,
  maybeEarliestDataMs?: Option.Option<number>
) =>
  Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    const window = getDateRangeWindow(dateRange, nowMs, maybeEarliestDataMs);
    return {
      startMs: Date.parse(window.startTime),
      endMs: Date.parse(window.endTime),
      granularity: granularityForRange(window),
    };
  });

// Like `resolveTimelineWindow`, but for the speed chart: `fetchSpeedtestHistory`
// requests raw rows (no granularity) below the speedtest aggregation
// threshold, so this resolves the same undefined-or-aggregated granularity
// that fetch actually used, for the axis label formatter to match.
export const resolveSpeedtestTimelineWindow = (
  dateRange: DateRangeSelection,
  maybeEarliestDataMs?: Option.Option<number>
) =>
  Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    const window = getDateRangeWindow(dateRange, nowMs, maybeEarliestDataMs);
    return {
      startMs: Date.parse(window.startTime),
      endMs: Date.parse(window.endTime),
      granularity: granularityForSpeedtestRange(window),
    };
  });

const DateRangeArgs = {
  hostId: S.String,
  metrics: S.Array(MetricSchema),
  dateRange: DateRangeSelection,
  maybeEarliestDataMs: S.optional(S.Option(S.Number)),
  theme: Theme,
};

export const LATENCY_CHART_HOST_ID = "latency-chart";

export const MountLatencyChart = Mount.define(
  "MountLatencyChart",
  { hostId: S.String },
  SucceededMountLatencyChart,
  FailedMountLatencyChart
)(
  ({ hostId }) =>
    (element) =>
      mountEchartsInstance(hostId, element, QUALITY_CHARTS_GROUP).pipe(
        Effect.map(() => SucceededMountLatencyChart({ hostId })),
        Effect.catch((error) =>
          Effect.succeed(FailedMountLatencyChart({ reason: error.message }))
        )
      )
);

export const SyncLatencyChart = Command.define(
  "SyncLatencyChart",
  DateRangeArgs,
  CompletedSyncLatencyChart,
  FailedSyncLatencyChart
)((args) =>
  Effect.gen(function* () {
    const { startMs, endMs, granularity } = yield* resolveTimelineWindow(
      args.dateRange,
      args.maybeEarliestDataMs
    );
    return yield* syncChart(
      args.hostId,
      (reason) => FailedSyncLatencyChart({ reason }),
      CompletedSyncLatencyChart,
      (chart) => {
        const slots = fillTimeline(args.metrics, startMs, endMs, granularity);
        const stats = calculateLatencyStats(args.metrics);
        chart.setOption(
          makeLatencyChartOption({
            slots,
            stats,
            theme: args.theme,
            startMs,
            endMs,
            granularity,
          }),
          true
        );
      }
    );
  })
);

export const PACKET_LOSS_CHART_HOST_ID = "packet-loss-chart";

export const MountPacketLossChart = Mount.define(
  "MountPacketLossChart",
  { hostId: S.String },
  SucceededMountPacketLossChart,
  FailedMountPacketLossChart
)(
  ({ hostId }) =>
    (element) =>
      mountEchartsInstance(hostId, element, QUALITY_CHARTS_GROUP).pipe(
        Effect.map(() => SucceededMountPacketLossChart({ hostId })),
        Effect.catch((error) =>
          Effect.succeed(FailedMountPacketLossChart({ reason: error.message }))
        )
      )
);

export const SyncPacketLossChart = Command.define(
  "SyncPacketLossChart",
  DateRangeArgs,
  CompletedSyncPacketLossChart,
  FailedSyncPacketLossChart
)((args) =>
  Effect.gen(function* () {
    const { startMs, endMs, granularity } = yield* resolveTimelineWindow(
      args.dateRange,
      args.maybeEarliestDataMs
    );
    return yield* syncChart(
      args.hostId,
      (reason) => FailedSyncPacketLossChart({ reason }),
      CompletedSyncPacketLossChart,
      (chart) => {
        const slots = fillTimeline(args.metrics, startMs, endMs, granularity);
        const stats = calculatePacketLossStats(args.metrics);
        chart.setOption(
          makePacketLossChartOption({
            slots,
            stats,
            theme: args.theme,
            startMs,
            endMs,
            granularity,
          }),
          true
        );
      }
    );
  })
);

export const JITTER_CHART_HOST_ID = "jitter-chart";

export const MountJitterChart = Mount.define(
  "MountJitterChart",
  { hostId: S.String },
  SucceededMountJitterChart,
  FailedMountJitterChart
)(
  ({ hostId }) =>
    (element) =>
      mountEchartsInstance(hostId, element, QUALITY_CHARTS_GROUP).pipe(
        Effect.map(() => SucceededMountJitterChart({ hostId })),
        Effect.catch((error) =>
          Effect.succeed(FailedMountJitterChart({ reason: error.message }))
        )
      )
);

export const SyncJitterChart = Command.define(
  "SyncJitterChart",
  DateRangeArgs,
  CompletedSyncJitterChart,
  FailedSyncJitterChart
)((args) =>
  Effect.gen(function* () {
    const { startMs, endMs, granularity } = yield* resolveTimelineWindow(
      args.dateRange,
      args.maybeEarliestDataMs
    );
    return yield* syncChart(
      args.hostId,
      (reason) => FailedSyncJitterChart({ reason }),
      CompletedSyncJitterChart,
      (chart) => {
        const slots = fillTimeline(args.metrics, startMs, endMs, granularity);
        const stats = calculateJitterStats(args.metrics);
        chart.setOption(
          makeJitterChartOption({
            slots,
            stats,
            theme: args.theme,
            startMs,
            endMs,
            granularity,
          }),
          true
        );
      }
    );
  })
);

export const SPEED_CHART_HOST_ID = "speed-chart";

export const MountSpeedChart = Mount.define(
  "MountSpeedChart",
  { hostId: S.String },
  SucceededMountSpeedChart,
  FailedMountSpeedChart
)(
  ({ hostId }) =>
    (element) =>
      mountEchartsInstance(hostId, element).pipe(
        Effect.map(() => SucceededMountSpeedChart({ hostId })),
        Effect.catch((error) =>
          Effect.succeed(FailedMountSpeedChart({ reason: error.message }))
        )
      )
);

export const SyncSpeedChart = Command.define(
  "SyncSpeedChart",
  {
    hostId: S.String,
    metrics: S.Array(SpeedMetricSchema),
    dateRange: DateRangeSelection,
    maybeEarliestDataMs: S.optional(S.Option(S.Number)),
    theme: Theme,
  },
  CompletedSyncSpeedChart,
  FailedSyncSpeedChart
)((args) =>
  Effect.gen(function* () {
    const { startMs, endMs, granularity } =
      yield* resolveSpeedtestTimelineWindow(
        args.dateRange,
        args.maybeEarliestDataMs
      );
    return yield* syncChart(
      args.hostId,
      (reason) => FailedSyncSpeedChart({ reason }),
      CompletedSyncSpeedChart,
      (chart) => {
        const stats = calculateSpeedStats(args.metrics);
        chart.setOption(
          makeSpeedChartOption({
            metrics: args.metrics,
            stats,
            theme: args.theme,
            startMs,
            endMs,
            granularity,
          }),
          true
        );
      }
    );
  })
);
