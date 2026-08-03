import { describe, expect, test } from "vitest";
import {
  formatAxisLabel,
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

describe("formatAxisLabel", () => {
  const value = Date.parse("2026-07-26T14:05:00.000Z");

  // Asserting a shape rather than a literal keeps these independent of the
  // worker's timezone, which shifts both the clock time and the calendar day.
  const TIME_OF_DAY = /^\d{2}:\d{2}/;
  const MONTH_AND_DAY = /^[A-Za-z]{3} \d{1,2}$/;

  test.each(["1m", "5m", "15m", "1h"] as const)(
    "formats %s ticks as hour:minute",
    (granularity) => {
      expect(formatAxisLabel(value, granularity)).toMatch(TIME_OF_DAY);
      expect(formatAxisLabel(value, granularity)).toBe(
        new Date(value).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      );
    }
  );

  test.each(["6h", "1d"] as const)(
    "formats %s ticks as a date",
    (granularity) => {
      expect(formatAxisLabel(value, granularity)).toMatch(MONTH_AND_DAY);
      expect(formatAxisLabel(value, granularity)).toBe(
        new Date(value).toLocaleDateString([], {
          month: "short",
          day: "numeric",
        })
      );
    }
  );

  test("switches from time-of-day to date between 1h and 6h", () => {
    expect(formatAxisLabel(value, "1h")).toMatch(TIME_OF_DAY);
    expect(formatAxisLabel(value, "6h")).toMatch(MONTH_AND_DAY);
    expect(formatAxisLabel(value, "1h")).not.toBe(formatAxisLabel(value, "6h"));
  });

  test("formats undefined (raw, ungranularized data) as hour:minute, same as the finest tier", () => {
    expect(formatAxisLabel(value, undefined)).toMatch(TIME_OF_DAY);
    expect(formatAxisLabel(value, undefined)).toBe(
      formatAxisLabel(value, "1m")
    );
  });
});

describe("makeLatencyChartOption", () => {
  const metrics = [{ timestamp: "2026-07-26T10:05:30.000Z", latency: 20 }];
  const slots = fillTimeline(metrics, startMs, endMs, "5m");
  const stats = calculateLatencyStats(metrics);

  test("plots one [timestamp, value] pair per slot, nulling gaps", () => {
    const option = makeLatencyChartOption({
      slots,
      stats,
      theme: "light",
      startMs,
      endMs,
      granularity: "5m",
    });
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
    const option = makeLatencyChartOption({
      slots,
      stats,
      theme: "light",
      startMs,
      endMs,
      granularity: "5m",
    });
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
      startMs,
      endMs,
      granularity: "5m",
    });
    const series = option.series as Array<{ markLine?: unknown }>;

    expect(series[0].markLine).toBeUndefined();
  });

  test("sets an explicit xAxis domain from the resolved window bounds", () => {
    const option = makeLatencyChartOption({
      slots,
      stats,
      theme: "light",
      startMs,
      endMs,
      granularity: "5m",
    });
    const xAxis = option.xAxis as { min: number; max: number };

    expect(xAxis.min).toBe(startMs);
    expect(xAxis.max).toBe(endMs);
  });

  test("labels the x-axis through the granularity-aware formatter", () => {
    const option = makeLatencyChartOption({
      slots,
      stats,
      theme: "light",
      startMs,
      endMs,
      granularity: "1d",
    });
    const xAxis = option.xAxis as {
      axisLabel: { formatter: (value: number) => string };
    };

    expect(xAxis.axisLabel.formatter(startMs)).toBe(
      formatAxisLabel(startMs, "1d")
    );
  });
});

describe("makePacketLossChartOption", () => {
  const metrics = [{ timestamp: "2026-07-26T10:05:00.000Z", packet_loss: 2 }];

  test("plots a plain danger-colored line with no severity-band shading", () => {
    const option = makePacketLossChartOption({
      slots: fillTimeline(metrics, startMs, endMs, "5m"),
      stats: calculatePacketLossStats(metrics),
      theme: "light",
      startMs,
      endMs,
      granularity: "5m",
    });
    const series = option.series as Array<{
      lineStyle: { color: string };
      markArea?: unknown;
    }>;

    expect(series[0].lineStyle.color).toBe("#e53e3e");
    expect(series[0].markArea).toBeUndefined();
  });

  test("sets an explicit xAxis domain from the resolved window bounds", () => {
    const option = makePacketLossChartOption({
      slots: fillTimeline(metrics, startMs, endMs, "5m"),
      stats: calculatePacketLossStats(metrics),
      theme: "light",
      startMs,
      endMs,
      granularity: "5m",
    });
    const xAxis = option.xAxis as { min: number; max: number };

    expect(xAxis.min).toBe(startMs);
    expect(xAxis.max).toBe(endMs);
  });
});

describe("makeJitterChartOption", () => {
  const metrics = [{ timestamp: "2026-07-26T10:05:00.000Z", jitter: 3 }];

  test("draws the acceptable-jitter threshold line at 10ms", () => {
    const option = makeJitterChartOption({
      slots: fillTimeline(metrics, startMs, endMs, "5m"),
      stats: calculateJitterStats(metrics),
      theme: "light",
      startMs,
      endMs,
      granularity: "5m",
    });
    const series = option.series as Array<{
      markLine: { data: Array<{ yAxis: number }> };
      areaStyle: unknown;
    }>;

    expect(series[0].markLine.data[0].yAxis).toBe(10);
    expect(series[0].areaStyle).toBeDefined();
  });

  test("sets an explicit xAxis domain from the resolved window bounds", () => {
    const option = makeJitterChartOption({
      slots: fillTimeline(metrics, startMs, endMs, "5m"),
      stats: calculateJitterStats(metrics),
      theme: "light",
      startMs,
      endMs,
      granularity: "5m",
    });
    const xAxis = option.xAxis as { min: number; max: number };

    expect(xAxis.min).toBe(startMs);
    expect(xAxis.max).toBe(endMs);
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
      startMs,
      endMs,
      granularity: "1m",
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
      startMs,
      endMs,
      granularity: "1m",
    });
    const grid = option.grid as { bottom: number };
    const legend = option.legend as { bottom: number };

    expect(legend.bottom).toBeDefined();
    expect(grid.bottom).toBeGreaterThan(legend.bottom);
  });

  test("sets an explicit xAxis domain from the resolved window bounds", () => {
    const option = makeSpeedChartOption({
      metrics: [],
      stats: calculateSpeedStats([]),
      theme: "light",
      startMs,
      endMs,
      granularity: "1m",
    });
    const xAxis = option.xAxis as { min: number; max: number };

    expect(xAxis.min).toBe(startMs);
    expect(xAxis.max).toBe(endMs);
  });

  test("labels the x-axis as time-of-day when granularity is undefined (raw samples)", () => {
    const option = makeSpeedChartOption({
      metrics: [],
      stats: calculateSpeedStats([]),
      theme: "light",
      startMs,
      endMs,
      granularity: undefined,
    });
    const xAxis = option.xAxis as {
      axisLabel: { formatter: (value: number) => string };
    };

    expect(xAxis.axisLabel.formatter(startMs)).toBe(
      formatAxisLabel(startMs, undefined)
    );
    expect(xAxis.axisLabel.formatter(startMs)).toMatch(/^\d{2}:\d{2}/);
  });
});
