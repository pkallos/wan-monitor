import type { Granularity } from "@shared/api/routes/metrics";
import { Option, Schema as S } from "effect";
import { ts } from "foldkit/schema";

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
  // Fallback for when no earliest datapoint is known yet (or the database
  // has none) - `getPresetRange` prefers `maybeEarliestDataMs` over this.
  allTime: () => 0,
};

/**
 * Pure given `nowMs` explicitly, rather than reading the clock itself, so it
 * stays usable from `update` (which must not call Date.now()) as well as
 * from a Command that reads Clock.currentTimeMillis. `maybeEarliestDataMs`
 * is similarly threaded in rather than queried here, since resolving it
 * requires a database round-trip a pure function can't make; the "allTime"
 * preset starts there instead of the Unix epoch once it's known.
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
  selection._tag === "Preset"
    ? getPresetRange(selection.preset, nowMs, maybeEarliestDataMs)
    : { startTime: selection.startTime, endTime: selection.endTime };

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
export const formatDateRangeLabel = (window: {
  startTime: string;
  endTime: string;
}): string => {
  const start = new Date(window.startTime);
  const end = new Date(window.endTime);
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();

  const startLabel = start.toLocaleDateString(
    [],
    sameYear ? DATE_LABEL_OPTIONS_WITHOUT_YEAR : DATE_LABEL_OPTIONS_WITH_YEAR
  );
  const endLabel = end.toLocaleDateString([], DATE_LABEL_OPTIONS_WITH_YEAR);

  return `${startLabel} - ${endLabel}`;
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

const SPEEDTEST_AGGREGATION_THRESHOLD_MS = 7 * DAY_MS;

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
