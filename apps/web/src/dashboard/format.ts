const MINUTE = 60;
const HOUR = 3600;
const DAY = 86_400;

const joinUnits = (
  major: number,
  majorUnit: string,
  minor: number,
  minorUnit: string
): string =>
  minor === 0
    ? `${major}${majorUnit}`
    : `${major}${majorUnit} ${minor}${minorUnit}`;

/**
 * Renders a span as its two largest units ("18m 30s", "1h 5m"), dropping a
 * zero minor unit so a round span reads "6m" rather than "6m 0s".
 */
export const formatDuration = (seconds: number): string => {
  const whole = Math.max(0, Math.floor(seconds));
  if (whole < MINUTE) return `${whole}s`;
  if (whole < HOUR) {
    return joinUnits(Math.floor(whole / MINUTE), "m", whole % MINUTE, "s");
  }
  if (whole < DAY) {
    return joinUnits(
      Math.floor(whole / HOUR),
      "h",
      Math.floor((whole % HOUR) / MINUTE),
      "m"
    );
  }
  return joinUnits(
    Math.floor(whole / DAY),
    "d",
    Math.floor((whole % DAY) / HOUR),
    "h"
  );
};

/** "1 outage", "2 outages": a count with its noun, pluralised by adding an s. */
export const counted = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

const joinLongUnits = (
  major: number,
  majorUnit: string,
  minor: number,
  minorUnit: string
): string =>
  minor === 0
    ? counted(major, majorUnit)
    : `${counted(major, majorUnit)} ${counted(minor, minorUnit)}`;

/**
 * A span in words, its two largest units: "51 minutes", "1 hour 30 minutes",
 * "2 days 4 hours". A zero minor unit is dropped.
 */
export const formatLongDuration = (seconds: number): string => {
  const exact = Math.max(0, Math.floor(seconds));
  if (exact < MINUTE) return counted(exact, "second");
  // From a minute up, seconds are noise: round to the nearest whole minute.
  const whole = Math.round(exact / MINUTE) * MINUTE;
  if (whole < HOUR) return counted(whole / MINUTE, "minute");
  if (whole < DAY) {
    return joinLongUnits(
      Math.floor(whole / HOUR),
      "hour",
      Math.floor((whole % HOUR) / MINUTE),
      "minute"
    );
  }
  return joinLongUnits(
    Math.floor(whole / DAY),
    "day",
    Math.floor((whole % DAY) / HOUR),
    "hour"
  );
};

/** How long ago, in its largest whole unit: "7 seconds ago", "1 hour ago". */
export const formatDurationAgo = (elapsedMs: number): string => {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (seconds < MINUTE) return `${counted(seconds, "second")} ago`;
  if (seconds < HOUR) {
    return `${counted(Math.floor(seconds / MINUTE), "minute")} ago`;
  }
  if (seconds < DAY) {
    return `${counted(Math.floor(seconds / HOUR), "hour")} ago`;
  }
  return `${counted(Math.floor(seconds / DAY), "day")} ago`;
};

/** A cadence in plain words: "every 30 seconds", "every minute", "every 6 hours". */
export const everyInterval = (seconds: number): string => {
  const [count, unit] =
    seconds >= DAY && seconds % DAY === 0
      ? ([seconds / DAY, "day"] as const)
      : seconds >= HOUR && seconds % HOUR === 0
        ? ([seconds / HOUR, "hour"] as const)
        : seconds >= MINUTE && seconds % MINUTE === 0
          ? ([seconds / MINUTE, "minute"] as const)
          : ([seconds, "second"] as const);
  return count === 1 ? `every ${unit}` : `every ${count} ${unit}s`;
};

/**
 * The time of day with the viewer's own hour cycle, never a forced one: a
 * locale that reads "2:29 PM" reads it that way in every place the dashboard
 * prints a time, and a 24-hour locale reads "14:29" in all of them.
 */
export const CLOCK_FORMAT: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
};

const DATE_TIME_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  ...CLOCK_FORMAT,
};

/** A moment's time of day as "2:29 PM" or "14:29", by the viewer's locale. */
export const formatClock = (
  ms: number,
  locales: Intl.LocalesArgument = []
): string => new Date(ms).toLocaleTimeString(locales, CLOCK_FORMAT);

/** An ISO timestamp as "Oct 15, 2:29 PM" in the viewer's locale and zone. */
export const formatDateTime = (
  iso: string,
  locales: Intl.LocalesArgument = []
): string => new Date(iso).toLocaleString(locales, DATE_TIME_FORMAT);

const MONTH_DAY_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
};

/** A moment's day as "Oct 15"; `timeZone: "UTC"` names the UTC day instead of the viewer's. */
export const formatMonthDay = (
  ms: number,
  timeZone?: "UTC",
  locales: Intl.LocalesArgument = []
): string =>
  new Date(ms).toLocaleDateString(locales, { ...MONTH_DAY_FORMAT, timeZone });

const HOUR_ONLY_FORMAT: Intl.DateTimeFormatOptions = { hour: "numeric" };

const isOnTheHour = (ms: number): boolean => {
  const date = new Date(ms);
  return date.getMinutes() === 0 && date.getSeconds() === 0;
};

const timeParts = (
  ms: number,
  options: Intl.DateTimeFormatOptions,
  locales: Intl.LocalesArgument
): Array<Intl.DateTimeFormatPart> =>
  new Intl.DateTimeFormat(locales, options).formatToParts(ms);

// formatToParts keeps the narrow no-break space ICU puts before AM or PM,
// where format() gives a plain space; the parts read the same as the clock.
const partsText = (parts: ReadonlyArray<Intl.DateTimeFormatPart>): string =>
  parts
    .map(({ value }) => value)
    .join("")
    .replace(/\u202f/g, " ");

/**
 * The start's parts without a day period it shares with the end, so "7 PM to
 * 8 PM" reads "7 to 8 PM". Only a day period that follows the hour is dropped,
 * with the literal before it; a locale that puts it first keeps both.
 */
const sharingDayPeriod = (
  start: ReadonlyArray<Intl.DateTimeFormatPart>,
  end: ReadonlyArray<Intl.DateTimeFormatPart>
): ReadonlyArray<Intl.DateTimeFormatPart> => {
  const periodIndex = start.findIndex(({ type }) => type === "dayPeriod");
  const hourIndex = start.findIndex(({ type }) => type === "hour");
  const isShared =
    periodIndex > hourIndex &&
    end.some(
      ({ type, value }) =>
        type === "dayPeriod" && value === start[periodIndex].value
    );
  if (!isShared) return start;
  const isLiteralBefore = start[periodIndex - 1]?.type === "literal";
  return start.filter(
    (_, index) =>
      index !== periodIndex && !(isLiteralBefore && index === periodIndex - 1)
  );
};

/**
 * A span of one day or less as the viewer's clock reads it: "Oct 11, 7 to 8
 * PM", the hour alone when both ends fall on the hour, and each end's own day
 * when the span runs past midnight (a span that ends at midnight does not).
 */
export const formatTimeSpan = (
  startMs: number,
  endMs: number,
  locales: Intl.LocalesArgument = []
): string => {
  const options =
    isOnTheHour(startMs) && isOnTheHour(endMs)
      ? HOUR_ONLY_FORMAT
      : CLOCK_FORMAT;
  const start = timeParts(startMs, options, locales);
  const end = timeParts(endMs, options, locales);
  if (!isSameLocalDay(startMs, endMs - 1)) {
    return `${formatMonthDay(startMs, undefined, locales)}, ${partsText(start)} to ${formatMonthDay(endMs, undefined, locales)}, ${partsText(end)}`;
  }
  return `${formatMonthDay(startMs, undefined, locales)}, ${partsText(sharingDayPeriod(start, end))} to ${partsText(end)}`;
};

/** Whether two instants fall on the same calendar day in the viewer's time zone. */
export const isSameLocalDay = (aMs: number, bMs: number): boolean => {
  const a = new Date(aMs);
  const b = new Date(bMs);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
};

/** Midnight at the start of the local day `ms` falls in. */
export const startOfLocalDay = (ms: number): number => {
  const date = new Date(ms);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  ).getTime();
};

/** A figure to `decimals` places with an optional unit suffix, or "-" with no reading. */
export const fixed = (
  value: number | null,
  decimals: number,
  suffix = ""
): string => (value === null ? "-" : `${value.toFixed(decimals)}${suffix}`);
