import type { Metric } from "@shared/api/routes/metrics";
import type { SpeedMetric } from "@shared/api/routes/speedtest";
import { PACKET_LOSS_THRESHOLDS } from "@wan-monitor/shared";
import { Array as Array_ } from "effect";

// Zero is a valid reading for every metric here (0% packet loss, 0ms-adjacent
// latency), so the guard admits it.
const isFiniteNonNegative = (value: number | undefined): value is number =>
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
      isFiniteNonNegative
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

export const calculatePacketLossStats = (
  data: ReadonlyArray<Pick<Metric, "packet_loss">>
): PacketLossStats =>
  Array_.match(
    Array_.filter(
      Array_.map(data, (d) => d.packet_loss),
      isFiniteNonNegative
    ),
    {
      onEmpty: () => ({ current: "-", avg: "-", max: "-", spikes: 0 }),
      onNonEmpty: (losses) => ({
        current: Array_.lastNonEmpty(losses).toFixed(1),
        avg: average(losses).toFixed(1),
        max: max(losses).toFixed(1),
        // Same threshold and same comparison as the connectivity SQL's
        // degraded floor, so a reading the timeline calls degraded is the one
        // this panel calls a spike.
        spikes: Array_.filter(
          losses,
          (loss) => loss >= PACKET_LOSS_THRESHOLDS.degradedFloor
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
      isFiniteNonNegative
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
