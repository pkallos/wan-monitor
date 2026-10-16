import type { Metric } from "@shared/api/routes/metrics";
import { Array as Array_, Option } from "effect";
import { AsyncData } from "foldkit";
import { hostLatencyOf } from "@/dashboard/charts/options";
import {
  calculateSpeedStats,
  hasLatencyPercentiles,
  latencyLine,
  type SeriesFigures,
  seriesFigures,
} from "@/dashboard/charts/stats";
import type { Model } from "@/dashboard/model";
import { describeRange } from "@/dashboard/overview";
import {
  hostLatencyFor,
  metricsFor,
  speedtestHistoryFor,
} from "@/dashboard/view/derived";

/**
 * What a chart shows, in words: the name its canvas is announced by, a line
 * drawn over the plot when there is nothing to plot, and whether the plot is
 * still waiting on data for the selected range.
 */
export type ChartReadout = Readonly<{
  label: string;
  maybeNotice: Option.Option<string>;
  isLoading: boolean;
}>;

const NO_DATA = "No data in this range.";
const TOO_FEW_FOR_LINE = "Not enough data to draw a line.";
const TOO_FEW_FOR_BARS = "Not enough data to draw a chart.";
const LOAD_FAILED = "Could not load the chart.";

// The chart's group already carries its name, so the image inside names only
// the range and what is plotted.
const labelled = (model: Model, text: string): string =>
  `For ${describeRange(model.dateRange)}. ${text}`;

const described = (model: Model, text: string): ChartReadout => ({
  label: labelled(model, text),
  maybeNotice: Option.none(),
  isLoading: false,
});

const noticed = (model: Model, notice: string): ChartReadout => ({
  label: labelled(model, notice),
  maybeNotice: Option.some(notice),
  isLoading: false,
});

const loading = (model: Model): ChartReadout => ({
  ...described(model, "Loading."),
  isLoading: true,
});

const present = (
  values: ReadonlyArray<number | null | undefined>
): ReadonlyArray<number> =>
  Array_.filter(values, (value) => value !== null && value !== undefined);

const oneDecimal = (value: number): string => value.toFixed(1);
const ms = (value: number): string => `${oneDecimal(value)} ms`;
const twoDecimals = (value: number): string => value.toFixed(2);

// The figures are taken over the plotted buckets, so the subject says so: the
// stat rail reports the range's own average, which weights every ping cycle.
const bucketFigures = (
  subject: string,
  { avg, peak }: SeriesFigures,
  format: (value: number) => string
): string =>
  `${subject} averages ${format(avg)} and is highest at ${format(peak)}.`;

const allHostsLatency = (
  model: Model,
  metrics: ReadonlyArray<Metric>
): ChartReadout => {
  const usesPercentiles = hasLatencyPercentiles(metrics);
  const line = latencyLine(metrics);
  return Option.match(seriesFigures(line), {
    onNone: () => noticed(model, NO_DATA),
    onSome: (figures) => {
      if (line.length === 1) {
        return noticed(model, TOO_FEW_FOR_LINE);
      }
      if (!usesPercentiles) {
        return described(model, bucketFigures("Bucket latency", figures, ms));
      }
      const band = Option.match(
        seriesFigures(present(Array_.map(metrics, (m) => m.latency_p95))),
        {
          onNone: () => "",
          onSome: ({ peak }) =>
            ` and the highest 95th percentile is ${ms(peak)}`,
        }
      );
      return described(
        model,
        `Bucket median latency averages ${ms(figures.avg)}${band}.`
      );
    },
  });
};

const perHostLatency = (
  model: Model,
  series: ReadonlyArray<{ host: string; metrics: ReadonlyArray<Metric> }>
): ChartReadout => {
  const lines = Array_.map(series, ({ host, metrics }) => ({
    host,
    values: present(Array_.map(metrics, hostLatencyOf)),
  }));
  const longest = Math.max(0, ...lines.map(({ values }) => values.length));
  if (longest === 0) return noticed(model, NO_DATA);
  if (longest === 1) return noticed(model, TOO_FEW_FOR_LINE);
  return described(
    model,
    [
      "Median latency per host.",
      ...Array_.map(lines, ({ host, values }) =>
        Option.match(seriesFigures(values), {
          onNone: () => `${host} has no data.`,
          onSome: (figures) =>
            bucketFigures(`${host} bucket median`, figures, ms),
        })
      ),
    ].join(" ")
  );
};

/**
 * Whether the latency chart is in the per-host view: chosen, and its fetch
 * asked for. The chart is covered as loading until the series answer the
 * selected range, and only then draws them; with no hosts to ask about, the
 * all-hosts lines stand in.
 */
export const isPerHostView = (model: Model): boolean =>
  model.latencyView === "perHost" && !AsyncData.isIdle(model.hostLatency);

export const latencyReadout = (model: Model): ChartReadout =>
  isPerHostView(model)
    ? AsyncData.matchData(hostLatencyFor(model), {
        onEmpty: () => loading(model),
        onFailure: () => noticed(model, LOAD_FAILED),
        onData: ({ series }) => perHostLatency(model, series),
      })
    : AsyncData.matchData(metricsFor(model), {
        onEmpty: () => loading(model),
        onFailure: () => noticed(model, LOAD_FAILED),
        onData: (metrics) => allHostsLatency(model, metrics),
      });

const timelineReadout = (
  model: Model,
  {
    subject,
    tooFew,
    pick,
    format,
  }: {
    subject: string;
    tooFew: string;
    pick: (metric: Metric) => number | undefined;
    format: (value: number) => string;
  }
): ChartReadout =>
  AsyncData.matchData(metricsFor(model), {
    onEmpty: () => loading(model),
    onFailure: () => noticed(model, LOAD_FAILED),
    onData: (metrics) => {
      const values = present(Array_.map(metrics, pick));
      return Option.match(seriesFigures(values), {
        onNone: () => noticed(model, NO_DATA),
        onSome: (figures) =>
          values.length === 1
            ? noticed(model, tooFew)
            : described(model, bucketFigures(subject, figures, format)),
      });
    },
  });

export const packetLossReadout = (model: Model): ChartReadout =>
  timelineReadout(model, {
    subject: "Bucket packet loss",
    tooFew: TOO_FEW_FOR_BARS,
    pick: (metric) => metric.packet_loss,
    format: (value) => `${twoDecimals(value)}%`,
  });

export const jitterReadout = (model: Model): ChartReadout =>
  timelineReadout(model, {
    subject: "Bucket jitter",
    tooFew: TOO_FEW_FOR_LINE,
    pick: (metric) => metric.jitter,
    format: (value) => `${twoDecimals(value)} ms`,
  });

const speedDirection = (name: string, avg: string, peak: string): string =>
  avg === "-"
    ? `${name} has no data.`
    : `${name} averages ${avg} Mbps and peaks at ${peak} Mbps.`;

// A single test is a point on a scatter plot, so unlike the line charts there
// is no minimum short of one.
export const speedReadout = (model: Model): ChartReadout =>
  AsyncData.matchData(speedtestHistoryFor(model), {
    onEmpty: () => loading(model),
    onFailure: () => noticed(model, LOAD_FAILED),
    onData: (history) => {
      const stats = calculateSpeedStats(history);
      return stats.avgDownload === "-" && stats.avgUpload === "-"
        ? noticed(model, NO_DATA)
        : described(
            model,
            [
              speedDirection("Download", stats.avgDownload, stats.maxDownload),
              speedDirection("Upload", stats.avgUpload, stats.maxUpload),
            ].join(" ")
          );
    },
  });
