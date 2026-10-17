import type { Metric } from "@shared/api/routes/metrics";
import type { SpeedMetric } from "@shared/api/routes/speedtest";
import { Array as Array_, Option, Order } from "effect";

// Zero is a valid reading for every metric here (0% packet loss, 0ms-adjacent
// latency), so the guard admits it.
const isFiniteNonNegative = (value: number | undefined): value is number =>
  value !== undefined && value >= 0;

const average = (values: Array_.NonEmptyReadonlyArray<number>): number =>
  Array_.reduce(values, 0, (a, b) => a + b) / values.length;

const max = (values: Array_.NonEmptyReadonlyArray<number>): number =>
  Array_.reduce(values, Array_.headNonEmpty(values), (a, b) => Math.max(a, b));

export interface SeriesFigures {
  readonly avg: number;
  readonly peak: number;
}

/** The average and highest value of a plotted series; none when it has no values. */
export const seriesFigures = (
  values: ReadonlyArray<number>
): Option.Option<SeriesFigures> =>
  Array_.match(values, {
    onEmpty: () => Option.none(),
    onNonEmpty: (nonEmpty) =>
      Option.some({ avg: average(nonEmpty), peak: max(nonEmpty) }),
  });

export interface LatencyStats {
  readonly current: string;
  readonly avg: string;
  readonly min: string;
  readonly max: string;
}

type LatencyRow = Pick<Metric, "latency" | "latency_p50">;

/** Whether the rows carry per-bucket percentiles, which makes p50 the line that is plotted. */
export const hasLatencyPercentiles = (
  rows: ReadonlyArray<Pick<Metric, "latency_p50">>
): boolean => Array_.some(rows, ({ latency_p50 }) => latency_p50 !== undefined);

/** The all-hosts latency line as plotted: the p50 of each bucket when there is one, else its latency. */
export const latencyLine = (
  rows: ReadonlyArray<LatencyRow>
): ReadonlyArray<number> => {
  const usesPercentiles = hasLatencyPercentiles(rows);
  return Array_.filter(
    Array_.map(rows, (row) =>
      usesPercentiles ? row.latency_p50 : row.latency
    ),
    isFiniteNonNegative
  );
};

export const calculateLatencyStats = (
  data: ReadonlyArray<LatencyRow>
): LatencyStats =>
  Array_.match(latencyLine(data), {
    onEmpty: () => ({ current: "-", avg: "-", min: "-", max: "-" }),
    onNonEmpty: (latencies) => ({
      current: Array_.lastNonEmpty(latencies).toFixed(1),
      avg: average(latencies).toFixed(1),
      min: Math.min(...latencies).toFixed(1),
      max: max(latencies).toFixed(1),
    }),
  });

export interface SpeedStats {
  readonly avgDownload: string;
  readonly avgUpload: string;
  readonly maxDownload: string;
  readonly maxUpload: string;
}

// A series with no readings has no average, so it reads as "-" on its own
// terms — the download and upload series are summarized independently and one
// having data says nothing about the other.
const summarize = (
  values: ReadonlyArray<number>
): { readonly avg: string; readonly max: string } =>
  Array_.match(values, {
    onEmpty: () => ({ avg: "-", max: "-" }),
    onNonEmpty: (nonEmpty) => ({
      avg: average(nonEmpty).toFixed(1),
      max: max(nonEmpty).toFixed(1),
    }),
  });

export const calculateSpeedStats = (
  data: ReadonlyArray<Pick<SpeedMetric, "download_speed" | "upload_speed">>
): SpeedStats => {
  const downloads = Array_.filter(
    Array_.map(data, (d) => d.download_speed),
    isFiniteNonNegative
  );
  const uploads = Array_.filter(
    Array_.map(data, (d) => d.upload_speed),
    isFiniteNonNegative
  );

  const downloadSummary = summarize(downloads);
  const uploadSummary = summarize(uploads);

  return {
    avgDownload: downloadSummary.avg,
    avgUpload: uploadSummary.avg,
    maxDownload: downloadSummary.max,
    maxUpload: uploadSummary.max,
  };
};

const median = (values: ReadonlyArray<number>): number | null =>
  Array_.match(Array_.sort(values, Order.Number), {
    onEmpty: () => null,
    onNonEmpty: (sorted) => {
      const middle = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 1
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
    },
  });

/** A failed speed test is stored as 0, which is no reading rather than a slow one. */
const isMeasured = (value: number | undefined): value is number =>
  value !== undefined && value > 0;

export const speedMedians = (
  data: ReadonlyArray<Pick<SpeedMetric, "download_speed" | "upload_speed">>
): { readonly download: number | null; readonly upload: number | null } => ({
  download: median(
    Array_.filter(
      Array_.map(data, (d) => d.download_speed),
      isMeasured
    )
  ),
  upload: median(
    Array_.filter(
      Array_.map(data, (d) => d.upload_speed),
      isMeasured
    )
  ),
});

// Tests run hourly by default; a few seconds of drift and the odd slow test
// must not push an hourly cadence over the line.
const DENSE_TESTS_MAX_GAP_MS = 65 * 60 * 1000;

/** Whether tests come about hourly or more often, judged by the typical gap between them. */
export const testsAreDense = (timestampsMs: ReadonlyArray<number>): boolean => {
  const sorted = Array_.sort(timestampsMs, Order.Number);
  const gaps = Array_.zipWith(
    Array_.drop(sorted, 1),
    sorted,
    (later, earlier) => later - earlier
  );
  return Option.exists(
    Option.fromNullishOr(median(gaps)),
    (gap) => gap <= DENSE_TESTS_MAX_GAP_MS
  );
};
