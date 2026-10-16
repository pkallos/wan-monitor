import type { EChartsType } from "echarts/core";
import { Option } from "effect";
import type { Dom } from "foldkit";

// A module-level mutable map outside the Model, touched only from Mount
// (setChart/removeChart) and from Commands (getChart) — the sanctioned
// exception to "no module-level mutable state" for a library-owned handle
// that can't live in the (serializable, time-travel-replayed) Model.
const chartsByHostId = new Map<string, EChartsType>();

export const setChart = (hostId: string, chart: EChartsType): void => {
  chartsByHostId.set(hostId, chart);
};

export const getChart = (hostId: string): Option.Option<EChartsType> =>
  Option.fromNullishOr(chartsByHostId.get(hostId));

export const removeChart = (hostId: string): void => {
  const maybeChart = getChart(hostId);

  if (Option.isSome(maybeChart)) {
    maybeChart.value.dispose();
    chartsByHostId.delete(hostId);
  }
};

/** A span of the latency chart's time axis the viewer dragged across, in milliseconds. */
export type ChartBrush = Readonly<{ startMs: number; endMs: number }>;

/**
 * Where a chart reports what the viewer did to it. An ECharts instance lives
 * outside the Model and its events fire outside the update loop, so they
 * cross over as DOM events that a Subscription turns into Messages.
 */
export const chartEvents: Dom.TypedEventTarget<{
  brush: CustomEvent<ChartBrush>;
}> = new EventTarget();
