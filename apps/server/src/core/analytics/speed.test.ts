import type { Metric } from "@wan-monitor/shared";
import { describe, expect, it } from "vitest";
import { summarizeSpeed } from "@/core/analytics/speed";

const test = (download?: number, upload?: number): Metric => ({
  timestamp: "2024-01-01T00:00:00Z",
  source: "speedtest",
  download_speed: download,
  upload_speed: upload,
});

describe("summarizeSpeed", () => {
  it("is all null with a zero count when no tests ran", () => {
    expect(summarizeSpeed([])).toEqual({
      downloadMedian: null,
      uploadMedian: null,
      count: 0,
    });
  });

  it("reports the median per direction", () => {
    const rows = [
      test(100, 10),
      test(200, 20),
      test(300, 30),
      test(400, 40),
      test(500, 50),
    ];

    expect(summarizeSpeed(rows)).toEqual({
      downloadMedian: 300,
      uploadMedian: 30,
      count: 5,
    });
  });

  it("ignores tests with no reading so they don't drag the figures down", () => {
    const summary = summarizeSpeed([
      test(undefined, undefined),
      test(100, 10),
      test(300, 30),
    ]);

    expect(summary.downloadMedian).toBe(200);
    expect(summary.count).toBe(2);
  });

  it("is all null when no test took a reading", () => {
    const summary = summarizeSpeed([
      test(undefined, undefined),
      test(undefined, undefined),
    ]);

    expect(summary.downloadMedian).toBeNull();
    expect(summary.uploadMedian).toBeNull();
    expect(summary.count).toBe(0);
  });

  it("counts a partial result toward the direction that was measured", () => {
    const summary = summarizeSpeed([test(100, undefined), test(undefined, 40)]);

    expect(summary.downloadMedian).toBe(100);
    expect(summary.uploadMedian).toBe(40);
    expect(summary.count).toBe(2);
  });
});
