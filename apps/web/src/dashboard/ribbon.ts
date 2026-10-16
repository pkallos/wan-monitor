import type { Outage } from "@shared/api/routes/connectivity-status";
import type { Granularity } from "@shared/api/routes/metrics";
import { Array as Array_, Option, Order } from "effect";
import type { Cell } from "@/dashboard/connectivity";
import {
  formatClock,
  formatDuration,
  formatMonthDay,
  isSameLocalDay,
  startOfLocalDay,
} from "@/dashboard/format";
import { refLabel } from "@/dashboard/incidents";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const BUCKET_SPANS: Record<Granularity, string> = {
  "1m": "one minute",
  "5m": "5 minutes",
  "15m": "15 minutes",
  "1h": "one hour",
  "6h": "6 hours",
  "1d": "one day",
};

const BUCKET_NOUNS: Record<Granularity, readonly [string, string]> = {
  "1m": ["minute", "minutes"],
  "5m": ["5-minute bucket", "5-minute buckets"],
  "15m": ["15-minute bucket", "15-minute buckets"],
  "1h": ["hour", "hours"],
  "6h": ["6-hour bucket", "6-hour buckets"],
  "1d": ["day", "days"],
};

/** How long one bucket is, as a sentence completes it: "one hour", "5 minutes". */
export const bucketSpan = (granularity: Granularity): string =>
  BUCKET_SPANS[granularity];

export type AxisTick = Readonly<{
  /** Where along the window the tick sits, from 0 (its start) up to 1. */
  fraction: number;
  label: string;
}>;

/** Steps of a month or more tick on local first-of-months, this many months apart. */
const MONTH_TICK_STEPS: ReadonlyArray<
  Readonly<{ stepMs: number; months: number }>
> = [
  { stepMs: 30 * DAY_MS, months: 1 },
  { stepMs: 91 * DAY_MS, months: 3 },
  { stepMs: 182 * DAY_MS, months: 6 },
  { stepMs: 365 * DAY_MS, months: 12 },
];

const LONGEST_TICK_STEP_MS = 365 * DAY_MS;

const TICK_STEPS_MS: ReadonlyArray<number> = [
  15 * MINUTE_MS,
  HOUR_MS,
  3 * HOUR_MS,
  6 * HOUR_MS,
  12 * HOUR_MS,
  DAY_MS,
  2 * DAY_MS,
  3 * DAY_MS,
  7 * DAY_MS,
  14 * DAY_MS,
  ...Array_.map(MONTH_TICK_STEPS, ({ stepMs }) => stepMs),
];

const MAX_TICKS = 8;

/** A window's first day gets a label of its own only when its midnight leaves the room. */
const FIRST_DAY_LABEL_MIN_FRACTION = 0.05;

const addLocalDays = (ms: number, days: number): number => {
  const date = new Date(ms);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days
  ).getTime();
};

const weekdayAndDay = (ms: number): string => {
  const date = new Date(ms);
  return `${date.toLocaleDateString([], { weekday: "short" })} ${date.getDate()}`;
};

const monthsPerStep = (stepMs: number): number | undefined =>
  MONTH_TICK_STEPS.find((step) => step.stepMs === stepMs)?.months;

const tickLabel = (ms: number, stepMs: number, nowMs: number): string => {
  if (stepMs < DAY_MS) {
    return formatClock(ms);
  }
  if (stepMs === DAY_MS) {
    return isSameLocalDay(ms, nowMs) ? "Today" : weekdayAndDay(ms);
  }
  return new Date(ms).toLocaleDateString(
    [],
    monthsPerStep(stepMs) === undefined
      ? { month: "short", day: "numeric" }
      : { month: "short", year: "numeric" }
  );
};

/** Moments at multiples of `stepMs` from local midnight, for steps within a day. */
const clockTicksMs = (
  startMs: number,
  endMs: number,
  stepMs: number
): ReadonlyArray<number> => {
  const midnightMs = startOfLocalDay(startMs);
  const first =
    midnightMs + Math.ceil((startMs - midnightMs) / stepMs) * stepMs;
  return Array_.makeBy(
    Math.max(0, Math.ceil((endMs - first) / stepMs)),
    (index) => first + index * stepMs
  );
};

/** Local midnights every `stepDays`, counted from the first one inside the window. */
const dayTicksMs = (
  startMs: number,
  endMs: number,
  stepDays: number
): ReadonlyArray<number> => {
  const firstMidnightMs =
    startOfLocalDay(startMs) === startMs
      ? startMs
      : addLocalDays(startOfLocalDay(startMs), 1);
  const ticks: Array<number> = [];
  for (
    let tick = firstMidnightMs;
    tick < endMs;
    tick = addLocalDays(tick, stepDays)
  ) {
    ticks.push(tick);
  }
  return ticks;
};

const monthIndexOf = (date: Date): number =>
  date.getFullYear() * 12 + date.getMonth();

const startOfMonthIndex = (monthIndex: number): number =>
  new Date(Math.floor(monthIndex / 12), monthIndex % 12, 1).getTime();

/** Local first-of-months inside the window, `months` apart and counted from January. */
const monthTicksMs = (
  startMs: number,
  endMs: number,
  months: number
): ReadonlyArray<number> => {
  const startMonth = monthIndexOf(new Date(startMs));
  const firstMonth =
    startOfMonthIndex(startMonth) === startMs ? startMonth : startMonth + 1;
  const ticks: Array<number> = [];
  for (
    let monthIndex = Math.ceil(firstMonth / months) * months;
    startOfMonthIndex(monthIndex) < endMs;
    monthIndex += months
  ) {
    ticks.push(startOfMonthIndex(monthIndex));
  }
  return ticks;
};

/** Labels along the window, spaced wide enough to read: hours, days or months by span. */
export const axisTicks = (
  cells: ReadonlyArray<Cell>,
  nowMs: number
): ReadonlyArray<AxisTick> => {
  const first = Array_.head(cells);
  const last = Array_.last(cells);
  if (Option.isNone(first) || Option.isNone(last)) return [];

  const startMs = first.value.startMs;
  const endMs = last.value.endMs;
  const spanMs = endMs - startMs;
  const fittingStepMs = TICK_STEPS_MS.find(
    (step) => Math.ceil(spanMs / step) <= MAX_TICKS
  );
  const stepMs = fittingStepMs ?? LONGEST_TICK_STEP_MS;
  const fractionOf = (ms: number): number => (ms - startMs) / spanMs;

  // Past eight years even a tick a year would crowd the axis, so the step
  // grows by whole years until at most eight ticks remain.
  const months =
    fittingStepMs === undefined
      ? 12 * Math.ceil(spanMs / (LONGEST_TICK_STEP_MS * MAX_TICKS))
      : monthsPerStep(stepMs);
  const tickMs =
    stepMs < DAY_MS
      ? clockTicksMs(startMs, endMs, stepMs)
      : months === undefined
        ? dayTicksMs(startMs, endMs, Math.round(stepMs / DAY_MS))
        : monthTicksMs(startMs, endMs, months);
  const ticks = Array_.map(tickMs, (ms) => ({
    fraction: fractionOf(ms),
    label: tickLabel(ms, stepMs, nowMs),
  }));

  const firstFraction = ticks[0]?.fraction ?? 1;
  const needsFirstDayLabel =
    stepMs === DAY_MS && firstFraction >= FIRST_DAY_LABEL_MIN_FRACTION;
  return needsFirstDayLabel
    ? [{ fraction: 0, label: weekdayAndDay(startMs) }, ...ticks]
    : ticks;
};

const CHIP_MIN_HEIGHT_PX = 22;
const CHIP_HEIGHT_RANGE_PX = 12;
const CHIP_FULL_HEIGHT_SECONDS = 44 * 60;

/** Taller for a longer incident, up to a ceiling, so duration reads at a glance. */
export const chipHeightPx = (durationSeconds: number): number =>
  Math.round(
    CHIP_MIN_HEIGHT_PX +
      CHIP_HEIGHT_RANGE_PX *
        Math.sqrt(
          Math.min(durationSeconds, CHIP_FULL_HEIGHT_SECONDS) /
            CHIP_FULL_HEIGHT_SECONDS
        )
  );

export type IncidentChip = Readonly<{
  outage: Outage;
  ref: string;
  status: Outage["status"];
  cellIndex: number;
  /** The start of that cell's bucket: what a pin keys on, since an index shifts as the window slides. */
  bucketStartMs: number;
  centerFraction: number;
  heightPx: number;
  label: string;
  isOngoing: boolean;
}>;

/**
 * One chip per incident that began inside the cells shown, over the cell it
 * began in. Letters count up from the oldest, as everywhere else.
 */
export const incidentChips = (
  cells: ReadonlyArray<Cell>,
  newestFirst: ReadonlyArray<Outage>,
  maybeOpen: Option.Option<Outage>
): ReadonlyArray<IncidentChip> => {
  const first = Array_.head(cells);
  if (Option.isNone(first)) return [];
  const intervalMs = first.value.endMs - first.value.startMs;

  return Array_.flatMap(newestFirst, (outage, index) => {
    const cellIndex = Math.floor(
      (Date.parse(outage.start) - first.value.startMs) / intervalMs
    );
    if (cellIndex < 0 || cellIndex >= cells.length) return [];
    const isOngoing = Option.exists(maybeOpen, (open) => open === outage);
    return [
      {
        outage,
        ref: refLabel(newestFirst.length - 1 - index),
        status: outage.status,
        cellIndex,
        bucketStartMs: cells[cellIndex].startMs,
        centerFraction: (cellIndex + 0.5) / cells.length,
        heightPx: chipHeightPx(outage.durationSeconds),
        label: isOngoing ? "ongoing" : formatDuration(outage.durationSeconds),
        isOngoing,
      },
    ];
  });
};

export type ChipAnchor = "start" | "center" | "end" | "right";

const EDGE_FRACTION = 0.05;
export const CHIP_OVERHANG_PX = 12;

/**
 * Where a chip sits against its cell. It is centred over the cell, but one near
 * either edge of the card would spill out of it, so it hangs inward instead; a
 * running incident's chip is flush with the right edge.
 */
const chipAnchor = (centerFraction: number, isOngoing: boolean): ChipAnchor =>
  isOngoing
    ? "right"
    : centerFraction > 1 - 3 * EDGE_FRACTION
      ? "end"
      : centerFraction < EDGE_FRACTION
        ? "start"
        : "center";

export type ChipPlacement = Readonly<{
  /** One chip, or the run of close chips a cluster stands in for, oldest first. */
  chips: ReadonlyArray<IncidentChip>;
  lane: 0 | 1;
  centerFraction: number;
  anchor: ChipAnchor;
  /** "ongoing" or a duration for one chip, "F–H" for a cluster. */
  label: string;
  /** The cell that selecting this placement pins: its first incident's. */
  pinIndex: number;
  pinStartMs: number;
  widthPx: number;
}>;

/** The width layout assumes until the browser has reported the ribbon's real one. */
export const DEFAULT_RIBBON_WIDTH_PX = 800;

export const ribbonWidthPx = (maybeMeasuredPx: Option.Option<number>): number =>
  Option.getOrElse(maybeMeasuredPx, () => DEFAULT_RIBBON_WIDTH_PX);

const NOW_LABEL_PX = 34;
const TICK_LABEL_CHAR_PX = 6.2;
const TICK_LABEL_PADDING_PX = 4;

/** The labels that end before the "Now" label begins, so the two never print over each other. */
export const labelsClearOfNow = (
  ticks: ReadonlyArray<AxisTick>,
  ribbonWidth: number
): ReadonlyArray<AxisTick> =>
  Array_.filter(
    ticks,
    ({ fraction, label }) =>
      fraction * ribbonWidth +
        TICK_LABEL_PADDING_PX +
        TICK_LABEL_CHAR_PX * label.length <=
      ribbonWidth - NOW_LABEL_PX
  );

const CHIP_GAP_PX = 6;
const CHIP_CHROME_PX = 21;
const CHIP_CHAR_PX = 7.5;
const CLUSTER_WIDTH_PX = 60;
const LANE_COUNT = 2;

const singleWidthPx = (chip: IncidentChip): number =>
  CHIP_CHROME_PX + (chip.heightPx - 8) + CHIP_CHAR_PX * chip.label.length;

type Draft = Readonly<{
  chips: ReadonlyArray<IncidentChip>;
  centerFraction: number;
  anchor: ChipAnchor;
  widthPx: number;
  left: number;
  right: number;
}>;

const spanPx = (
  anchor: ChipAnchor,
  centerPx: number,
  widthPx: number,
  ribbonWidth: number
): { left: number; right: number } => {
  const left =
    anchor === "right"
      ? ribbonWidth - widthPx
      : anchor === "end"
        ? centerPx - widthPx + CHIP_OVERHANG_PX
        : anchor === "start"
          ? centerPx - CHIP_OVERHANG_PX
          : centerPx - widthPx / 2;
  return { left, right: left + widthPx };
};

const draftOf = (
  chips: ReadonlyArray<IncidentChip>,
  ribbonWidth: number
): Draft => {
  const centerFraction =
    Array_.reduce(chips, 0, (sum, chip) => sum + chip.centerFraction) /
    chips.length;
  const isOngoing = Array_.some(chips, (chip) => chip.isOngoing);
  const anchor = chipAnchor(centerFraction, isOngoing);
  const widthPx =
    chips.length === 1 ? singleWidthPx(chips[0]) : CLUSTER_WIDTH_PX;
  return {
    chips,
    centerFraction,
    anchor,
    widthPx,
    ...spanPx(anchor, centerFraction * ribbonWidth, widthPx, ribbonWidth),
  };
};

const clusterLabel = (chips: ReadonlyArray<IncidentChip>): string =>
  `${chips[0].ref}–${chips[chips.length - 1].ref}`;

const inTimeOrder = (
  chips: ReadonlyArray<IncidentChip>
): ReadonlyArray<IncidentChip> =>
  Array_.sortBy(
    Order.mapInput(Order.Number, (chip: IncidentChip) => chip.cellIndex),
    Order.mapInput(Order.String, (chip: IncidentChip) => chip.ref)
  )(chips);

/**
 * Lays chips out greedily on two lanes, oldest first: a chip goes on the first
 * lane it clears, and one that clears neither is folded, with the chips it
 * covers, into a cluster.
 */
export const layoutChips = (
  chips: ReadonlyArray<IncidentChip>,
  ribbonWidth: number
): ReadonlyArray<ChipPlacement> => {
  const lanes: Array<Array<Draft>> = Array_.makeBy(LANE_COUNT, () => []);
  const clears = (lane: ReadonlyArray<Draft>, draft: Draft): boolean =>
    lane.length === 0 ||
    draft.left >= lane[lane.length - 1].right + CHIP_GAP_PX;

  for (const chip of inTimeOrder(chips)) {
    let draft = draftOf([chip], ribbonWidth);
    const free = lanes.find((lane) => clears(lane, draft));
    if (free !== undefined) {
      free.push(draft);
      continue;
    }
    // A cluster is wider than the chip it grew from, so it can cover earlier
    // chips too; keep folding until nothing overlaps.
    let covered = lanes.find((lane) => !clears(lane, draft));
    while (covered !== undefined) {
      draft = draftOf(
        inTimeOrder([...(covered.pop()?.chips ?? []), ...draft.chips]),
        ribbonWidth
      );
      covered = lanes.find((lane) => !clears(lane, draft));
    }
    (lanes.find((lane) => clears(lane, draft)) ?? lanes[0]).push(draft);
  }

  return Array_.sortBy(
    Order.mapInput(
      Order.Number,
      (placement: ChipPlacement) => placement.pinIndex
    )
  )(
    Array_.flatMap(lanes, (lane, laneIndex) =>
      Array_.map(lane, (draft) => ({
        chips: draft.chips,
        lane: laneIndex === 0 ? (0 as const) : (1 as const),
        centerFraction: draft.centerFraction,
        anchor: draft.anchor,
        label:
          draft.chips.length === 1
            ? draft.chips[0].label
            : clusterLabel(draft.chips),
        pinIndex: draft.chips[0].cellIndex,
        pinStartMs: draft.chips[0].bucketStartMs,
        widthPx: draft.widthPx,
      }))
    )
  );
};

/** Hourly cells over more than a day read best as one row per day. */
export const stacksByDay = (
  cells: ReadonlyArray<Cell>,
  granularity: Granularity
): boolean => granularity === "1h" && cells.length > 24;

export type DaySlot = Option.Option<Readonly<{ cell: Cell; index: number }>>;

export type DayRow = Readonly<{
  label: string;
  slots: ReadonlyArray<DaySlot>;
  refs: ReadonlyArray<string>;
}>;

/**
 * One row per local day the cells touch, newest first. A row has a slot for
 * every bucket that starts in that day, so a daylight saving day has 23 or 25
 * hourly slots; slots the window does not reach are empty.
 */
export const dayRows = (
  cells: ReadonlyArray<Cell>,
  nowMs: number,
  chips: ReadonlyArray<Pick<IncidentChip, "ref" | "cellIndex">>
): ReadonlyArray<DayRow> => {
  const first = Array_.head(cells);
  const last = Array_.last(cells);
  if (Option.isNone(first) || Option.isNone(last)) return [];

  const intervalMs = first.value.endMs - first.value.startMs;
  const slotByStart = new Map(
    Array_.map(cells, (cell, index) => [cell.startMs, { cell, index }])
  );
  const firstBucketAtOrAfter = (ms: number): number =>
    Math.ceil(ms / intervalMs) * intervalMs;
  const lastDayMs = startOfLocalDay(last.value.startMs);
  const dayCount =
    Math.round((lastDayMs - startOfLocalDay(first.value.startMs)) / DAY_MS) + 1;

  return Array_.makeBy(dayCount, (back) => {
    const dayMs = addLocalDays(lastDayMs, -back);
    const firstSlotMs = firstBucketAtOrAfter(dayMs);
    const slotCount =
      (firstBucketAtOrAfter(addLocalDays(dayMs, 1)) - firstSlotMs) / intervalMs;
    return {
      label: isSameLocalDay(dayMs, nowMs) ? "Today" : weekdayAndDay(dayMs),
      slots: Array_.makeBy(
        slotCount,
        (slot): DaySlot =>
          Option.fromNullishOr(slotByStart.get(firstSlotMs + slot * intervalMs))
      ),
      refs: Array_.map(
        Array_.filter(chips, (chip) =>
          isSameLocalDay(cells[chip.cellIndex].startMs, dayMs)
        ),
        (chip) => chip.ref
      ),
    };
  });
};

const MAX_LISTED_BUCKETS = 8;

/** Daily buckets are cut at UTC midnight, so their day is named in UTC; shorter ones read in local time. */
const bucketStartLabel = (cell: Cell, granularity: Granularity): string =>
  granularity === "1d"
    ? formatMonthDay(cell.startMs, "UTC")
    : `${formatMonthDay(cell.startMs)}, ${formatClock(cell.startMs)}`;

const countText = (granularity: Granularity, count: number): string => {
  const [singular, plural] = BUCKET_NOUNS[granularity];
  return `${count} ${count === 1 ? singular : plural}`;
};

/**
 * The ribbon in words, for a screen reader: the window, then which buckets
 * were down or degraded, so the status never rests on colour alone.
 */
export const describeRibbon = (
  cells: ReadonlyArray<Cell>,
  granularity: Granularity
): string => {
  const first = Array_.head(cells);
  const last = Array_.last(cells);
  if (Option.isNone(first) || Option.isNone(last)) return "No status to show.";

  const listOf = (status: Cell["status"], heading: string): Array<string> => {
    const matching = Array_.filter(cells, (cell) => cell.status === status);
    if (matching.length === 0) return [];
    const listed = Array_.map(
      Array_.take(matching, MAX_LISTED_BUCKETS),
      (cell) => bucketStartLabel(cell, granularity)
    ).join("; ");
    const more = matching.length - MAX_LISTED_BUCKETS;
    return [`${heading}: ${listed}${more > 0 ? ` and ${more} more` : ""}.`];
  };
  const countOf = (status: Cell["status"], heading: string): Array<string> => {
    const count = Array_.filter(cells, (cell) => cell.status === status).length;
    return count === 0 ? [] : [`${heading}: ${countText(granularity, count)}.`];
  };

  const hasUp = Array_.some(cells, (cell) => cell.status === "up");
  const hasOthers = Array_.some(cells, (cell) => cell.status !== "up");
  const [, plural] = BUCKET_NOUNS[granularity];
  const end = last.value.isCurrent
    ? "now"
    : bucketStartLabel(
        { ...last.value, startMs: last.value.endMs },
        granularity
      );

  return [
    `Each cell is ${bucketSpan(granularity)}, from ${bucketStartLabel(first.value, granularity)} to ${end}.`,
    ...listOf("down", "Down"),
    ...listOf("degraded", "Degraded"),
    ...countOf("noInfo", "No data"),
    ...countOf("notMonitored", "Before monitoring started"),
    ...(hasUp ? [`All ${hasOthers ? "other " : ""}${plural} up.`] : []),
  ].join(" ");
};

/** The cell a keyboard key moves the selection to; none for a key the ribbon ignores. */
export const segmentForKey = (
  key: string,
  maybeCurrent: Option.Option<number>,
  count: number
): Option.Option<number> => {
  if (count <= 0) return Option.none();
  const last = count - 1;
  switch (key) {
    case "ArrowRight":
      return Option.some(
        Option.match(maybeCurrent, {
          onNone: () => 0,
          onSome: (current) => Math.min(current + 1, last),
        })
      );
    case "ArrowLeft":
      return Option.some(
        Option.match(maybeCurrent, {
          onNone: () => last,
          onSome: (current) => Math.max(current - 1, 0),
        })
      );
    case "Home":
      return Option.some(0);
    case "End":
      return Option.some(last);
    default:
      return Option.none();
  }
};
