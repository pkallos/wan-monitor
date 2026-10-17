import type { Outage } from "@wan-monitor/shared";
import type { OutageRun } from "@/infrastructure/database/questdb/model";

/** Most outages the outage log returns, newest first. */
export const MAX_OUTAGES = 500;

/**
 * How many typical ping cycle periods may separate two non-up cycles before
 * they stop reading as one outage. One missing cycle puts two periods between
 * its neighbours, two missing put three; 2.5 bridges the first and splits the
 * second, with slack for timing jitter in the cycle spacing.
 */
export const OUTAGE_MERGE_GAP_PERIODS = 2.5;

/** The longest time between two non-up cycles that still reads as one outage. */
export const outageMergeGapMs = (periodMs: number): number =>
  periodMs * OUTAGE_MERGE_GAP_PERIODS;

export interface SummarizeOutagesOptions {
  /** Typical time between ping cycles; see `cyclePeriodMs`. */
  readonly periodMs: number;
  /** End of the queried range; an outage still running then is clipped to it. */
  readonly rangeEndMs: number;
}

const summarizeRun = (
  run: OutageRun,
  periodMs: number,
  rangeEndMs: number
): Outage => {
  const startMs = Date.parse(run.start_time);
  const endMs = Math.min(Date.parse(run.last_time) + periodMs, rangeEndMs);

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
 * Outages, newest first, from the database's runs of non-up cycles in
 * ascending time order. The database does the grouping (see
 * `buildQueryOutageRuns`): an up cycle always ends a run, and two non-up
 * cycles with no cycle recorded between them stay in one run when they sit
 * within `outageMergeGapMs` of each other, which bridges one skipped cycle but
 * not two. A run is `down` when any of its cycles was down, otherwise
 * `degraded`.
 *
 * A cycle covers one period, so a run ends one period after its last cycle,
 * clipped to the range end. A run that begins at the first cycle of the range
 * starts there: nothing earlier was observed.
 */
export const summarizeOutages = (
  runs: readonly OutageRun[],
  { periodMs, rangeEndMs }: SummarizeOutagesOptions
): Outage[] =>
  runs.map((run) => summarizeRun(run, periodMs, rangeEndMs)).reverse();
