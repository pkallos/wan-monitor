import type { EChartsType } from "echarts/core";
import { Effect, Fiber, Option, Stream } from "effect";
import { describe, expect, test, vi } from "vitest";
import { getChart, setChart } from "@/dashboard/charts/chartHost";
import {
  MountJitterChart,
  MountLatencyChart,
  SyncLatencyChart,
  SyncSpeedChart,
} from "@/dashboard/charts/command";
import { registerEcharts } from "@/dashboard/charts/echartsSetup";

registerEcharts();

// A 24h window at 5m buckets, matching what `granularityForRange` picks for
// that span.
const ONE_DAY_WINDOW = {
  startTimeMs: Date.parse("2026-07-26T00:00:00.000Z"),
  endTimeMs: Date.parse("2026-07-27T00:00:00.000Z"),
  granularity: "5m" as const,
};

// A stand-in for a live ECharts instance. The real one can't paint under
// happy-dom (no canvas 2d context), and `syncChart` only ever calls
// `getWidth` (to size the axis label density) and `setOption` on what it
// finds in chartHost.
const stubChart = (setOption: (option: unknown, notMerge: boolean) => void) =>
  ({ setOption, getWidth: () => 800 }) as unknown as EChartsType;

const syncLatency = (hostId: string) =>
  Effect.runPromise(
    SyncLatencyChart({
      hostId,
      metrics: [],
      ...ONE_DAY_WINDOW,
      theme: "dark",
    }).effect
  );

const mountedHost = () => {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return element;
};

describe("syncChart", () => {
  test("a hostId that was never registered fails instead of throwing", async () => {
    const result = await syncLatency("never-mounted-latency-chart");

    expect(result).toEqual({
      _tag: "FailedSyncLatencyChart",
      reason:
        "Could not find a live chart for hostId never-mounted-latency-chart.",
    });
  });

  test("SyncSpeedChart reports the same missing-chart failure with its own tag", async () => {
    const result = await Effect.runPromise(
      SyncSpeedChart({
        hostId: "never-mounted-speed-chart",
        metrics: [],
        startTimeMs: ONE_DAY_WINDOW.startTimeMs,
        endTimeMs: ONE_DAY_WINDOW.endTimeMs,
        theme: "light",
      }).effect
    );

    expect(result).toEqual({
      _tag: "FailedSyncSpeedChart",
      reason:
        "Could not find a live chart for hostId never-mounted-speed-chart.",
    });
  });

  test("painting a registered chart completes with the chart's new option", async () => {
    const setOption = vi.fn();
    setChart("live-latency-chart", stubChart(setOption));

    const result = await syncLatency("live-latency-chart");

    expect(result).toEqual({ _tag: "CompletedSyncLatencyChart" });
    expect(setOption).toHaveBeenCalledTimes(1);
    const [option, notMerge] = setOption.mock.calls[0] ?? [];
    expect(option).toHaveProperty("series");
    expect(notMerge).toBe(true);
  });

  // Re-applying an unchanged date range re-runs the paint step. It has to
  // reproduce the same chart, so the window and granularity it buckets
  // against come from its arguments and never from the clock.
  test("painting the same window twice produces an identical option, even weeks later", async () => {
    // ECharts options carry label-formatter closures, which are fresh
    // function objects on every paint, so the comparison runs over the
    // serialized shape: axis bounds, the bucketed slot grid, and the series.
    const options: string[] = [];
    setChart(
      "idempotent-latency-chart",
      stubChart((option) => options.push(JSON.stringify(option)))
    );
    const metrics = [
      {
        timestamp: "2026-07-26T06:07:00.000Z",
        source: "ping" as const,
        latency: 11.2,
      },
    ];
    const paint = () =>
      Effect.runPromise(
        SyncLatencyChart({
          hostId: "idempotent-latency-chart",
          metrics,
          ...ONE_DAY_WINDOW,
          theme: "dark",
        }).effect
      );

    // Only Date is faked: Effect's runtime still needs real timers to settle.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.parse("2026-07-27T00:00:00.000Z"));
      await paint();
      // Far enough to shift every relative preset's window and to push a
      // growing range past a granularity threshold.
      vi.setSystemTime(Date.parse("2026-09-01T00:00:00.000Z"));
      await paint();
    } finally {
      vi.useRealTimers();
    }

    expect(options).toHaveLength(2);
    expect(options[1]).toBe(options[0]);
  });

  test("a chart that throws while painting fails with the thrown message", async () => {
    setChart(
      "throwing-latency-chart",
      stubChart(() => {
        throw new Error("zrender is gone");
      })
    );

    const result = await syncLatency("throwing-latency-chart");

    expect(result).toEqual({
      _tag: "FailedSyncLatencyChart",
      reason: "zrender is gone",
    });
  });
});

describe("mountEchartsInstance", () => {
  test("an element that is not an HTMLElement fails the mount", async () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");

    const message = await Effect.runPromise(
      Stream.runHead(MountLatencyChart({ hostId: "svg-host" }).f(svg))
    );

    expect(message).toEqual(
      Option.some({
        _tag: "FailedMountLatencyChart",
        reason: "Chart host is not an HTMLElement.",
      })
    );
    expect(getChart("svg-host")).toEqual(Option.none());
  });

  test("mounting on a real element registers the chart under its hostId", async () => {
    const message = await Effect.runPromise(
      Stream.runHead(MountLatencyChart({ hostId: "div-host" }).f(mountedHost()))
    );

    expect(message).toEqual(
      Option.some({
        _tag: "SucceededMountLatencyChart",
        hostId: "div-host",
      })
    );
  });

  test("a mounted chart stays registered until the Mount is torn down, then is disposed", async () => {
    const fiber = Effect.runFork(
      Stream.runDrain(
        MountLatencyChart({ hostId: "still-mounted-host" }).f(mountedHost())
      )
    );
    // A fixed setTimeout(0) can't be trusted to outlast the fiber's acquire
    // step under coverage instrumentation's overhead, so poll instead.
    await vi.waitFor(() =>
      expect(getChart("still-mounted-host")._tag).toBe("Some")
    );

    await Effect.runPromise(Fiber.interrupt(fiber));

    expect(getChart("still-mounted-host")).toEqual(Option.none());
  });
});

// Two mounted quality charts, with the sibling's zrender and coordinate
// conversion stubbed: zrender can't paint under happy-dom, and the crosshair
// is observable as the elements handed to `zr.add`.
const linkedQualityCharts = async () => {
  const hoveredFiber = Effect.runFork(
    Stream.runDrain(
      MountLatencyChart({ hostId: "hovered-host" }).f(mountedHost())
    )
  );
  const siblingFiber = Effect.runFork(
    Stream.runDrain(
      MountJitterChart({ hostId: "sibling-host" }).f(mountedHost())
    )
  );
  // A fixed setTimeout(0) can't be trusted to outlast both fibers' acquire
  // steps under coverage instrumentation's overhead, so poll instead.
  await vi.waitFor(() => {
    if (
      getChart("hovered-host")._tag !== "Some" ||
      getChart("sibling-host")._tag !== "Some"
    ) {
      throw new Error("both quality charts should have mounted");
    }
  });

  const maybeHovered = getChart("hovered-host");
  const maybeSibling = getChart("sibling-host");
  if (maybeHovered._tag !== "Some" || maybeSibling._tag !== "Some") {
    throw new Error("both quality charts should have mounted");
  }

  const siblingZr = {
    add: vi.fn(),
    remove: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
  Object.assign(maybeSibling.value, {
    getZr: () => siblingZr,
    convertToPixel: () => 42,
  });

  return {
    siblingZr,
    // echarts lowercases event names when registering listeners, and
    // dispatches its own axis pointer updates under the lowercased name.
    emit: (payload: unknown) =>
      (
        maybeHovered.value as EChartsType & {
          trigger: (event: string, payload: unknown) => void;
        }
      ).trigger("updateaxispointer", payload),
    cleanup: async () => {
      await Effect.runPromise(Fiber.interrupt(hoveredFiber));
      await Effect.runPromise(Fiber.interrupt(siblingFiber));
    },
  };
};

describe("axis pointer sync", () => {
  test("a well-formed updateAxisPointer draws a crosshair on the sibling", async () => {
    const { siblingZr, emit, cleanup } = await linkedQualityCharts();

    emit({ axesInfo: [{ axisDim: "x", axisIndex: 0, value: 5 }] });

    expect(siblingZr.add).toHaveBeenCalledTimes(1);

    await cleanup();
  });

  test("malformed updateAxisPointer payloads draw nothing and never throw", async () => {
    const { siblingZr, emit, cleanup } = await linkedQualityCharts();

    expect(() => emit({ nonsense: true })).not.toThrow();
    expect(() =>
      emit({ axesInfo: [{ axisDim: "x", axisIndex: "zero", value: "five" }] })
    ).not.toThrow();
    expect(() => emit(undefined)).not.toThrow();

    expect(siblingZr.add).not.toHaveBeenCalled();

    await cleanup();
  });
});
