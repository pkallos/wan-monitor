const ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

const MIN_INSTANT_MS = Date.parse("0000-01-01T00:00:00Z");
const MAX_INSTANT_MS = Date.parse("9999-12-31T23:59:59.999Z");

/**
 * Whether `value` is an ISO 8601 timestamp with a time and a zone (`Z` or an
 * offset) whose UTC instant falls in years 0000 to 9999, the range QuestDB can
 * convert. `Date.parse` alone rolls an impossible date such as Feb 30 over into
 * the next month, so the calendar date is checked as well.
 */
export const isValidIsoTimestamp = (value: string): boolean => {
  const match = ISO_TIMESTAMP_PATTERN.exec(value);
  if (match === null) {
    return false;
  }
  const instant = Date.parse(value);
  // Negated so a NaN instant, from a field the pattern allows but the parser
  // rejects (minute 99, second 60, offset +99:99), fails the range check.
  if (!(instant >= MIN_INSTANT_MS && instant <= MAX_INSTANT_MS)) {
    return false;
  }
  const [year, month, day] = match.slice(1).map(Number);
  // `Date.UTC` maps years 0 to 99 onto 1900 to 1999; `setUTCFullYear` does not.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};
