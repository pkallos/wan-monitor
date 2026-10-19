import type { Outage } from "@wan-monitor/shared";
import type { OutageRun } from "@/infrastructure/database/questdb/model";

/** Maximum number of outages the outage log returns, newest first. */
export const MAX_OUTAGES = 500;

export interface SummarizeOutagesOptions {
  /** Start of the queried range; an outage that began earlier is clipped to it. */
  readonly rangeStartMs: number;
  /** End of the queried range, or the present when that is sooner; an outage still running then is clipped to it. */
  readonly rangeEndMs: number;
}

const summarizeRun = (
  run: OutageRun,
  rangeStartMs: number,
  rangeEndMs: number
): Outage => {
  const startMs = Math.max(Date.parse(run.start_time), rangeStartMs);
  const endMs = Math.min(Date.parse(run.end_time), rangeEndMs);

  return {
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    durationSeconds: (endMs - startMs) / 1000,
    status: run.had_down ? "down" : "degraded",
    affectedHosts: [...run.affected_hosts].sort(),
    maxPacketLoss: run.max_packet_loss ?? 0,
    peakLatency: run.peak_latency,
  };
};

/**
 * Outages, newest first, from the database's runs in ascending time order. The
 * database does the grouping (see `buildQueryOutageRuns`): a run is an
 * unbroken stretch of degraded or down time, and it is `down` when any of its
 * time was down and `degraded` otherwise. A run's own start and end are
 * reported, clipped to the range.
 */
export const summarizeOutages = (
  runs: readonly OutageRun[],
  { rangeStartMs, rangeEndMs }: SummarizeOutagesOptions
): Outage[] =>
  runs.map((run) => summarizeRun(run, rangeStartMs, rangeEndMs)).reverse();
