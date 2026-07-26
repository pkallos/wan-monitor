import type { EChartsType } from "echarts/core";
import { Option } from "effect";

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
