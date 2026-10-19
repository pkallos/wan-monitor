import type {
  ConnectivityStatusPoint,
  LiveConnectivityStatus,
} from "@shared/api/routes/connectivity-status";
import type { Granularity } from "@shared/api/routes/metrics";
import { alignTimestampToMs } from "@shared/timeline";
import { Array as Array_, Option } from "effect";
import { granularityToMs } from "@/dashboard/charts/timeline";
import { formatMonthDay, formatTimeSpan } from "@/dashboard/format";

/** The timeline's gap-filled vocabulary and the live indicator's wire
 *  vocabulary are the same four states, so no translation layer is needed. */
export type ConnectivityStatus = LiveConnectivityStatus;

/**
 * What a ribbon cell can show. Adds one state the wire never carries:
 * `notMonitored`, for cells earlier than the first sample the monitor ever
 * wrote. Both grey states mean "no measurement", but only `noInfo` describes
 * a monitor that had already started and then went quiet.
 */
export type CellStatus = ConnectivityStatus | "notMonitored";

/**
 * Degraded, down and no data carry a pattern as well as a colour. A pattern
 * only draws where a cell is wide enough, so on a dense range (a cell about a
 * pixel wide) the colour carries the status and the incidents log says the rest.
 */
export const CELL_CLASSES: Record<CellStatus, string> = {
  up: "bg-up",
  degraded: "bg-deg pattern-hatch",
  down: "bg-down pattern-strike",
  noInfo: "pattern-nodata",
  notMonitored: "bg-track",
};

export const CELL_LABELS: Record<CellStatus, string> = {
  up: "Up",
  degraded: "Degraded",
  down: "Down",
  noInfo: "No data",
  notMonitored: "Before monitoring started",
};

/** How a bucket's time splits between the three states, as percentages. */
export type CellShares = Readonly<{
  up: number;
  degraded: number;
  down: number;
}>;

export interface Cell {
  readonly startMs: number;
  readonly endMs: number;
  readonly status: CellStatus;
  /** None for a bucket the monitor held no data for. */
  readonly maybeShares: Option.Option<CellShares>;
  /** The bucket the present moment falls in, still filling. */
  readonly isCurrent: boolean;
}

type BucketWindow = Readonly<{
  startTimeMs: number;
  endTimeMs: number;
  granularity: Granularity;
}>;

const firstBucketMs = ({ startTimeMs, granularity }: BucketWindow): number =>
  alignTimestampToMs(startTimeMs, granularity);

/** How many buckets the window holds. */
export const bucketCount = (window: BucketWindow): number =>
  Math.max(
    0,
    Math.ceil(
      (window.endTimeMs - firstBucketMs(window)) /
        granularityToMs(window.granularity)
    )
  );

/** The start of the window's `index`th bucket, matching the cells `buildCells` makes for it. */
export const bucketStartMs = (window: BucketWindow, index: number): number =>
  firstBucketMs(window) + index * granularityToMs(window.granularity);

/** Where the bucket starting at `startMs` sits in the window now; none once it has left it. */
export const bucketIndexOf = (
  window: BucketWindow,
  startMs: number
): Option.Option<number> => {
  const index =
    (startMs - firstBucketMs(window)) / granularityToMs(window.granularity);
  return Number.isInteger(index) && index >= 0 && index < bucketCount(window)
    ? Option.some(index)
    : Option.none();
};

/**
 * One cell per granularity bucket across the window, gaps filled the way the
 * quality charts gap-fill missing metrics. The bucket still filling at the
 * window's end is included.
 *
 * An empty bucket is `notMonitored` when it sits entirely before the earliest
 * sample in the database, and `noInfo` otherwise. The bucket containing the
 * first sample counts as monitored, so the boundary comparison is against the
 * aligned earliest timestamp rather than the raw one.
 */
export const buildCells = (
  points: ReadonlyArray<ConnectivityStatusPoint>,
  startTimeMs: number,
  endTimeMs: number,
  granularity: Granularity,
  maybeEarliestDataMs: Option.Option<number>,
  nowMs: number
): ReadonlyArray<Cell> => {
  const window = { startTimeMs, endTimeMs, granularity };
  const intervalMs = granularityToMs(granularity);
  const firstCellMs = firstBucketMs(window);
  const count = bucketCount(window);
  if (count === 0) return [];

  const pointByCell = new Map(
    Array_.map(
      points,
      (point) =>
        [
          alignTimestampToMs(new Date(point.timestamp).getTime(), granularity),
          point,
        ] as const
    )
  );
  const maybeFirstMonitoredCellMs = Option.map(maybeEarliestDataMs, (ms) =>
    alignTimestampToMs(ms, granularity)
  );
  const emptyStatus = (cellMs: number): CellStatus =>
    Option.exists(maybeFirstMonitoredCellMs, (first) => cellMs < first)
      ? "notMonitored"
      : "noInfo";

  return Array_.makeBy(count, (index) => {
    const cellStartMs = firstCellMs + index * intervalMs;
    const cellEndMs = cellStartMs + intervalMs;
    const maybePoint = Option.fromNullishOr(pointByCell.get(cellStartMs));
    return {
      startMs: cellStartMs,
      endMs: cellEndMs,
      status: Option.match(maybePoint, {
        onNone: () => emptyStatus(cellStartMs),
        onSome: (point) => point.status,
      }),
      maybeShares: Option.map(maybePoint, (point) => ({
        up: point.upPercentage,
        degraded: point.degradedPercentage,
        down: point.downPercentage,
      })),
      isCurrent: cellStartMs <= nowMs && nowMs < cellEndMs,
    };
  });
};

const CURRENT_BUCKET_PHRASES: Record<Granularity, string> = {
  "1m": "this minute",
  "5m": "this 5-minute period",
  "15m": "this 15-minute period",
  "1h": "this hour",
  "6h": "this 6-hour period",
  "1d": "today",
};

/**
 * When a cell covers, as a sentence: "Oct 11, 7 to 8 PM (this hour).". Daily
 * buckets are cut at UTC midnight, so their day is named in UTC too.
 */
export const cellTitle = (cell: Cell, granularity: Granularity): string => {
  const when =
    granularity === "1d"
      ? formatMonthDay(cell.startMs, "UTC")
      : formatTimeSpan(cell.startMs, cell.endMs);
  return `${when}${cell.isCurrent ? ` (${CURRENT_BUCKET_PHRASES[granularity]})` : ""}.`;
};

const shareText = (value: number): string => `${Number(value.toFixed(1))}%`;

/** The states present in a bucket, the first as "97.5% of the time up" and the rest as "2.5% down". */
const shareClauses = ({ up, degraded, down }: CellShares): Array<string> =>
  Array_.map(
    Array_.filter(
      [
        ["up", up],
        ["degraded", degraded],
        ["down", down],
      ] as const,
      ([, share]) => share > 0
    ),
    ([state, share], index) =>
      index === 0
        ? `${shareText(share)} of the time ${state}`
        : `${shareText(share)} ${state}`
  );

/** The status and the share of each state present: "Down: 97.5% of the time up, 2.5% down." */
export const cellBody = (cell: Cell): string => {
  const label = CELL_LABELS[cell.status];
  const clauses = Option.match(cell.maybeShares, {
    onNone: () => [],
    onSome: shareClauses,
  });
  return clauses.length === 0
    ? `${label}.`
    : `${label}: ${clauses.join(", ")}.`;
};
