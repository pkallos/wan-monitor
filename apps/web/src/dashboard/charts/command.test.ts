import type { Granularity } from "@shared/api/routes/metrics";
import type { EChartsType } from "echarts/core";
import * as echarts from "echarts/core";
import { Effect, Fiber, Option, Schema as S, Stream } from "effect";
import { afterEach, describe, expect, test, vi } from "vitest";
import { chartEvents, getChart, setChart } from "@/dashboard/charts/chartHost";
import {
  MountJitterChart,
  MountLatencyChart,
  MountPacketLossChart,
  MountSpeedChart,
  resizeChart,
  SyncJitterChart,
  SyncLatencyChart,
  SyncPacketLossChart,
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

// A real ECharts instance on a sized host, whose `setOption`, `getOption` and
// `dispatchAction` (and optionally `resize`) are stood in for: the real ones
// can't paint under happy-dom (no canvas 2d context). `getWidth` stays real,
// so a sync lays out against `widthPx`.
type Overrides = Partial<
  Pick<EChartsType, "resize" | "getOption" | "dispatchAction">
> & { widthPx?: number };

const stubChart = (
  setOption: (option: unknown, notMerge?: unknown) => void,
  { resize, getOption, dispatchAction, widthPx = 800 }: Overrides = {}
): EChartsType => {
  const chart = echarts.init(mountedHost(), undefined, {
    renderer: "canvas",
    width: widthPx,
    height: 200,
  });
  vi.spyOn(chart, "setOption").mockImplementation(setOption);
  vi.spyOn(chart, "getOption").mockImplementation(getOption ?? (() => ({})));
  vi.spyOn(chart, "dispatchAction").mockImplementation(
    dispatchAction ?? (() => {})
  );
  if (resize !== undefined)
    vi.spyOn(chart, "resize").mockImplementation(resize);
  return chart;
};

// The option a Sync Command hands to a registered chart, read through a schema
// so a changed shape fails the test instead of reading `undefined`.
const paintedOption = async <A, I>(
  hostId: string,
  schema: S.Codec<A, I>,
  run: () => Promise<unknown>,
  chartOverrides: Overrides = {}
): Promise<A> => {
  const options: unknown[] = [];
  setChart(
    hostId,
    stubChart((option) => options.push(option), chartOverrides)
  );
  await run();
  return S.decodeUnknownSync(schema)(options[options.length - 1]);
};

const syncLatency = (hostId: string) =>
  Effect.runPromise(
    SyncLatencyChart({
      hostId,
      metrics: [],
      ...ONE_DAY_WINDOW,
      hostSeries: [],
      incidents: [],
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

  test("paints with the palette of whichever theme `<html>` carries when it runs", async () => {
    const style = document.createElement("style");
    style.textContent =
      ":root { --accent: #111111; } .dark { --accent: #eeeeee; }";
    document.head.appendChild(style);
    const LineColor = S.Struct({
      series: S.Array(S.Struct({ lineStyle: S.Struct({ color: S.String }) })),
    });
    const lineColor = () =>
      paintedOption("themed-latency-chart", LineColor, () =>
        syncLatency("themed-latency-chart")
      ).then(({ series }) => series[0]?.lineStyle.color);
    const lineColors: Array<string | undefined> = [];

    try {
      lineColors.push(await lineColor());
      document.documentElement.classList.add("dark");
      lineColors.push(await lineColor());
    } finally {
      document.documentElement.classList.remove("dark");
      style.remove();
    }

    expect(lineColors).toEqual(["#111111", "#eeeeee"]);
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
          hostSeries: [],
          incidents: [],
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

const WithSeries = S.Struct({
  series: S.Array(
    S.Struct({
      name: S.String,
      markArea: S.optional(S.Struct({ data: S.Array(S.Unknown) })),
      markLine: S.optional(
        S.Struct({ data: S.Array(S.Struct({ yAxis: S.optional(S.Number) })) })
      ),
    })
  ),
  xAxis: S.Struct({ min: S.Number, max: S.Number }),
});

const TIMELINE_ARGS = {
  metrics: [
    {
      timestamp: "2026-07-26T06:07:00.000Z",
      source: "ping" as const,
      jitter: 2,
      packet_loss: 1,
    },
  ],
  ...ONE_DAY_WINDOW,
  incidents: [],
};

describe("the packet loss, jitter and speed charts", () => {
  test("the jitter chart paints jitter with its acceptable-level reference line", async () => {
    const option = await paintedOption("sync-jitter", WithSeries, () =>
      Effect.runPromise(
        SyncJitterChart({ hostId: "sync-jitter", ...TIMELINE_ARGS }).effect
      )
    );

    expect(option.series.map(({ name }) => name)).toEqual(["Jitter"]);
    expect(option.series[0].markLine?.data[0].yAxis).toBe(10);
  });

  test("the packet loss chart paints loss", async () => {
    const option = await paintedOption("sync-loss", WithSeries, () =>
      Effect.runPromise(
        SyncPacketLossChart({ hostId: "sync-loss", ...TIMELINE_ARGS }).effect
      )
    );

    expect(option.series.map(({ name }) => name)).toEqual(["Packet loss"]);
  });

  const incident = {
    ref: "A",
    startMs: ONE_DAY_WINDOW.startTimeMs + 3_600_000,
    endMs: ONE_DAY_WINDOW.startTimeMs + 7_200_000,
    status: "down" as const,
  };

  test.each([
    [
      "latency",
      (hostId: string) =>
        Effect.runPromise(
          SyncLatencyChart({
            hostId,
            ...TIMELINE_ARGS,
            hostSeries: [],
            incidents: [incident],
          }).effect
        ),
    ],
    [
      "packet loss",
      (hostId: string) =>
        Effect.runPromise(
          SyncPacketLossChart({
            hostId,
            ...TIMELINE_ARGS,
            incidents: [incident],
          }).effect
        ),
    ],
    [
      "jitter",
      (hostId: string) =>
        Effect.runPromise(
          SyncJitterChart({
            hostId,
            ...TIMELINE_ARGS,
            incidents: [incident],
          }).effect
        ),
    ],
  ])("the %s chart marks the incidents it is given", async (name, command) => {
    const hostId = `incidents-${name}`;
    const option = await paintedOption(hostId, WithSeries, () =>
      command(hostId)
    );

    expect(option.series[0].markArea?.data).toHaveLength(1);
  });

  test("the speed chart paints on the window it is given", async () => {
    const option = await paintedOption("sync-speed", WithSeries, () =>
      Effect.runPromise(
        SyncSpeedChart({
          hostId: "sync-speed",
          metrics: [],
          startTimeMs: ONE_DAY_WINDOW.startTimeMs,
          endTimeMs: ONE_DAY_WINDOW.endTimeMs,
        }).effect
      )
    );

    expect(option.xAxis.min).toBe(ONE_DAY_WINDOW.startTimeMs);
    expect(option.xAxis.max).toBe(ONE_DAY_WINDOW.endTimeMs);
  });

  test.each([
    [
      "jitter",
      (hostId: string) =>
        Effect.runPromise(SyncJitterChart({ hostId, ...TIMELINE_ARGS }).effect),
    ],
    [
      "packet loss",
      (hostId: string) =>
        Effect.runPromise(
          SyncPacketLossChart({ hostId, ...TIMELINE_ARGS }).effect
        ),
    ],
  ])(
    "the %s chart reports a missing chart with its own failure",
    async (_name, run) => {
      const result = await run("never-mounted-chart");

      expect(result).toEqual({
        _tag: expect.stringMatching(/^FailedSync/),
        reason: "Could not find a live chart for hostId never-mounted-chart.",
      });
    }
  );

  test("the speed chart does not take part in the quality charts' shared hover and zoom", async () => {
    const speedFiber = Effect.runFork(
      Stream.runDrain(
        MountSpeedChart({ hostId: "speed-host" }).f(mountedHost(), Stream.empty)
      )
    );
    const { emitZoom, cleanup } = await linkedQualityCharts();
    await vi.waitFor(() =>
      expect(Option.isSome(getChart("speed-host"))).toBe(true)
    );
    const speedDispatch = vi.fn();
    Object.assign(Option.getOrThrow(getChart("speed-host")), {
      dispatchAction: speedDispatch,
    });

    emitZoom({ batch: [{ dataZoomId: "z", start: 20, end: 50 }] });

    expect(speedDispatch).not.toHaveBeenCalled();

    await cleanup();
    await Effect.runPromise(Fiber.interrupt(speedFiber));
  });
});

describe("the latency chart's sync", () => {
  const SLOT_COUNT = 24 * 12;
  const PerHostSeries = S.Struct({
    series: S.Array(
      S.Struct({
        name: S.String,
        data: S.Array(S.Tuple([S.Number, S.NullOr(S.Number)])),
        markLine: S.optional(
          S.Struct({
            data: S.Array(
              S.Struct({
                yAxis: S.optional(S.Number),
                label: S.optional(S.Struct({ formatter: S.String })),
                xAxis: S.optional(S.Number),
              })
            ),
          })
        ),
      })
    ),
  });
  const reading = (isoTime: string, latency: number) => ({
    timestamp: isoTime,
    source: "ping" as const,
    latency,
  });
  const first = reading("2026-07-26T06:07:00.000Z", 12);
  const second = reading("2026-07-26T18:30:00.000Z", 30);

  const paintLatency = (
    hostId: string,
    args: {
      metrics?: ReadonlyArray<typeof first>;
      hostSeries?: ReadonlyArray<{
        host: string;
        metrics: ReadonlyArray<typeof first>;
      }>;
      incidents?: ReadonlyArray<{
        ref: string;
        startMs: number;
        endMs: number;
        status: "down";
      }>;
    },
    widthPx = 800
  ) =>
    paintedOption(
      hostId,
      PerHostSeries,
      () =>
        Effect.runPromise(
          SyncLatencyChart({
            hostId,
            metrics: [],
            hostSeries: [],
            incidents: [],
            ...ONE_DAY_WINDOW,
            ...args,
          }).effect
        ),
      { widthPx }
    );

  test("draws one line per host, each on the window's own slots with gaps where a host has no reading", async () => {
    const option = await paintLatency("per-host-sync", {
      hostSeries: [
        { host: "8.8.8.8", metrics: [first, second] },
        { host: "1.1.1.1", metrics: [first] },
      ],
    });

    const hosts = option.series.filter(
      ({ name }) => name === "8.8.8.8" || name === "1.1.1.1"
    );
    expect(hosts.map(({ name }) => name)).toEqual(["8.8.8.8", "1.1.1.1"]);
    for (const { data } of hosts) {
      expect(data).toHaveLength(SLOT_COUNT);
    }
    const readings = (name: string) =>
      hosts
        .find((host) => host.name === name)
        ?.data.filter(([, value]) => value !== null);
    expect(readings("8.8.8.8")).toEqual([
      [Date.parse("2026-07-26T06:05:00.000Z"), 12],
      [Date.parse("2026-07-26T18:30:00.000Z"), 30],
    ]);
    expect(readings("1.1.1.1")).toEqual([
      [Date.parse("2026-07-26T06:05:00.000Z"), 12],
    ]);
  });

  test("draws the all-hosts line with its average when no host series are given", async () => {
    const option = await paintLatency("all-hosts-sync", {
      metrics: [first, second],
    });

    const [line] = option.series;
    expect(line?.name).toBe("Latency");
    expect(
      line?.markLine?.data.find(({ label }) =>
        label?.formatter.startsWith("Avg")
      )
    ).toEqual(
      expect.objectContaining({
        yAxis: 21,
        label: { formatter: "Avg 21.0 ms" },
      })
    );
  });

  test("lays the incident chips out against the chart's own width", async () => {
    const incidents = [
      {
        ref: "A",
        startMs: ONE_DAY_WINDOW.startTimeMs + 3_600_000,
        endMs: ONE_DAY_WINDOW.startTimeMs + 3_660_000,
        status: "down" as const,
      },
      {
        ref: "B",
        startMs: ONE_DAY_WINDOW.startTimeMs + 7_200_000,
        endMs: ONE_DAY_WINDOW.startTimeMs + 7_260_000,
        status: "down" as const,
      },
    ];
    const chipLabels = async (widthPx: number) => {
      const option = await paintLatency(
        `chips-at-${widthPx}`,
        { incidents },
        widthPx
      );
      return option.series
        .flatMap(({ markLine }) => markLine?.data ?? [])
        .filter(({ xAxis }) => xAxis !== undefined)
        .map(({ label }) => label?.formatter);
    };

    expect(await chipLabels(800)).toEqual(["A", "B"]);
    expect(await chipLabels(320)).toEqual(["A–B", "B"]);
  });
});

describe("chart motion", () => {
  afterEach(() => vi.unstubAllGlobals());

  const animationOf = async (prefersReducedMotion: boolean) => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches:
        prefersReducedMotion && query === "(prefers-reduced-motion: reduce)",
    }));
    const hostId = `motion-${prefersReducedMotion}`;
    const paint = (run: () => Promise<unknown>) =>
      paintedOption(hostId, S.Struct({ animation: S.Boolean }), run).then(
        ({ animation }) => animation
      );
    return {
      latency: await paint(() => syncLatency(hostId)),
      speed: await paint(() =>
        Effect.runPromise(
          SyncSpeedChart({
            hostId,
            metrics: [],
            startTimeMs: ONE_DAY_WINDOW.startTimeMs,
            endTimeMs: ONE_DAY_WINDOW.endTimeMs,
          }).effect
        )
      ),
    };
  };

  test("charts do not animate for a viewer who prefers reduced motion", async () => {
    expect(await animationOf(true)).toEqual({ latency: false, speed: false });
  });

  test("charts animate otherwise", async () => {
    expect(await animationOf(false)).toEqual({ latency: true, speed: true });
  });
});

describe("zoom across repaints", () => {
  const zoomedChart = (zoom: { start: number; end: number }) => {
    const setOption = vi.fn();
    const chart = stubChart(setOption, {
      getOption: () => ({
        dataZoom: [{ ...zoom, startValue: 0, endValue: 1 }],
      }),
    });
    return { chart, setOption };
  };

  const PaintedZoom = S.Struct({
    dataZoom: S.Array(S.Struct({ start: S.Number, end: S.Number })),
  });
  const zoomPainted = (setOption: ReturnType<typeof vi.fn>) => {
    const [option] =
      setOption.mock.calls[setOption.mock.calls.length - 1] ?? [];
    const [zoom] = S.decodeUnknownSync(PaintedZoom)(option).dataZoom;
    return { start: zoom?.start, end: zoom?.end };
  };

  const paintLatency = (
    hostId: string,
    window: {
      startTimeMs: number;
      endTimeMs: number;
      granularity: Granularity;
    }
  ) =>
    Effect.runPromise(
      SyncLatencyChart({
        hostId,
        metrics: [],
        ...window,
        hostSeries: [],
        incidents: [],
      }).effect
    );

  test("the first paint is fully zoomed out", async () => {
    const { chart, setOption } = zoomedChart({ start: 20, end: 50 });
    setChart("first-paint-zoom", chart);

    await paintLatency("first-paint-zoom", ONE_DAY_WINDOW);

    expect(zoomPainted(setOption)).toEqual({ start: 0, end: 100 });
  });

  test("a repaint of the same window keeps the zoom the viewer reached", async () => {
    const { chart, setOption } = zoomedChart({ start: 20, end: 50 });
    setChart("same-window-zoom", chart);

    await paintLatency("same-window-zoom", ONE_DAY_WINDOW);
    await paintLatency("same-window-zoom", ONE_DAY_WINDOW);

    expect(zoomPainted(setOption)).toEqual({ start: 20, end: 50 });
  });

  test("a refresh that rolled the window forward keeps the same span zoomed", async () => {
    const { chart, setOption } = zoomedChart({ start: 50, end: 75 });
    setChart("rolled-window-zoom", chart);
    const rolled = {
      ...ONE_DAY_WINDOW,
      startTimeMs: ONE_DAY_WINDOW.startTimeMs + 3_600_000,
      endTimeMs: ONE_DAY_WINDOW.endTimeMs + 3_600_000,
    };

    await paintLatency("rolled-window-zoom", ONE_DAY_WINDOW);
    await paintLatency("rolled-window-zoom", rolled);

    const { start, end } = zoomPainted(setOption);
    expect(start).toBeCloseTo((11 / 24) * 100);
    expect(end).toBeCloseTo((17 / 24) * 100);
  });

  test("a different window starts fully zoomed out", async () => {
    const { chart, setOption } = zoomedChart({ start: 20, end: 50 });
    setChart("new-window-zoom", chart);
    const week = {
      ...ONE_DAY_WINDOW,
      startTimeMs: ONE_DAY_WINDOW.endTimeMs - 7 * 24 * 3_600_000,
      granularity: "1h" as const,
    };

    await paintLatency("new-window-zoom", ONE_DAY_WINDOW);
    await paintLatency("new-window-zoom", week);

    expect(zoomPainted(setOption)).toEqual({ start: 0, end: 100 });
  });
});

describe("mountEchartsInstance", () => {
  test("an element that is not an HTMLElement fails the mount", async () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");

    const message = await Effect.runPromise(
      Stream.runHead(
        MountLatencyChart({ hostId: "svg-host" }).f(svg, Stream.empty)
      )
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
      Stream.runHead(
        MountLatencyChart({ hostId: "div-host" }).f(mountedHost(), Stream.empty)
      )
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
        MountLatencyChart({ hostId: "still-mounted-host" }).f(
          mountedHost(),
          Stream.empty
        )
      )
    );
    // A fixed setTimeout(0) can't be trusted to outlast the fiber's acquire
    // step under coverage instrumentation's overhead, so poll instead.
    await vi.waitFor(() =>
      expect(Option.isSome(getChart("still-mounted-host"))).toBe(true)
    );

    await Effect.runPromise(Fiber.interrupt(fiber));

    expect(getChart("still-mounted-host")).toEqual(Option.none());
  });
});

// Two mounted quality charts, with the sibling's zrender and coordinate
// conversion stubbed: zrender can't paint under happy-dom, and the crosshair
// is observable as the elements handed to `zr.add`.
const linkedQualityCharts = async (
  siblingKind: "jitter" | "packetLoss" = "jitter"
) => {
  const hoveredFiber = Effect.runFork(
    Stream.runDrain(
      MountLatencyChart({ hostId: "hovered-host" }).f(
        mountedHost(),
        Stream.empty
      )
    )
  );
  const siblingMount =
    siblingKind === "jitter"
      ? Stream.runDrain(
          MountJitterChart({ hostId: "sibling-host" }).f(
            mountedHost(),
            Stream.empty
          )
        )
      : Stream.runDrain(
          MountPacketLossChart({ hostId: "sibling-host" }).f(
            mountedHost(),
            Stream.empty
          )
        );
  const siblingFiber = Effect.runFork(siblingMount);
  // A fixed setTimeout(0) can't be trusted to outlast both fibers' acquire
  // steps under coverage instrumentation's overhead, so poll instead.
  await vi.waitFor(() => {
    expect(Option.isSome(getChart("hovered-host"))).toBe(true);
    expect(Option.isSome(getChart("sibling-host"))).toBe(true);
  });

  const hovered = Option.getOrThrow(getChart("hovered-host"));
  const sibling = Option.getOrThrow(getChart("sibling-host"));

  const siblingZr = {
    add: vi.fn(),
    remove: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
  const siblingDispatch = vi.fn();
  const hoveredDispatch = vi.spyOn(hovered, "dispatchAction");
  Object.assign(sibling, {
    getZr: () => siblingZr,
    convertToPixel: () => 42,
    dispatchAction: siblingDispatch,
  });

  // echarts lowercases event names when registering listeners, and
  // dispatches its own events under the lowercased name.
  const trigger = (event: string, payload: unknown) =>
    (
      hovered as EChartsType & {
        trigger: (event: string, payload: unknown) => void;
      }
    ).trigger(event, payload);

  return {
    siblingZr,
    siblingDispatch,
    hoveredDispatch,
    emit: (payload: unknown) => trigger("updateaxispointer", payload),
    emitZoom: (payload: unknown) => trigger("datazoom", payload),
    cleanup: async () => {
      await Effect.runPromise(Fiber.interrupt(hoveredFiber));
      await Effect.runPromise(Fiber.interrupt(siblingFiber));
    },
  };
};

describe("zoom sync", () => {
  test("zooming one quality chart forwards the zoom to the others", async () => {
    const { siblingDispatch, hoveredDispatch, emitZoom, cleanup } =
      await linkedQualityCharts();

    emitZoom({ batch: [{ dataZoomId: "z", start: 20, end: 50 }] });

    expect(siblingDispatch).toHaveBeenCalledWith(
      { type: "dataZoom", start: 20, end: 50 },
      { silent: true }
    );
    expect(hoveredDispatch).not.toHaveBeenCalled();

    await cleanup();
  });

  test("the packet loss chart takes part in the shared zoom", async () => {
    const { siblingDispatch, emitZoom, cleanup } =
      await linkedQualityCharts("packetLoss");

    emitZoom({ batch: [{ dataZoomId: "z", start: 20, end: 50 }] });

    expect(siblingDispatch).toHaveBeenCalledWith(
      { type: "dataZoom", start: 20, end: 50 },
      { silent: true }
    );

    await cleanup();
  });

  test("a zoom event with no usable range forwards nothing and never throws", async () => {
    const { siblingDispatch, emitZoom, cleanup } = await linkedQualityCharts();

    expect(() => emitZoom({ batch: [] })).not.toThrow();
    expect(() => emitZoom({ batch: [{ start: "a", end: "b" }] })).not.toThrow();
    expect(() => emitZoom(undefined)).not.toThrow();

    expect(siblingDispatch).not.toHaveBeenCalled();

    await cleanup();
  });

  test("stops forwarding once the chart is unmounted", async () => {
    const { siblingDispatch, emitZoom, cleanup } = await linkedQualityCharts();
    await cleanup();

    emitZoom({ batch: [{ start: 20, end: 50 }] });

    expect(siblingDispatch).not.toHaveBeenCalled();
  });

  // Joining an echarts group connects the chart, and a connected chart mirrors
  // every action, a tooltip among them, onto the rest of the group, so one
  // hover would open a tooltip on all three charts.
  test("the quality charts stay out of any echarts group", async () => {
    const { cleanup } = await linkedQualityCharts();
    const group = (hostId: string) => Option.getOrThrow(getChart(hostId)).group;

    expect(group("hovered-host")).toBeFalsy();
    expect(group("sibling-host")).toBeFalsy();

    await cleanup();
  });
});

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

describe("resizeChart", () => {
  const realChart = () => {
    const element = mountedHost();
    return echarts.init(element, undefined, {
      renderer: "canvas",
      width: 800,
      height: 200,
    });
  };

  // Merging an x axis into a chart that has no grid or series yet makes
  // echarts lay out an axis with no coordinate system, which throws from
  // inside its renderer. A container can resize before the first data paint.
  test("a resize before the first paint leaves the chart's options alone", () => {
    const chart = realChart();

    expect(() => resizeChart(chart)).not.toThrow();
    expect(chart.getOption()).toBeUndefined();
  });

  // zrender can't paint under happy-dom, so a painted chart is stood in for.
  test("a resize after a paint re-derives how many ticks the axis shows", () => {
    const setOption = vi.fn();
    const resize = vi.fn();
    const painted = stubChart(setOption, {
      resize,
      getOption: () => ({ series: [{ type: "line" }] }),
    });

    resizeChart(painted);

    expect(resize).toHaveBeenCalledTimes(1);
    expect(setOption).toHaveBeenCalledWith({
      xAxis: { splitNumber: expect.any(Number) },
    });
  });
});

describe("range brush", () => {
  const HOST_ID = "brushed-latency-host";

  const mountLatency = async () => {
    const fiber = Effect.runFork(
      Stream.runDrain(
        MountLatencyChart({ hostId: HOST_ID }).f(mountedHost(), Stream.empty)
      )
    );
    await vi.waitFor(() => expect(Option.isSome(getChart(HOST_ID))).toBe(true));
    const chart = Option.getOrThrow(getChart(HOST_ID));
    const dispatchAction = vi.fn();
    Object.assign(chart, { dispatchAction });
    return {
      dispatchAction,
      // echarts lowercases event names when registering listeners.
      emit: (payload: unknown) =>
        (
          chart as EChartsType & {
            trigger: (event: string, payload: unknown) => void;
          }
        ).trigger("brushend", payload),
      stop: () => Effect.runPromise(Fiber.interrupt(fiber)),
    };
  };

  const heard = () => {
    const details: unknown[] = [];
    const listener = (event: Event) => {
      if (event instanceof CustomEvent) details.push(event.detail);
    };
    chartEvents.addEventListener("brush", listener);
    return {
      details,
      stop: () => chartEvents.removeEventListener("brush", listener),
    };
  };

  test("a committed stroke is reported with the span it covers, then cleared", async () => {
    const { emit, dispatchAction, stop } = await mountLatency();
    const listening = heard();

    emit({ areas: [{ coordRange: [1000, 5000], brushType: "lineX" }] });

    expect(listening.details).toEqual([{ startMs: 1000, endMs: 5000 }]);
    expect(dispatchAction).toHaveBeenCalledWith({ type: "brush", areas: [] });

    listening.stop();
    await stop();
  });

  test("an event with no usable span reports nothing", async () => {
    const { emit, dispatchAction, stop } = await mountLatency();
    const listening = heard();

    emit({ areas: [] });
    emit({ areas: [{ coordRange: "nope" }] });
    emit(undefined);

    expect(listening.details).toEqual([]);
    expect(dispatchAction).not.toHaveBeenCalled();

    listening.stop();
    await stop();
  });

  test("stops listening once the Mount is torn down", async () => {
    const { emit, stop } = await mountLatency();
    const listening = heard();
    await stop();

    emit({ areas: [{ coordRange: [1000, 5000] }] });

    expect(listening.details).toEqual([]);
    listening.stop();
  });

  describe("turning the drag into a stroke", () => {
    afterEach(() => vi.unstubAllGlobals());

    const paintLatency = async (isFinePointer: boolean) => {
      vi.stubGlobal("matchMedia", () => ({ matches: isFinePointer }));
      const dispatchAction = vi.fn();
      setChart(
        "stroke-latency-chart",
        stubChart(() => {}, { dispatchAction })
      );
      await syncLatency("stroke-latency-chart");
      return dispatchAction;
    };

    test("a precise pointer gets a plain drag as a horizontal stroke, after each paint", async () => {
      const dispatchAction = await paintLatency(true);

      expect(dispatchAction).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "takeGlobalCursor",
          key: "brush",
          brushOption: { brushType: "lineX", brushMode: "single" },
        })
      );
    });

    test("a touch screen keeps its drag for scrolling the page", async () => {
      const dispatchAction = await paintLatency(false);

      expect(dispatchAction).not.toHaveBeenCalled();
    });
  });
});

describe("wheel over a chart", () => {
  const HOST_ID = "wheel-latency-host";

  const mountWithListener = async () => {
    const host = mountedHost();
    const fiber = Effect.runFork(
      Stream.runDrain(
        MountLatencyChart({ hostId: HOST_ID }).f(host, Stream.empty)
      )
    );
    await vi.waitFor(() => expect(Option.isSome(getChart(HOST_ID))).toBe(true));
    // Where echarts listens: an element inside the host.
    const inner = document.createElement("div");
    host.appendChild(inner);
    const seen: WheelEvent[] = [];
    inner.addEventListener("wheel", (event) => seen.push(event));
    return {
      inner,
      seen,
      stop: () => Effect.runPromise(Fiber.interrupt(fiber)),
    };
  };

  test("a plain turn never reaches the chart, so the page keeps scrolling", async () => {
    const { inner, seen, stop } = await mountWithListener();

    inner.dispatchEvent(
      new WheelEvent("wheel", { deltaY: 100, bubbles: true })
    );

    expect(seen).toEqual([]);
    await stop();
  });

  test("a turn with Ctrl held, or a trackpad pinch, reaches the chart to zoom it", async () => {
    const { inner, seen, stop } = await mountWithListener();

    // happy-dom's WheelEvent drops the modifier keys, so it is set by hand.
    const zoomTurn = new WheelEvent("wheel", { deltaY: -100, bubbles: true });
    Object.defineProperty(zoomTurn, "ctrlKey", { value: true });
    inner.dispatchEvent(zoomTurn);

    expect(seen).toHaveLength(1);
    await stop();
  });

  test("leaves the page's own scrolling alone, never cancelling the event", async () => {
    const { inner, stop } = await mountWithListener();
    const event = new WheelEvent("wheel", {
      deltaY: 100,
      bubbles: true,
      cancelable: true,
    });

    inner.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    await stop();
  });
});
