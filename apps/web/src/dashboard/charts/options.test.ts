import { describe, expect, test } from "vitest";
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

const startMs = Date.parse("2026-07-26T10:00:00.000Z");
const endMs = Date.parse("2026-07-26T10:15:00.000Z");

describe("makeLatencyChartOption", () => {
  const metrics = [{ timestamp: "2026-07-26T10:05:30.000Z", latency: 20 }];
  const slots = fillTimeline(metrics, startMs, endMs, "5m");
  const stats = calculateLatencyStats(metrics);

  test("plots one [timestamp, value] pair per slot, nulling gaps", () => {
    const option = makeLatencyChartOption({ slots, stats, theme: "light" });
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
    const option = makeLatencyChartOption({ slots, stats, theme: "light" });
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
    });
    const series = option.series as Array<{ markLine?: unknown }>;

    expect(series[0].markLine).toBeUndefined();
  });
});

describe("makePacketLossChartOption", () => {
  test("plots a plain danger-colored line with no severity-band shading", () => {
    const metrics = [{ timestamp: "2026-07-26T10:05:00.000Z", packet_loss: 2 }];
    const option = makePacketLossChartOption({
      slots: fillTimeline(metrics, startMs, endMs, "5m"),
      stats: calculatePacketLossStats(metrics),
      theme: "light",
    });
    const series = option.series as Array<{
      lineStyle: { color: string };
      markArea?: unknown;
    }>;

    expect(series[0].lineStyle.color).toBe("#e53e3e");
    expect(series[0].markArea).toBeUndefined();
  });
});

describe("makeJitterChartOption", () => {
  test("draws the acceptable-jitter threshold line at 10ms", () => {
    const metrics = [{ timestamp: "2026-07-26T10:05:00.000Z", jitter: 3 }];
    const option = makeJitterChartOption({
      slots: fillTimeline(metrics, startMs, endMs, "5m"),
      stats: calculateJitterStats(metrics),
      theme: "light",
    });
    const series = option.series as Array<{
      markLine: { data: Array<{ yAxis: number }> };
      areaStyle: unknown;
    }>;

    expect(series[0].markLine.data[0].yAxis).toBe(10);
    expect(series[0].areaStyle).toBeDefined();
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
    });
    const grid = option.grid as { bottom: number };
    const legend = option.legend as { bottom: number };

    expect(legend.bottom).toBeDefined();
    expect(grid.bottom).toBeGreaterThan(legend.bottom);
  });
});
