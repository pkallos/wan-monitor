import type { Metric } from "@shared/api/routes/metrics";
import type { SpeedMetric } from "@shared/api/routes/speedtest";
import { Array as Array_ } from "effect";

const isPositiveNumber = (value: number | undefined): value is number =>
  value !== undefined && value >= 0;

const average = (values: Array_.NonEmptyReadonlyArray<number>): number =>
  Array_.reduce(values, 0, (a, b) => a + b) / values.length;

const max = (values: Array_.NonEmptyReadonlyArray<number>): number =>
  Array_.reduce(values, Array_.headNonEmpty(values), (a, b) => Math.max(a, b));

export interface LatencyStats {
  readonly current: string;
  readonly avg: string;
  readonly min: string;
  readonly max: string;
}

export const calculateLatencyStats = (
  data: ReadonlyArray<Pick<Metric, "latency">>
): LatencyStats =>
  Array_.match(
    Array_.filter(
      Array_.map(data, (d) => d.latency),
      isPositiveNumber
    ),
    {
      onEmpty: () => ({ current: "-", avg: "-", min: "-", max: "-" }),
      onNonEmpty: (latencies) => ({
        current: Array_.lastNonEmpty(latencies).toFixed(1),
        avg: average(latencies).toFixed(1),
        min: Math.min(...latencies).toFixed(1),
        max: max(latencies).toFixed(1),
      }),
    }
  );

export interface PacketLossStats {
  readonly current: string;
  readonly avg: string;
  readonly max: string;
  readonly spikes: number;
}

const PACKET_LOSS_SPIKE_THRESHOLD = 5;

export const calculatePacketLossStats = (
  data: ReadonlyArray<Pick<Metric, "packet_loss">>
): PacketLossStats =>
  Array_.match(
    Array_.filter(
      Array_.map(data, (d) => d.packet_loss),
      isPositiveNumber
    ),
    {
      onEmpty: () => ({ current: "-", avg: "-", max: "-", spikes: 0 }),
      onNonEmpty: (losses) => ({
        current: Array_.lastNonEmpty(losses).toFixed(1),
        avg: average(losses).toFixed(1),
        max: max(losses).toFixed(1),
        spikes: Array_.filter(
          losses,
          (loss) => loss > PACKET_LOSS_SPIKE_THRESHOLD
        ).length,
      }),
    }
  );

export interface JitterStats {
  readonly current: string;
  readonly avg: string;
  readonly stability: string;
}

export const calculateJitterStats = (
  data: ReadonlyArray<Pick<Metric, "jitter">>
): JitterStats =>
  Array_.match(
    Array_.filter(
      Array_.map(data, (d) => d.jitter),
      isPositiveNumber
    ),
    {
      onEmpty: () => ({ current: "-", avg: "-", stability: "-" }),
      onNonEmpty: (jitters) => {
        const avg = average(jitters);
        // Stability is the inverse of the coefficient of variation: lower
        // variance relative to the average reads as more stable.
        const variance = average(
          Array_.map(jitters, (value) => (value - avg) ** 2)
        );
        const coefficientOfVariation = avg > 0 ? Math.sqrt(variance) / avg : 0;
        const stability = Math.max(
          0,
          Math.min(100, 100 * (1 - coefficientOfVariation))
        );

        return {
          current: Array_.lastNonEmpty(jitters).toFixed(1),
          avg: avg.toFixed(1),
          stability: stability.toFixed(0),
        };
      },
    }
  );

export interface SpeedStats {
  readonly avgDownload: string;
  readonly avgUpload: string;
  readonly maxDownload: string;
  readonly maxUpload: string;
}

const summarize = (
  values: ReadonlyArray<number>
): { readonly avg: string; readonly max: string } =>
  Array_.match(values, {
    onEmpty: () => ({ avg: "0.0", max: "0.0" }),
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
    isPositiveNumber
  );
  const uploads = Array_.filter(
    Array_.map(data, (d) => d.upload_speed),
    isPositiveNumber
  );

  if (downloads.length === 0 && uploads.length === 0) {
    return {
      avgDownload: "-",
      avgUpload: "-",
      maxDownload: "-",
      maxUpload: "-",
    };
  }

  const downloadSummary = summarize(downloads);
  const uploadSummary = summarize(uploads);

  return {
    avgDownload: downloadSummary.avg,
    avgUpload: uploadSummary.avg,
    maxDownload: downloadSummary.max,
    maxUpload: uploadSummary.max,
  };
};
