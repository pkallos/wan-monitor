import { describe, expect, test } from "vitest";
import {
  everyInterval,
  formatClock,
  formatDateTime,
  formatDuration,
  isLocalMidnight,
  isSameLocalDay,
} from "@/dashboard/format";
import { withTimeZone } from "@/dashboard/testFixtures";

describe("formatDuration", () => {
  test.each([
    [0, "0s"],
    [45, "45s"],
    [60, "1m"],
    [390, "6m 30s"],
    [1110, "18m 30s"],
    [3600, "1h"],
    [3660, "1h 1m"],
    [5400, "1h 30m"],
    [86_400, "1d"],
    [90_000, "1d 1h"],
  ])("renders %is as %s", (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  test("drops sub-second remainders rather than rounding up", () => {
    expect(formatDuration(59.9)).toBe("59s");
  });

  test("clamps a negative span to zero", () => {
    expect(formatDuration(-5)).toBe("0s");
  });
});

describe("everyInterval", () => {
  test.each([
    [30, "every 30s"],
    [60, "every minute"],
    [300, "every 5m"],
    [3600, "hourly"],
    [21_600, "every 6h"],
    [86_400, "daily"],
    [90, "every 90s"],
  ])("renders a %is interval as %s", (seconds, expected) => {
    expect(everyInterval(seconds)).toBe(expected);
  });
});

describe("formatDateTime", () => {
  test("shows the month, day and time of day in the viewer's zone", () => {
    const moment = new Date(2026, 9, 15, 14, 29);

    expect(formatDateTime(moment.toISOString())).toBe(
      moment.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    );
  });
});

describe("isSameLocalDay", () => {
  test("is true for two moments of one local day, however far apart", () => {
    expect(
      isSameLocalDay(
        new Date(2026, 9, 15, 0, 0).getTime(),
        new Date(2026, 9, 15, 23, 59).getTime()
      )
    ).toBe(true);
  });

  test("is false across local midnight, even a minute apart", () => {
    expect(
      isSameLocalDay(
        new Date(2026, 9, 15, 23, 59).getTime(),
        new Date(2026, 9, 16, 0, 0).getTime()
      )
    ).toBe(false);
  });

  test("tells the same day of another month and year apart", () => {
    const day = new Date(2026, 9, 15).getTime();

    expect(isSameLocalDay(day, new Date(2026, 8, 15).getTime())).toBe(false);
    expect(isSameLocalDay(day, new Date(2025, 9, 15).getTime())).toBe(false);
  });
});

describe("isLocalMidnight", () => {
  test("is true for exactly midnight", () => {
    expect(isLocalMidnight(new Date(2026, 0, 5, 0, 0, 0, 0))).toBe(true);
  });

  test.each([
    ["an hour", new Date(2026, 0, 5, 1, 0, 0, 0)],
    ["a minute", new Date(2026, 0, 5, 0, 1, 0, 0)],
    ["a second", new Date(2026, 0, 5, 0, 0, 1, 0)],
    ["a millisecond", new Date(2026, 0, 5, 0, 0, 0, 1)],
  ])("is false %s past midnight", (_, date) => {
    expect(isLocalMidnight(date)).toBe(false);
  });
});

describe("one clock policy", () => {
  const AFTERNOON_UTC = Date.parse("2026-10-15T14:29:00.000Z");

  test("prints a time of day in a 12-hour locale with its AM or PM, in the clock and the date alike", () => {
    withTimeZone("UTC", () => {
      expect(formatClock(AFTERNOON_UTC, "en-US")).toBe("2:29 PM");
      expect(formatDateTime("2026-10-15T14:29:00.000Z", "en-US")).toBe(
        "Oct 15, 2:29 PM"
      );
    });
  });

  test("prints it on the 24-hour clock in a 24-hour locale, in the clock and the date alike", () => {
    withTimeZone("UTC", () => {
      expect(formatClock(AFTERNOON_UTC, "de-DE")).toBe("14:29");
      expect(formatDateTime("2026-10-15T14:29:00.000Z", "de-DE")).toContain(
        "14:29"
      );
    });
  });

  test("reads the viewer's own locale when none is given", () => {
    expect(formatClock(AFTERNOON_UTC)).toBe(
      new Date(AFTERNOON_UTC).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })
    );
  });
});
