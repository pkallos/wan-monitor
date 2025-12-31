import { describe, expect, it } from "vitest";
import { getTimeRangeDates, TIME_RANGE_LABELS } from "@/utils/timeRange";

describe("timeRange", () => {
  describe("getTimeRangeDates", () => {
    it("should return dates for 1 hour range", () => {
      const { startTime, endTime } = getTimeRangeDates("1h");
      const diffInHours =
        (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);

      expect(diffInHours).toBeCloseTo(1, 1);
      expect(startTime).toBeInstanceOf(Date);
      expect(endTime).toBeInstanceOf(Date);
      expect(startTime.getTime()).toBeLessThan(endTime.getTime());
    });

    it("should return dates for 24 hour range", () => {
      const { startTime, endTime } = getTimeRangeDates("24h");
      const diffInHours =
        (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);

      expect(diffInHours).toBeCloseTo(24, 1);
      expect(startTime).toBeInstanceOf(Date);
      expect(endTime).toBeInstanceOf(Date);
    });

    it("should return dates for 7 day range", () => {
      const { startTime, endTime } = getTimeRangeDates("7d");
      const diffInDays =
        (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60 * 24);

      expect(diffInDays).toBeCloseTo(7, 1);
      expect(startTime).toBeInstanceOf(Date);
      expect(endTime).toBeInstanceOf(Date);
    });

    it("should return dates for 30 day range", () => {
      const { startTime, endTime } = getTimeRangeDates("30d");
      const diffInDays =
        (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60 * 24);

      expect(diffInDays).toBeCloseTo(30, 1);
      expect(startTime).toBeInstanceOf(Date);
      expect(endTime).toBeInstanceOf(Date);
    });

    it("should have endTime after startTime for all ranges", () => {
      const ranges = ["1h", "24h", "7d", "30d"] as const;

      for (const range of ranges) {
        const { startTime, endTime } = getTimeRangeDates(range);
        expect(startTime.getTime()).toBeLessThan(endTime.getTime());
      }
    });
  });

  describe("TIME_RANGE_LABELS", () => {
    it("should have labels for all time ranges", () => {
      expect(TIME_RANGE_LABELS["1h"]).toBe("1 Hour");
      expect(TIME_RANGE_LABELS["24h"]).toBe("24 Hours");
      expect(TIME_RANGE_LABELS["7d"]).toBe("7 Days");
      expect(TIME_RANGE_LABELS["30d"]).toBe("30 Days");
    });
  });
});
