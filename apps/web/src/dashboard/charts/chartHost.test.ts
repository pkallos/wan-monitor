import type { EChartsType } from "echarts/core";
import { Option } from "effect";
import { describe, expect, test, vi } from "vitest";
import { getChart, removeChart, setChart } from "@/dashboard/charts/chartHost";

const fakeChart = () => {
  const dispose = vi.fn();
  return { chart: { dispose } as unknown as EChartsType, dispose };
};

describe("chartHost", () => {
  test("a registered chart is retrievable by its host id", () => {
    const { chart } = fakeChart();
    setChart("registered-host", chart);

    expect(getChart("registered-host")).toEqual(Option.some(chart));
  });

  test("removing a chart disposes it and drops it from the registry", () => {
    const { chart, dispose } = fakeChart();
    setChart("disposed-host", chart);

    removeChart("disposed-host");

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(getChart("disposed-host")).toEqual(Option.none());
  });

  test("removing an unknown host id is a no-op", () => {
    expect(() => removeChart("never-registered-host")).not.toThrow();
    expect(getChart("never-registered-host")).toEqual(Option.none());
  });
});
