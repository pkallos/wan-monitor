import { describe, expect, test } from "vitest";
import { getTimeRangeWindow } from "@/dashboard/timeRange";

const NOW_MS = Date.parse("2026-07-26T12:00:00.000Z");

describe("getTimeRangeWindow", () => {
  test("1h ends now and starts 1 hour earlier", () => {
    expect(getTimeRangeWindow("1h", NOW_MS)).toEqual({
      startTime: "2026-07-26T11:00:00.000Z",
      endTime: "2026-07-26T12:00:00.000Z",
    });
  });

  test("24h starts 1 day earlier", () => {
    expect(getTimeRangeWindow("24h", NOW_MS)).toEqual({
      startTime: "2026-07-25T12:00:00.000Z",
      endTime: "2026-07-26T12:00:00.000Z",
    });
  });

  test("7d starts 7 days earlier", () => {
    expect(getTimeRangeWindow("7d", NOW_MS)).toEqual({
      startTime: "2026-07-19T12:00:00.000Z",
      endTime: "2026-07-26T12:00:00.000Z",
    });
  });

  test("30d starts 30 days earlier", () => {
    expect(getTimeRangeWindow("30d", NOW_MS)).toEqual({
      startTime: "2026-06-26T12:00:00.000Z",
      endTime: "2026-07-26T12:00:00.000Z",
    });
  });
});
