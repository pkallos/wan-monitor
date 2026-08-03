export interface CalendarDay {
  readonly dateMs: number;
  readonly inMonth: boolean;
  readonly isToday: boolean;
}

const DAYS_PER_WEEK = 7;

const isSameLocalDay = (aMs: number, bMs: number): boolean => {
  const a = new Date(aMs);
  const b = new Date(bMs);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
};

/**
 * Builds a Sun-Sat month grid in local calendar time, padded with
 * grayed-out days from the surrounding months so every row has 7 days.
 * `month` is 0-indexed and may fall outside 0-11, rolling into the
 * neighbouring year, so callers can ask for `visibleMonth + 1` directly.
 */
export const buildMonthGrid = (
  year: number,
  month: number,
  todayMs: number
): ReadonlyArray<ReadonlyArray<CalendarDay>> => {
  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);
  const normalizedYear = firstOfMonth.getFullYear();
  const normalizedMonth = firstOfMonth.getMonth();

  // Counting days rather than elapsed milliseconds keeps rows exactly 7 wide
  // in zones that skip a whole calendar day at a date-line change.
  const leadingDays = firstOfMonth.getDay();
  const totalDays =
    leadingDays + lastOfMonth.getDate() + (6 - lastOfMonth.getDay());

  const weeks: CalendarDay[][] = [];
  for (let offset = 0; offset < totalDays; offset += DAYS_PER_WEEK) {
    weeks.push(
      Array.from({ length: DAYS_PER_WEEK }, (_, index) => {
        const date = new Date(
          normalizedYear,
          normalizedMonth,
          1 - leadingDays + offset + index
        );
        return {
          dateMs: date.getTime(),
          inMonth:
            date.getMonth() === normalizedMonth &&
            date.getFullYear() === normalizedYear,
          isToday: isSameLocalDay(date.getTime(), todayMs),
        };
      })
    );
  }

  return weeks;
};
