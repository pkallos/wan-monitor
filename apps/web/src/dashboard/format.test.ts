import { describe, expect, test } from "vitest";
import {
  counted,
  everyInterval,
  formatClock,
  formatDateTime,
  formatDuration,
  formatDurationAgo,
  formatLongDuration,
  formatMonthDay,
  formatTimeSpan,
  isLocalMidnight,
  isSameLocalDay,
  speedClause,
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

describe("speedClause", () => {
  test("states a measured speed the way the stat rail does", () => {
    expect(speedClause(512.4, "down")).toBe("512 Mbps down");
    expect(speedClause(42.5, "up")).toBe("42.5 Mbps up");
    expect(speedClause(0, "up")).toBe("0.0 Mbps up");
  });

  test("says no reading was taken instead of reporting 0", () => {
    expect(speedClause(undefined, "down")).toBe("no download reading");
    expect(speedClause(null, "up")).toBe("no upload reading");
  });
});

describe("formatLongDuration", () => {
  test.each([
    [0, "0 seconds"],
    [1, "1 second"],
    [45, "45 seconds"],
    [60, "1 minute"],
    [89, "1 minute"],
    [390, "7 minutes"],
    [2098, "35 minutes"],
    [3580, "1 hour"],
    [3060, "51 minutes"],
    [3600, "1 hour"],
    [3661, "1 hour 1 minute"],
    [5400, "1 hour 30 minutes"],
    [7200, "2 hours"],
    [86_400, "1 day"],
    [90_000, "1 day 1 hour"],
    [187_200, "2 days 4 hours"],
  ])("renders %is as %s", (seconds, expected) => {
    expect(formatLongDuration(seconds)).toBe(expected);
  });

  test("rounds to the nearest minute from a minute up, then keeps the two largest units", () => {
    expect(formatLongDuration(3600 + 5 * 60 + 59)).toBe("1 hour 6 minutes");
    expect(formatLongDuration(3600 + 5 * 60 + 29)).toBe("1 hour 5 minutes");
    expect(formatLongDuration(86_400 + 3600 + 59 * 60)).toBe("1 day 1 hour");
  });

  test("drops sub-second remainders and clamps a negative span to zero", () => {
    expect(formatLongDuration(59.9)).toBe("59 seconds");
    expect(formatLongDuration(-5)).toBe("0 seconds");
  });
});

describe("formatDurationAgo", () => {
  test.each([
    [0, "0 seconds ago"],
    [1000, "1 second ago"],
    [7000, "7 seconds ago"],
    [59_999, "59 seconds ago"],
    [60_000, "1 minute ago"],
    [3 * 60_000, "3 minutes ago"],
    [3_600_000, "1 hour ago"],
    [5 * 3_600_000, "5 hours ago"],
    [86_400_000, "1 day ago"],
    [3 * 86_400_000, "3 days ago"],
  ])("renders %ims as %s", (elapsedMs, expected) => {
    expect(formatDurationAgo(elapsedMs)).toBe(expected);
  });

  test("never reads a negative age", () => {
    expect(formatDurationAgo(-2000)).toBe("0 seconds ago");
  });
});

describe("counted", () => {
  test("pluralises by the count", () => {
    expect(counted(0, "test")).toBe("0 tests");
    expect(counted(1, "test")).toBe("1 test");
    expect(counted(2, "test")).toBe("2 tests");
  });
});

describe("everyInterval", () => {
  test.each([
    [1, "every second"],
    [30, "every 30 seconds"],
    [60, "every minute"],
    [120, "every 2 minutes"],
    [300, "every 5 minutes"],
    [3600, "every hour"],
    [7200, "every 2 hours"],
    [21_600, "every 6 hours"],
    [86_400, "every day"],
    [172_800, "every 2 days"],
    [90, "every 90 seconds"],
    [5400, "every 90 minutes"],
    [100, "every 100 seconds"],
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

describe("formatMonthDay", () => {
  test("names the month and day without a weekday or year", () => {
    withTimeZone("UTC", () => {
      expect(
        formatMonthDay(Date.parse("2026-10-11T19:00:00Z"), undefined, "en-US")
      ).toBe("Oct 11");
    });
  });

  test("names the UTC day when asked, west of UTC where local midnight falls the day before", () => {
    withTimeZone("America/Los_Angeles", () => {
      const utcMidnight = Date.parse("2026-10-11T00:00:00Z");

      expect(formatMonthDay(utcMidnight, undefined, "en-US")).toBe("Oct 10");
      expect(formatMonthDay(utcMidnight, "UTC", "en-US")).toBe("Oct 11");
    });
  });
});

describe("formatTimeSpan", () => {
  const at = (iso: string) => Date.parse(iso);

  test("reads an hour as 'Oct 11, 7 to 8 PM', sharing the day period", () => {
    withTimeZone("UTC", () => {
      expect(
        formatTimeSpan(
          at("2026-10-11T19:00:00Z"),
          at("2026-10-11T20:00:00Z"),
          "en-US"
        )
      ).toMatch(/^Oct 11, 7 to 8\sPM$/);
    });
  });

  test("keeps both day periods when the span crosses noon", () => {
    withTimeZone("UTC", () => {
      expect(
        formatTimeSpan(
          at("2026-10-11T11:00:00Z"),
          at("2026-10-11T12:00:00Z"),
          "en-US"
        )
      ).toMatch(/^Oct 11, 11\sAM to 12\sPM$/);
    });
  });

  test("shows the minutes of a span that does not sit on the hour", () => {
    withTimeZone("UTC", () => {
      expect(
        formatTimeSpan(
          at("2026-10-11T19:05:00Z"),
          at("2026-10-11T19:10:00Z"),
          "en-US"
        )
      ).toMatch(/^Oct 11, 7:05 to 7:10\sPM$/);
    });
  });

  test("follows a 24-hour locale without a day period", () => {
    withTimeZone("UTC", () => {
      expect(
        formatTimeSpan(
          at("2026-10-11T19:00:00Z"),
          at("2026-10-11T20:00:00Z"),
          "de-DE"
        )
      ).toMatch(/^11\. Okt\.?,? 19\D* to 20\D*$/);
    });
  });

  test("names each end's day when the span runs past midnight", () => {
    withTimeZone("UTC", () => {
      expect(
        formatTimeSpan(
          at("2026-10-11T19:00:00Z"),
          at("2026-10-12T01:00:00Z"),
          "en-US"
        )
      ).toMatch(/^Oct 11, 7\sPM to Oct 12, 1\sAM$/);
    });
  });

  test("keeps a span that ends exactly at midnight on its own day", () => {
    withTimeZone("UTC", () => {
      expect(
        formatTimeSpan(
          at("2026-10-11T23:00:00Z"),
          at("2026-10-12T00:00:00Z"),
          "en-US"
        )
      ).toMatch(/^Oct 11, 11\sPM to 12\sAM$/);
    });
  });

  test("shows minutes in a zone with a half-hour offset, where hour buckets are off the hour", () => {
    withTimeZone("Asia/Kolkata", () => {
      expect(
        formatTimeSpan(
          at("2026-10-11T19:00:00Z"),
          at("2026-10-11T20:00:00Z"),
          "en-US"
        )
      ).toMatch(/^Oct 12, 12:30 to 1:30\sAM$/);
    });
  });
});
