import type { Metric } from "@shared/api/routes/metrics";
import type { SpeedMetric } from "@shared/api/routes/speedtest";
import { Array as Array_, Option, Order } from "effect";

// Zero is a valid ping reading (0% packet loss), unlike speeds (see `isMeasured`).
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
  readonly avg: number | null;
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

const figureOf = (
  figures: Option.Option<SeriesFigures>,
  pick: (figures: SeriesFigures) => number
): number | null => Option.getOrNull(Option.map(figures, pick));

export const calculateLatencyStats = (
  data: ReadonlyArray<LatencyRow>
): LatencyStats => ({
  avg: figureOf(seriesFigures(latencyLine(data)), ({ avg }) => avg),
});

export interface SpeedStats {
  readonly avgDownload: number | null;
  readonly avgUpload: number | null;
  readonly maxDownload: number | null;
  readonly maxUpload: number | null;
}

type SpeedRow = Pick<SpeedMetric, "download_speed" | "upload_speed">;

/** An absent figure and a stored 0 both mean the test took no reading. */
const isMeasured = (value: number | undefined): value is number =>
  value !== undefined && value > 0;

const measuredSpeeds = (
  data: ReadonlyArray<SpeedRow>,
  pick: (row: SpeedRow) => number | undefined
): ReadonlyArray<number> => Array_.filter(Array_.map(data, pick), isMeasured);

export const calculateSpeedStats = (
  data: ReadonlyArray<SpeedRow>
): SpeedStats => {
  const download = seriesFigures(measuredSpeeds(data, (d) => d.download_speed));
  const upload = seriesFigures(measuredSpeeds(data, (d) => d.upload_speed));

  return {
    avgDownload: figureOf(download, ({ avg }) => avg),
    avgUpload: figureOf(upload, ({ avg }) => avg),
    maxDownload: figureOf(download, ({ peak }) => peak),
    maxUpload: figureOf(upload, ({ peak }) => peak),
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

export const speedMedians = (
  data: ReadonlyArray<SpeedRow>
): { readonly download: number | null; readonly upload: number | null } => ({
  download: median(measuredSpeeds(data, (d) => d.download_speed)),
  upload: median(measuredSpeeds(data, (d) => d.upload_speed)),
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
