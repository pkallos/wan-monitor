import { describe, expect, test } from "vitest";
import { buildMonthGrid } from "@/dashboard/calendarGrid";

const localDayMs = (year: number, month: number, day: number): number =>
  new Date(year, month, day).getTime();

describe("buildMonthGrid", () => {
  test("February in a leap year includes leading and trailing days", () => {
    const weeks = buildMonthGrid(2024, 1, localDayMs(2024, 1, 15));

    expect(weeks).toHaveLength(5);
    expect(weeks[0]).toEqual([
      { dateMs: localDayMs(2024, 0, 28), inMonth: false, isToday: false },
      { dateMs: localDayMs(2024, 0, 29), inMonth: false, isToday: false },
      { dateMs: localDayMs(2024, 0, 30), inMonth: false, isToday: false },
      { dateMs: localDayMs(2024, 0, 31), inMonth: false, isToday: false },
      { dateMs: localDayMs(2024, 1, 1), inMonth: true, isToday: false },
      { dateMs: localDayMs(2024, 1, 2), inMonth: true, isToday: false },
      { dateMs: localDayMs(2024, 1, 3), inMonth: true, isToday: false },
    ]);
    expect(weeks[4]).toEqual([
      { dateMs: localDayMs(2024, 1, 25), inMonth: true, isToday: false },
      { dateMs: localDayMs(2024, 1, 26), inMonth: true, isToday: false },
      { dateMs: localDayMs(2024, 1, 27), inMonth: true, isToday: false },
      { dateMs: localDayMs(2024, 1, 28), inMonth: true, isToday: false },
      { dateMs: localDayMs(2024, 1, 29), inMonth: true, isToday: false },
      { dateMs: localDayMs(2024, 2, 1), inMonth: false, isToday: false },
      { dateMs: localDayMs(2024, 2, 2), inMonth: false, isToday: false },
    ]);

    const allDays = weeks.flat();
    expect(allDays).toHaveLength(35);
    expect(allDays.filter((day) => day.inMonth)).toHaveLength(29);
  });

  test("February in a non-leap year has 28 in-month days", () => {
    const weeks = buildMonthGrid(2023, 1, localDayMs(2023, 1, 15));
    const allDays = weeks.flat();

    expect(allDays).toHaveLength(35);
    expect(allDays.filter((day) => day.inMonth)).toHaveLength(28);
    expect(weeks[0][0]).toEqual({
      dateMs: localDayMs(2023, 0, 29),
      inMonth: false,
      isToday: false,
    });
    expect(weeks[4][6]).toEqual({
      dateMs: localDayMs(2023, 2, 4),
      inMonth: false,
      isToday: false,
    });
  });

  test("a month starting on Sunday has no leading days", () => {
    // January 2023 starts on a Sunday.
    const weeks = buildMonthGrid(2023, 0, localDayMs(2023, 0, 15));

    expect(weeks[0][0]).toEqual({
      dateMs: localDayMs(2023, 0, 1),
      inMonth: true,
      isToday: false,
    });
    expect(
      weeks
        .flat()
        .filter((day) => !day.inMonth && day.dateMs < localDayMs(2023, 0, 1))
    ).toHaveLength(0);
  });

  test("a month ending on Saturday has no trailing days", () => {
    // September 2023 ends on a Saturday.
    const weeks = buildMonthGrid(2023, 8, localDayMs(2023, 8, 15));
    const lastWeek = weeks[weeks.length - 1];

    expect(lastWeek[6]).toEqual({
      dateMs: localDayMs(2023, 8, 30),
      inMonth: true,
      isToday: false,
    });
    expect(
      weeks
        .flat()
        .filter((day) => !day.inMonth && day.dateMs > localDayMs(2023, 8, 30))
    ).toHaveLength(0);
  });

  test("every week has exactly 7 days, Sunday through Saturday", () => {
    const weeks = buildMonthGrid(2024, 1, localDayMs(2024, 1, 15));

    for (const week of weeks) {
      expect(week).toHaveLength(7);
      for (const [index, day] of week.entries()) {
        expect(new Date(day.dateMs).getDay()).toBe(index);
      }
    }
  });

  test("flags today, and only today, within the grid", () => {
    const todayMs = localDayMs(2024, 1, 10);
    const weeks = buildMonthGrid(2024, 1, todayMs);
    const allDays = weeks.flat();

    expect(allDays.filter((day) => day.isToday)).toEqual([
      { dateMs: localDayMs(2024, 1, 10), inMonth: true, isToday: true },
    ]);
  });

  test("today outside the visible month is not flagged", () => {
    const todayMs = localDayMs(2024, 5, 1);
    const weeks = buildMonthGrid(2024, 1, todayMs);

    expect(weeks.flat().some((day) => day.isToday)).toBe(false);
  });

  test("isToday matches by calendar day, ignoring time of day", () => {
    const todayMs = new Date(2024, 1, 10, 23, 59, 59, 999).getTime();
    const weeks = buildMonthGrid(2024, 1, todayMs);

    expect(weeks.flat().filter((day) => day.isToday)).toEqual([
      { dateMs: localDayMs(2024, 1, 10), inMonth: true, isToday: true },
    ]);
  });

  test("month indexes outside 0-11 roll into the neighbouring year", () => {
    // The picker renders `visibleMonth` and `visibleMonth + 1` side by side, so
    // December's grid is requested as month 12 of the same year.
    const todayMs = localDayMs(2025, 0, 15);

    expect(buildMonthGrid(2024, 12, todayMs)).toEqual(
      buildMonthGrid(2025, 0, todayMs)
    );
    expect(buildMonthGrid(2025, -1, todayMs)).toEqual(
      buildMonthGrid(2024, 11, todayMs)
    );
  });

  test("every week has seven days even where a time zone skips a calendar day", () => {
    // Pacific/Apia crossed the date line on 2011-12-29, so local 2011-12-30
    // never existed. Row width must stay 7 regardless.
    const original = process.env.TZ;
    process.env.TZ = "Pacific/Apia";

    try {
      const weeks = buildMonthGrid(2011, 11, 0);

      expect(weeks.flat()).toHaveLength(weeks.length * 7);
      for (const week of weeks) {
        expect(week).toHaveLength(7);
      }
    } finally {
      process.env.TZ = original;
    }
  });
});
