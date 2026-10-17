import type { Metric } from "@shared/api/routes/metrics";
import type { SpeedMetric } from "@shared/api/routes/speedtest";
import { Option } from "effect";
import { describe, expect, test } from "vitest";
import { Custom, Preset } from "@/dashboard/dateRange";
import {
  HostLatencyAsyncData,
  initModel,
  MetricsAsyncData,
  type Model,
  PingHostsAsyncData,
  SpeedtestHistoryAsyncData,
} from "@/dashboard/model";
import { DEFAULT_REQUEST } from "@/dashboard/testFixtures";
import {
  isPerHostView,
  jitterReadout,
  latencyReadout,
  packetLossReadout,
  speedReadout,
} from "@/dashboard/view/chartReadout";
import { defaultSettings } from "@/storage";

const ping = (minute: number, fields: Partial<Metric> = {}): Metric => ({
  timestamp: new Date(Date.UTC(2026, 6, 28, 10, minute)).toISOString(),
  source: "ping",
  ...fields,
});

const speed = (
  hour: number,
  fields: Partial<SpeedMetric> = {}
): SpeedMetric => ({
  timestamp: new Date(Date.UTC(2026, 6, 28, hour)).toISOString(),
  ...fields,
});

const WINDOW = { startTimeMs: 0, endTimeMs: 3_600_000 };
const METRICS_WINDOW = {
  ...WINDOW,
  granularity: "1m" as const,
  request: DEFAULT_REQUEST,
};

const withMetrics = (data: ReadonlyArray<Metric>): Model => ({
  ...initModel(defaultSettings()),
  metrics: MetricsAsyncData.Success({ data }),
  maybeMetricsWindow: Option.some(METRICS_WINDOW),
});

// The model after the viewer moved to the last 24 hours, with whatever the
// last 30 days' fetch left behind still in place.
const movedToLast24h = (model: Model): Model => ({
  ...model,
  dateRange: Preset({ preset: "last24h" }),
});

const NO_NOTICE = Option.none();
const LOAD_FAILED = Option.some("Could not load the chart.");

const TWO_POINTS = [
  ping(0, { latency: 10, packet_loss: 1, jitter: 2 }),
  ping(5, { latency: 30, packet_loss: 3, jitter: 4 }),
];

describe("latencyReadout", () => {
  test("names the range, the median's average and the 95th percentile's peak", () => {
    const model = withMetrics([
      ping(0, { latency: 30, latency_p50: 20, latency_p95: 80 }),
      ping(5, { latency: 50, latency_p50: 40, latency_p95: 120 }),
    ]);

    expect(latencyReadout(model)).toEqual({
      label:
        "For the last 30 days. Bucket median latency averages 30.0 ms and the highest 95th percentile is 120.0 ms.",
      maybeNotice: NO_NOTICE,
      isLoading: false,
    });
  });

  test("leaves the 95th percentile out when only medians were requested", () => {
    const model = withMetrics([
      ping(0, { latency: 90, latency_p50: 20 }),
      ping(5, { latency: 90, latency_p50: 40 }),
    ]);

    expect(latencyReadout(model).label).toBe(
      "For the last 30 days. Bucket median latency averages 30.0 ms."
    );
  });

  test("falls back to the plain latency line when the rows carry no percentiles", () => {
    const model = withMetrics([
      ping(0, { latency: 10 }),
      ping(5, { latency: 30 }),
    ]);

    expect(latencyReadout(model).label).toBe(
      "For the last 30 days. Bucket latency averages 20.0 ms and is highest at 30.0 ms."
    );
  });

  test("names a custom range by its dates", () => {
    const dateRange = Custom({
      startTime: "2026-07-28T10:00:00.000Z",
      endTime: "2026-07-28T10:05:00.000Z",
    });
    const model = {
      ...withMetrics([ping(0, { latency: 10 }), ping(5, { latency: 30 })]),
      dateRange,
      maybeMetricsWindow: Option.some({
        ...METRICS_WINDOW,
        request: { ...DEFAULT_REQUEST, dateRange },
      }),
    };

    expect(latencyReadout(model).label).toMatch(
      /^For .*\d.*\. Bucket latency averages/
    );
    expect(latencyReadout(model).label).not.toContain("last 30 days");
  });

  test("reads each host's own line in the per-host view, and says which have no data", () => {
    const model: Model = {
      ...withMetrics([ping(0, { latency: 99 })]),
      latencyView: "perHost",
      hostLatency: HostLatencyAsyncData.Success({
        data: {
          series: [
            {
              host: "8.8.8.8",
              metrics: [
                ping(0, { latency: 30, latency_p50: 20 }),
                ping(5, { latency: 50, latency_p50: 40 }),
              ],
            },
            { host: "1.1.1.1", metrics: [] },
          ],
          window: METRICS_WINDOW,
        },
      }),
    };

    expect(latencyReadout(model)).toEqual({
      label:
        "For the last 30 days. Median latency per host. 8.8.8.8 bucket median averages 30.0 ms and is highest at 40.0 ms. 1.1.1.1 has no data.",
      maybeNotice: NO_NOTICE,
      isLoading: false,
    });
  });

  test("keeps describing the all-hosts line until the per-host fetch has been asked for", () => {
    const model: Model = {
      ...withMetrics([ping(0, { latency: 10 }), ping(5, { latency: 30 })]),
      latencyView: "perHost",
    };

    expect(isPerHostView(model)).toBe(false);
    expect(latencyReadout(model).label).toContain(
      "Bucket latency averages 20.0 ms"
    );
  });

  test("says there is no data, and shows no figures, for an empty range", () => {
    expect(latencyReadout(withMetrics([]))).toEqual({
      label: "For the last 30 days. No data in this range.",
      maybeNotice: Option.some("No data in this range."),
      isLoading: false,
    });
  });

  test("rows without a latency reading are no data either", () => {
    expect(
      latencyReadout(withMetrics([ping(0), ping(5, { packet_loss: 1 })]))
        .maybeNotice
    ).toEqual(Option.some("No data in this range."));
  });

  test("one bucket is too little to draw a line", () => {
    expect(latencyReadout(withMetrics([ping(0, { latency: 12 })]))).toEqual({
      label: "For the last 30 days. Not enough data to draw a line.",
      maybeNotice: Option.some("Not enough data to draw a line."),
      isLoading: false,
    });
  });

  test("a failed load says so instead of describing data", () => {
    const model: Model = {
      ...initModel(defaultSettings()),
      metrics: MetricsAsyncData.Failure({ error: "db down" }),
    };

    expect(latencyReadout(model)).toEqual({
      label: "For the last 30 days. Could not load the chart.",
      maybeNotice: Option.some("Could not load the chart."),
      isLoading: false,
    });
  });

  test("a refresh that fails after data landed keeps describing that data", () => {
    const model: Model = {
      ...initModel(defaultSettings()),
      metrics: MetricsAsyncData.Stale({
        data: [ping(0, { latency: 10 }), ping(5, { latency: 30 })],
        error: "db down",
      }),
      maybeMetricsWindow: Option.some(METRICS_WINDOW),
    };

    expect(latencyReadout(model).maybeNotice).toEqual(NO_NOTICE);
  });

  test("a failed per-host load with nothing to fall back on says so", () => {
    const model: Model = {
      ...withMetrics([ping(0, { latency: 10 }), ping(5, { latency: 30 })]),
      latencyView: "perHost",
      pingHosts: PingHostsAsyncData.Idle(),
      hostLatency: HostLatencyAsyncData.Failure({ error: "db down" }),
    };

    expect(latencyReadout(model).maybeNotice).toEqual(
      Option.some("Could not load the chart.")
    );
  });

  test("names no figures while the first load is pending, and shows no notice", () => {
    expect(latencyReadout(initModel(defaultSettings()))).toEqual({
      label: "For the last 30 days. Loading.",
      maybeNotice: NO_NOTICE,
      isLoading: true,
    });
  });
});

describe("packetLossReadout", () => {
  test("states the average and the peak of the plotted buckets", () => {
    const model = withMetrics([
      ping(0, { packet_loss: 0 }),
      ping(5, { packet_loss: 0.5 }),
      ping(10, { packet_loss: 3.4 }),
    ]);

    expect(packetLossReadout(model)).toEqual({
      label:
        "For the last 30 days. Bucket packet loss averages 1.30% and is highest at 3.40%.",
      maybeNotice: NO_NOTICE,
      isLoading: false,
    });
  });

  test("keeps a zero reading as data", () => {
    const model = withMetrics([
      ping(0, { packet_loss: 0 }),
      ping(5, { packet_loss: 0 }),
    ]);

    expect(packetLossReadout(model).label).toContain(
      "averages 0.00% and is highest at 0.00%"
    );
  });

  test("says there is no data for an empty range, and that one bucket is too little", () => {
    expect(packetLossReadout(withMetrics([])).maybeNotice).toEqual(
      Option.some("No data in this range.")
    );
    expect(
      packetLossReadout(withMetrics([ping(0, { packet_loss: 0 })])).maybeNotice
    ).toEqual(Option.some("Not enough data to draw a chart."));
  });

  test("says when the load failed", () => {
    expect(
      packetLossReadout({
        ...initModel(defaultSettings()),
        metrics: MetricsAsyncData.Failure({ error: "db down" }),
      }).maybeNotice
    ).toEqual(Option.some("Could not load the chart."));
  });
});

describe("jitterReadout", () => {
  test("states the average and the peak of the plotted buckets", () => {
    const model = withMetrics([
      ping(0, { jitter: 1.5 }),
      ping(5, { jitter: 2.5 }),
      ping(10, { jitter: 8.5 }),
    ]);

    expect(jitterReadout(model)).toEqual({
      label:
        "For the last 30 days. Bucket jitter averages 4.17 ms and is highest at 8.50 ms.",
      maybeNotice: NO_NOTICE,
      isLoading: false,
    });
  });

  test("says there is no data, and that one bucket is too little to draw a line", () => {
    expect(jitterReadout(withMetrics([])).maybeNotice).toEqual(
      Option.some("No data in this range.")
    );
    expect(
      jitterReadout(withMetrics([ping(0, { jitter: 2 })])).maybeNotice
    ).toEqual(Option.some("Not enough data to draw a line."));
  });
});

describe("speedReadout", () => {
  const withSpeed = (data: ReadonlyArray<SpeedMetric>): Model => ({
    ...initModel(defaultSettings()),
    speedtestHistory: SpeedtestHistoryAsyncData.Success({ data }),
    maybeSpeedtestWindow: Option.some({ ...WINDOW, request: DEFAULT_REQUEST }),
  });

  test("states download and upload averages and peaks", () => {
    const model = withSpeed([
      speed(1, { download_speed: 100, upload_speed: 10 }),
      speed(2, { download_speed: 200, upload_speed: 20 }),
    ]);

    expect(speedReadout(model)).toEqual({
      label:
        "For the last 30 days. Download averages 150.0 Mbps and peaks at 200.0 Mbps. Upload averages 15.0 Mbps and peaks at 20.0 Mbps.",
      maybeNotice: NO_NOTICE,
      isLoading: false,
    });
  });

  test("a single test is still drawn, as a point", () => {
    const model = withSpeed([
      speed(1, { download_speed: 100, upload_speed: 10 }),
    ]);

    expect(speedReadout(model).maybeNotice).toEqual(NO_NOTICE);
  });

  test("a direction with no readings says so on its own", () => {
    const model = withSpeed([speed(1, { download_speed: 100 })]);

    expect(speedReadout(model).label).toBe(
      "For the last 30 days. Download averages 100.0 Mbps and peaks at 100.0 Mbps. Upload has no data."
    );
  });

  test("says there is no data for an empty range", () => {
    expect(speedReadout(withSpeed([]))).toEqual({
      label: "For the last 30 days. No data in this range.",
      maybeNotice: Option.some("No data in this range."),
      isLoading: false,
    });
  });

  test("says when the load failed", () => {
    expect(
      speedReadout({
        ...initModel(defaultSettings()),
        speedtestHistory: SpeedtestHistoryAsyncData.Failure({
          error: "db down",
        }),
      }).maybeNotice
    ).toEqual(Option.some("Could not load the chart."));
  });
});

describe("charts after the range changed", () => {
  const answeringOtherRange = (model: Model): Model => movedToLast24h(model);
  const oldRangeRefreshing: Model = answeringOtherRange({
    ...withMetrics([]),
    metrics: MetricsAsyncData.Refreshing({ data: TWO_POINTS }),
  });
  const oldRangeStale: Model = answeringOtherRange({
    ...withMetrics([]),
    metrics: MetricsAsyncData.Stale({ data: TWO_POINTS, error: "db down" }),
  });
  const readouts = [
    ["latency", latencyReadout],
    ["packet loss", packetLossReadout],
    ["jitter", jitterReadout],
  ] as const;

  test.each(readouts)(
    "the %s chart does not report the old range's figures while the new range loads",
    (_name, readout) => {
      const result = readout(oldRangeRefreshing);

      expect(result).toEqual({
        label: "For the last 24 hours. Loading.",
        maybeNotice: NO_NOTICE,
        isLoading: true,
      });
    }
  );

  test.each(readouts)(
    "the %s chart says it could not load when the new range's fetch failed over the old range's data",
    (_name, readout) => {
      const result = readout(oldRangeStale);

      expect(result).toEqual({
        label: "For the last 24 hours. Could not load the chart.",
        maybeNotice: LOAD_FAILED,
        isLoading: false,
      });
    }
  );

  test.each(readouts)(
    "the %s chart keeps describing its own range's data while a refresh runs or fails",
    (_name, readout) => {
      const refreshing: Model = {
        ...withMetrics([]),
        metrics: MetricsAsyncData.Refreshing({ data: TWO_POINTS }),
      };
      const stale: Model = {
        ...withMetrics([]),
        metrics: MetricsAsyncData.Stale({ data: TWO_POINTS, error: "db down" }),
      };

      for (const model of [refreshing, stale]) {
        expect(readout(model).isLoading).toBe(false);
        expect(readout(model).maybeNotice).toEqual(NO_NOTICE);
        expect(readout(model).label).toContain("averages");
      }
    }
  );

  test("data fetched before All time knew its start does not answer the range that now knows it", () => {
    const allTime = Preset({ preset: "allTime" });
    const model: Model = {
      ...withMetrics([]),
      dateRange: allTime,
      maybeEarliestDataMs: Option.some(1_000),
      metrics: MetricsAsyncData.Refreshing({ data: TWO_POINTS }),
      maybeMetricsWindow: Option.some({
        ...METRICS_WINDOW,
        request: { dateRange: allTime, maybeEarliestDataMs: Option.none() },
      }),
    };

    expect(latencyReadout(model).isLoading).toBe(true);
  });

  test("a failed first load says so", () => {
    const model: Model = {
      ...initModel(defaultSettings()),
      dateRange: Preset({ preset: "last24h" }),
      metrics: MetricsAsyncData.Failure({ error: "db down" }),
    };

    expect(latencyReadout(model).maybeNotice).toEqual(LOAD_FAILED);
  });

  test("the speed chart does not report the old range's tests while the new range loads", () => {
    const refreshing: Model = movedToLast24h({
      ...initModel(defaultSettings()),
      speedtestHistory: SpeedtestHistoryAsyncData.Refreshing({
        data: [speed(1, { download_speed: 100, upload_speed: 10 })],
      }),
      maybeSpeedtestWindow: Option.some({
        ...WINDOW,
        request: DEFAULT_REQUEST,
      }),
    });

    expect(speedReadout(refreshing)).toEqual({
      label: "For the last 24 hours. Loading.",
      maybeNotice: NO_NOTICE,
      isLoading: true,
    });
  });

  test("the speed chart says it could not load when the new range's fetch failed", () => {
    const stale: Model = movedToLast24h({
      ...initModel(defaultSettings()),
      speedtestHistory: SpeedtestHistoryAsyncData.Stale({
        data: [speed(1, { download_speed: 100, upload_speed: 10 })],
        error: "db down",
      }),
      maybeSpeedtestWindow: Option.some({
        ...WINDOW,
        request: DEFAULT_REQUEST,
      }),
    });

    expect(speedReadout(stale)).toEqual({
      label: "For the last 24 hours. Could not load the chart.",
      maybeNotice: LOAD_FAILED,
      isLoading: false,
    });
  });
});

describe("latencyReadout in the per-host view", () => {
  const hostPoints = [
    ping(0, { latency_p50: 20 }),
    ping(5, { latency_p50: 40 }),
  ];
  const withHosts = (
    series: ReadonlyArray<{ host: string; metrics: ReadonlyArray<Metric> }>,
    request = DEFAULT_REQUEST
  ) =>
    HostLatencyAsyncData.Success({
      data: { series, window: { ...METRICS_WINDOW, request } },
    });
  const perHost = (
    hostLatency: Model["hostLatency"],
    metrics: Model["metrics"] = MetricsAsyncData.Failure({ error: "db down" })
  ): Model => ({
    ...initModel(defaultSettings()),
    latencyView: "perHost",
    metrics,
    hostLatency,
  });

  test("averages only the buckets that have a latency, leaving an all-lost bucket out", () => {
    const model = perHost(
      withHosts([
        {
          host: "8.8.8.8",
          metrics: [
            ping(0, { latency_p50: 20 }),
            ping(5),
            ping(10, { latency_p50: 40 }),
          ],
        },
      ])
    );

    expect(latencyReadout(model).label).toBe(
      "For the last 30 days. Median latency per host. 8.8.8.8 bucket median averages 30.0 ms and is highest at 40.0 ms."
    );
  });

  test("is decided by the per-host request, not the all-hosts one", () => {
    const model = perHost(
      withHosts([{ host: "8.8.8.8", metrics: hostPoints }])
    );

    expect(latencyReadout(model)).toEqual({
      label:
        "For the last 30 days. Median latency per host. 8.8.8.8 bucket median averages 30.0 ms and is highest at 40.0 ms.",
      maybeNotice: NO_NOTICE,
      isLoading: false,
    });
  });

  test("reads as loading while the per-host fetch is pending, whatever the all-hosts data holds", () => {
    const model = perHost(
      HostLatencyAsyncData.Loading(),
      MetricsAsyncData.Success({ data: TWO_POINTS })
    );

    expect(isPerHostView(model)).toBe(true);
    expect(latencyReadout(model)).toEqual({
      label: "For the last 30 days. Loading.",
      maybeNotice: NO_NOTICE,
      isLoading: true,
    });
  });

  test("a failed per-host fetch says so even though the all-hosts data loaded", () => {
    const model = perHost(
      HostLatencyAsyncData.Failure({ error: "db down" }),
      MetricsAsyncData.Success({ data: TWO_POINTS })
    );

    expect(latencyReadout(model).maybeNotice).toEqual(LOAD_FAILED);
  });

  test("no host having data, and one point being too few, are told apart", () => {
    expect(
      latencyReadout(perHost(withHosts([{ host: "8.8.8.8", metrics: [] }])))
        .maybeNotice
    ).toEqual(Option.some("No data in this range."));
    expect(
      latencyReadout(
        perHost(
          withHosts([
            { host: "8.8.8.8", metrics: [ping(0, { latency_p50: 20 })] },
          ])
        )
      ).maybeNotice
    ).toEqual(Option.some("Not enough data to draw a line."));
  });

  test("series fetched for an older range read as loading, or as failed after a failed refresh", () => {
    const old = [{ host: "8.8.8.8", metrics: hostPoints }];
    const refreshing = movedToLast24h(
      perHost(
        HostLatencyAsyncData.Refreshing({
          data: {
            series: old,
            window: { ...METRICS_WINDOW, request: DEFAULT_REQUEST },
          },
        })
      )
    );
    const stale = movedToLast24h(
      perHost(
        HostLatencyAsyncData.Stale({
          data: {
            series: old,
            window: { ...METRICS_WINDOW, request: DEFAULT_REQUEST },
          },
          error: "db down",
        })
      )
    );

    expect(latencyReadout(refreshing).isLoading).toBe(true);
    expect(latencyReadout(refreshing).label).toBe(
      "For the last 24 hours. Loading."
    );
    expect(latencyReadout(stale).maybeNotice).toEqual(LOAD_FAILED);
  });
});
