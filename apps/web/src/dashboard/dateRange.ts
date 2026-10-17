import type { Granularity } from "@shared/api/routes/metrics";
import { Match as M, Option, Schema as S } from "effect";
import { taggedStruct as ts } from "foldkit/schema";
import {
  CLOCK_FORMAT,
  DATE_TIME_FORMAT,
  isLocalMidnight,
  isSameLocalDay,
} from "@/dashboard/format";

export const PresetKey = S.Literals([
  "last1h",
  "last24h",
  "last7d",
  "last30d",
  "mtd",
  "qtd",
  "ytd",
  "last12m",
  "allTime",
]);
export type PresetKey = typeof PresetKey.Type;

export const PRESET_LABELS: Record<PresetKey, string> = {
  last1h: "Last hour",
  last24h: "Last 24 hours",
  last7d: "Last 7 days",
  last30d: "Last 30 days",
  mtd: "Month to date",
  qtd: "Quarter to date",
  ytd: "Year to date",
  last12m: "Last 12 months",
  allTime: "All time",
};

export const PRESET_ORDER: ReadonlyArray<PresetKey> = [
  "last1h",
  "last24h",
  "last7d",
  "last30d",
  "mtd",
  "qtd",
  "ytd",
  "last12m",
  "allTime",
];

export const Preset = ts("Preset", { preset: PresetKey });
export type Preset = typeof Preset.Type;

export const Custom = ts("Custom", {
  startTime: S.String,
  endTime: S.String,
});
export type Custom = typeof Custom.Type;

export const DateRangeSelection = S.Union([Preset, Custom]);
export type DateRangeSelection = typeof DateRangeSelection.Type;

export const sameDateRange = S.toEquivalence(DateRangeSelection);

export const isAllTime = (selection: DateRangeSelection): boolean =>
  M.value(selection).pipe(
    M.tag("Preset", ({ preset }) => preset === "allTime"),
    M.orElse(() => false)
  );

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const PRESET_START_MS: Record<PresetKey, (nowMs: number) => number> = {
  last1h: (nowMs) => nowMs - HOUR_MS,
  last24h: (nowMs) => nowMs - DAY_MS,
  last7d: (nowMs) => nowMs - 7 * DAY_MS,
  last30d: (nowMs) => nowMs - 30 * DAY_MS,
  mtd: (nowMs) => {
    const now = new Date(nowMs);
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  },
  qtd: (nowMs) => {
    const now = new Date(nowMs);
    const quarterStartMonth = Math.floor(now.getUTCMonth() / 3) * 3;
    return Date.UTC(now.getUTCFullYear(), quarterStartMonth, 1);
  },
  ytd: (nowMs) => {
    const now = new Date(nowMs);
    return Date.UTC(now.getUTCFullYear(), 0, 1);
  },
  last12m: (nowMs) => {
    const now = new Date(nowMs);
    return Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() - 12,
      now.getUTCDate(),
      now.getUTCHours(),
      now.getUTCMinutes(),
      now.getUTCSeconds(),
      now.getUTCMilliseconds()
    );
  },
  // Fallback for when the earliest datapoint is unknown or the database has
  // none; `getPresetRange` prefers `maybeEarliestDataMs` over this. The epoch
  // would make a window of tens of thousands of buckets.
  allTime: (nowMs) => nowMs - 30 * DAY_MS,
};

/**
 * Pure given `nowMs` explicitly, rather than reading the clock itself, so it
 * stays usable from `update` (which must not call Date.now()) as well as
 * from a Command that reads Clock.currentTimeMillis. `maybeEarliestDataMs`
 * is similarly threaded in rather than queried here, since resolving it
 * requires a database round-trip a pure function can't make; the "allTime"
 * preset starts there once it's known, and at the last 30 days until then.
 */
export const getPresetRange = (
  preset: PresetKey,
  nowMs: number,
  maybeEarliestDataMs: Option.Option<number> = Option.none()
): { startTime: string; endTime: string } => ({
  startTime: new Date(
    preset === "allTime"
      ? Option.getOrElse(maybeEarliestDataMs, () =>
          PRESET_START_MS.allTime(nowMs)
        )
      : PRESET_START_MS[preset](nowMs)
  ).toISOString(),
  endTime: new Date(nowMs).toISOString(),
});

export const getDateRangeWindow = (
  selection: DateRangeSelection,
  nowMs: number,
  maybeEarliestDataMs: Option.Option<number> = Option.none()
): { startTime: string; endTime: string } =>
  M.value(selection).pipe(
    M.tag("Preset", ({ preset }) =>
      getPresetRange(preset, nowMs, maybeEarliestDataMs)
    ),
    M.tag("Custom", ({ startTime, endTime }) => ({ startTime, endTime })),
    M.exhaustive
  );

const DATE_LABEL_OPTIONS_WITH_YEAR: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
};
const DATE_LABEL_OPTIONS_WITHOUT_YEAR: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
};

/**
 * Formats in UTC (not the viewer's local time zone) so the label always
 * matches the UTC day boundaries the presets above resolve against.
 */
export const formatDateRangeLabel = (
  window: { startTime: string; endTime: string },
  separator = " - "
): string => {
  const start = new Date(window.startTime);
  const end = new Date(window.endTime);
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();

  const startLabel = start.toLocaleDateString(
    [],
    sameYear ? DATE_LABEL_OPTIONS_WITHOUT_YEAR : DATE_LABEL_OPTIONS_WITH_YEAR
  );
  const endLabel = end.toLocaleDateString([], DATE_LABEL_OPTIONS_WITH_YEAR);

  return `${startLabel}${separator}${endLabel}`;
};

// The date picker ends a range on the last millisecond of a local day.
const isWholeLocalDays = (start: Date, end: Date): boolean =>
  isLocalMidnight(start) &&
  (isLocalMidnight(end) || isLocalMidnight(new Date(end.getTime() + 1)));

const isCalendarRange = (start: Date, end: Date): boolean =>
  end.getTime() - start.getTime() >= DAY_MS && isWholeLocalDays(start, end);

/**
 * The start and end times of a span brushed on a chart, in local time and the
 * locale's hour cycle to match the chart axes, the end dropping its date when
 * it falls on the start's day. `use12Hour` overrides the locale's hour cycle.
 */
const brushedRangeTimes = (
  start: Date,
  end: Date,
  use12Hour?: boolean
): readonly [string, string] => {
  const withHourCycle = (
    options: Intl.DateTimeFormatOptions
  ): Intl.DateTimeFormatOptions =>
    use12Hour === undefined ? options : { ...options, hour12: use12Hour };
  return [
    start.toLocaleString([], withHourCycle(DATE_TIME_FORMAT)),
    isSameLocalDay(start.getTime(), end.getTime())
      ? end.toLocaleTimeString([], withHourCycle(CLOCK_FORMAT))
      : end.toLocaleString([], withHourCycle(DATE_TIME_FORMAT)),
  ];
};

/**
 * A custom range as the viewer reads it: whole dates for days picked from the
 * calendar, otherwise, as for a span brushed on a chart, its start and end
 * times. Those are in local time and the locale's hour cycle to match the
 * chart axes, unlike the UTC dates above. `use12Hour` overrides the locale's
 * hour cycle.
 */
export const formatCustomRangeLabel = (
  custom: Custom,
  use12Hour?: boolean
): string => {
  const start = new Date(custom.startTime);
  const end = new Date(custom.endTime);
  if (isCalendarRange(start, end)) return formatDateRangeLabel(custom);
  return brushedRangeTimes(start, end, use12Hour).join("–");
};

/** The same range worded to sit mid-sentence: "Oct 4 to Oct 10, 2026" or "Oct 16, 5:00 PM to 5:30 PM". */
export const describeCustomRange = (custom: Custom): string => {
  const start = new Date(custom.startTime);
  const end = new Date(custom.endTime);
  return isCalendarRange(start, end)
    ? formatDateRangeLabel(custom, " to ")
    : brushedRangeTimes(start, end).join(" to ");
};

const GRANULARITY_THRESHOLDS_MS: ReadonlyArray<readonly [number, Granularity]> =
  [
    [6 * 60 * 60 * 1000, "1m"],
    [DAY_MS, "5m"],
    [3 * DAY_MS, "15m"],
    [30 * DAY_MS, "1h"],
    [90 * DAY_MS, "6h"],
  ];

export const granularityForRange = (window: {
  startTime: string;
  endTime: string;
}): Granularity => {
  const spanMs = Date.parse(window.endTime) - Date.parse(window.startTime);
  const match = GRANULARITY_THRESHOLDS_MS.find(
    ([thresholdMs]) => spanMs <= thresholdMs
  );
  return match ? match[1] : "1d";
};

export const SPEEDTEST_AGGREGATION_THRESHOLD_MS = 7 * DAY_MS;

/**
 * Speedtest samples are sparse enough that raw rows stay readable up to a
 * week; below that threshold this returns undefined so the fetch requests
 * raw rows, matching a range at or above it to the same bucket size
 * `granularityForRange` would pick for a ping-based chart over that span.
 */
export const granularityForSpeedtestRange = (window: {
  startTime: string;
  endTime: string;
}): Granularity | undefined => {
  const spanMs = Date.parse(window.endTime) - Date.parse(window.startTime);
  return spanMs < SPEEDTEST_AGGREGATION_THRESHOLD_MS
    ? undefined
    : granularityForRange(window);
};

/** The bucket size the speed history was fetched in for a resolved window; none when it came as raw tests. */
export const speedtestBucketOf = ({
  startTimeMs,
  endTimeMs,
}: {
  startTimeMs: number;
  endTimeMs: number;
}): Option.Option<Granularity> =>
  Option.fromNullishOr(
    granularityForSpeedtestRange({
      startTime: new Date(startTimeMs).toISOString(),
      endTime: new Date(endTimeMs).toISOString(),
    })
  );

const MIN_BRUSH_SPAN_MS = 5 * 60_000;
const SECOND_MS = 1000;

/**
 * The custom range a drag across a chart selects, or none when the drag is too
 * short to chart: under five minutes is only a few of the finest buckets, too
 * few to draw a line across. The ends are rounded to whole seconds so the
 * range reads and reloads cleanly.
 */
export const rangeFromBrush = (
  fromMs: number,
  toMs: number
): Option.Option<Custom> => {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return Option.none();
  const startMs = Math.round(Math.min(fromMs, toMs) / SECOND_MS) * SECOND_MS;
  const endMs = Math.round(Math.max(fromMs, toMs) / SECOND_MS) * SECOND_MS;
  return endMs - startMs < MIN_BRUSH_SPAN_MS
    ? Option.none()
    : Option.some(
        Custom({
          startTime: new Date(startMs).toISOString(),
          endTime: new Date(endMs).toISOString(),
        })
      );
};
