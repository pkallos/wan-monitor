import type {
  ConnectivityStatusPoint,
  LiveConnectivityStatus,
} from "@shared/api/routes/connectivity-status";
import type { Granularity } from "@shared/api/routes/metrics";
import { Array as Array_, Option } from "effect";
import { fillTimeline, granularityToMs } from "@/dashboard/charts/timeline";

/** The timeline's gap-filled vocabulary and the live indicator's wire
 *  vocabulary are the same four states, so no translation layer is needed. */
export type ConnectivityStatus = LiveConnectivityStatus;

export const CONNECTIVITY_COLORS: Record<ConnectivityStatus, string> = {
  up: "#38a169",
  degraded: "#d69e2e",
  down: "#e53e3e",
  noInfo: "#718096",
};

export const CONNECTIVITY_LABELS: Record<ConnectivityStatus, string> = {
  up: "Up",
  degraded: "Degraded",
  down: "Down",
  noInfo: "No Data",
};

export interface Segment {
  readonly timestampMs: number;
  readonly status: ConnectivityStatus;
  readonly count: number;
}

/** Buckets connectivity points into one segment per granularity slot across
 *  the window, filling gaps with `noInfo` the same way the quality charts
 *  gap-fill missing metrics. */
export const buildSegments = (
  points: ReadonlyArray<ConnectivityStatusPoint>,
  startTimeMs: number,
  endTimeMs: number,
  granularity: Granularity
): ReadonlyArray<Segment> =>
  Array_.map(
    fillTimeline(points, startTimeMs, endTimeMs, granularity),
    (slot) => ({
      timestampMs: slot.timestamp,
      status: Option.match(slot.point, {
        onNone: () => "noInfo" as const,
        onSome: (point: ConnectivityStatusPoint) => point.status,
      }),
      count: 1,
    })
  );

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
