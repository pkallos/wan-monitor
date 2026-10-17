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

/** A cadence in plain words: "every 30s", "hourly", "every 6h". */
export const everyInterval = (seconds: number): string => {
  if (seconds === MINUTE) return "every minute";
  if (seconds === HOUR) return "hourly";
  if (seconds === DAY) return "daily";
  if (seconds >= HOUR && seconds % HOUR === 0) {
    return `every ${seconds / HOUR}h`;
  }
  if (seconds >= MINUTE && seconds % MINUTE === 0) {
    return `every ${seconds / MINUTE}m`;
  }
  return `every ${seconds}s`;
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
