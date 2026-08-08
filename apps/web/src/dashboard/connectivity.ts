import type {
  ConnectivityStatusPoint,
  LiveConnectivityStatus,
} from "@shared/api/routes/connectivity-status";
import type { Granularity } from "@shared/api/routes/metrics";
import { alignTimestampToMs } from "@shared/timeline";
import { Array as Array_, Option } from "effect";
import { fillTimeline, granularityToMs } from "@/dashboard/charts/timeline";

/** The timeline's gap-filled vocabulary and the live indicator's wire
 *  vocabulary are the same four states, so no translation layer is needed. */
export type ConnectivityStatus = LiveConnectivityStatus;

/**
 * What a timeline slot can show. Adds one state the wire never carries:
 * `notMonitored`, for slots earlier than the first sample the monitor ever
 * wrote. Both grey states mean "no measurement", but only `noInfo` describes
 * a monitor that had already started and then went quiet.
 */
export type SegmentStatus = ConnectivityStatus | "notMonitored";

export const CONNECTIVITY_COLORS: Record<SegmentStatus, string> = {
  up: "#38a169",
  degraded: "#d69e2e",
  down: "#e53e3e",
  noInfo: "#718096",
  notMonitored: "#cbd5e0",
};

export const CONNECTIVITY_LABELS: Record<SegmentStatus, string> = {
  up: "Up",
  degraded: "Degraded",
  down: "Down",
  noInfo: "No Data (monitor offline)",
  notMonitored: "Before monitoring started",
};

export interface Segment {
  readonly timestampMs: number;
  readonly status: SegmentStatus;
  readonly count: number;
}

/**
 * Buckets connectivity points into one segment per granularity slot across the
 * window, filling gaps the same way the quality charts gap-fill missing
 * metrics.
 *
 * An empty slot is `notMonitored` when it sits entirely before the earliest
 * sample in the database, and `noInfo` otherwise. The slot containing the
 * first sample counts as monitored, so the boundary comparison is against the
 * aligned earliest timestamp rather than the raw one.
 */
export const buildSegments = (
  points: ReadonlyArray<ConnectivityStatusPoint>,
  startTimeMs: number,
  endTimeMs: number,
  granularity: Granularity,
  maybeEarliestDataMs: Option.Option<number>
): ReadonlyArray<Segment> => {
  const maybeFirstMonitoredSlotMs = Option.map(
    maybeEarliestDataMs,
    (earliestMs) => alignTimestampToMs(earliestMs, granularity)
  );

  const emptySlotStatus = (slotMs: number): SegmentStatus =>
    Option.match(maybeFirstMonitoredSlotMs, {
      onNone: () => "noInfo" as const,
      onSome: (firstMonitoredSlotMs) =>
        slotMs < firstMonitoredSlotMs
          ? ("notMonitored" as const)
          : ("noInfo" as const),
    });

  return Array_.map(
    fillTimeline(points, startTimeMs, endTimeMs, granularity),
    (slot) => ({
      timestampMs: slot.timestamp,
      status: Option.match(slot.point, {
        onNone: () => emptySlotStatus(slot.timestamp),
        onSome: (point: ConnectivityStatusPoint) => point.status,
      }),
      count: 1,
    })
  );
};

/** Collapses consecutive same-status segments into one so the timeline
 *  renders a handful of wide bars instead of one element per slot. */
export const mergeSegments = (
  segments: ReadonlyArray<Segment>
): ReadonlyArray<Segment> =>
  Array_.match(segments, {
    onEmpty: () => [],
    onNonEmpty: (nonEmpty) => {
      const initial: ReadonlyArray<Segment> = [Array_.headNonEmpty(nonEmpty)];
      return Array_.reduce(
        Array_.drop(nonEmpty, 1),
        initial,
        (merged, segment) => {
          const last = merged[merged.length - 1];
          return last.status === segment.status
            ? [
                ...Array_.dropRight(merged, 1),
                { ...last, count: last.count + segment.count },
              ]
            : [...merged, segment];
        }
      );
    },
  });

/**
 * Coverage at or above this renders as "100.0%", so the shortfall suffix is
 * suppressed rather than claiming a window is partial while displaying a
 * figure that reads as complete.
 */
const FULL_COVERAGE_DISPLAY_FLOOR = 99.95;

/**
 * Headline uptime line for the connectivity timeline.
 *
 * Uptime is conditional on coverage, so the two are always rendered together
 * when coverage falls short: "100% uptime" over four hours of a 24-hour window
 * is a true statement about a small sample, and saying so is the point.
 */
export const formatUptimeSummary = ({
  maybeUptimePercentage,
  coveragePercentage,
}: {
  readonly maybeUptimePercentage: Option.Option<number>;
  readonly coveragePercentage: number;
}): string =>
  Option.match(maybeUptimePercentage, {
    onNone: () => "Uptime: no data for this period",
    onSome: (uptimePercentage) =>
      coveragePercentage >= FULL_COVERAGE_DISPLAY_FLOOR
        ? `Uptime: ${uptimePercentage.toFixed(1)}%`
        : `Uptime: ${uptimePercentage.toFixed(1)}% — over ${coveragePercentage.toFixed(1)}% of the window`,
  });

export const formatSegmentLabel = (
  segment: Segment,
  granularity: Granularity
): string => {
  const start = new Date(segment.timestampMs);
  const label = CONNECTIVITY_LABELS[segment.status];

  if (segment.count === 1) {
    return `${start.toLocaleString()}: ${label}`;
  }

  const end = new Date(
    segment.timestampMs + segment.count * granularityToMs(granularity)
  );
  const startLabel = start.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const endLabel = end.toLocaleString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return `${startLabel} - ${endLabel}: ${label}`;
};
