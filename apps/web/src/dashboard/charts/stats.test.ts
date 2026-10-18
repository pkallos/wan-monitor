import { Array as Array_, Option } from "effect";
import { describe, expect, test } from "vitest";
import {
  calculateLatencyStats,
  calculateSpeedStats,
  latencyLine,
  seriesFigures,
  speedMedians,
  testsAreDense,
} from "@/dashboard/charts/stats";

describe("calculateLatencyStats", () => {
  test("has no average for no data", () => {
    expect(calculateLatencyStats([])).toEqual({ avg: null });
  });

  test("averages the latency samples, ignoring missing values", () => {
    const stats = calculateLatencyStats([
      { latency: 10 },
      { latency: 20 },
      { latency: undefined },
      { latency: 30 },
    ]);

    expect(stats).toEqual({ avg: 20 });
  });
});

describe("calculateLatencyStats on aggregated rows", () => {
  const rows = [
    { latency: 90, latency_p50: 10 },
    { latency: 90, latency_p50: 30 },
    { latency: 90 },
  ];

  test("describes the p50 line when the rows carry percentiles, skipping a bucket without one", () => {
    expect(calculateLatencyStats(rows)).toEqual({ avg: 20 });
  });

  test("falls back to latency when no row carries a percentile", () => {
    expect(calculateLatencyStats([{ latency: 90 }, { latency: 50 }]).avg).toBe(
      70
    );
  });
});

describe("latencyLine", () => {
  test("is the p50 of each bucket that has one when any row carries percentiles", () => {
    expect(
      latencyLine([{ latency: 90, latency_p50: 10 }, { latency: 90 }])
    ).toEqual([10]);
  });

  test("is the latency of each row otherwise", () => {
    expect(latencyLine([{ latency: 90 }, {}, { latency: 50 }])).toEqual([
      90, 50,
    ]);
  });
});

describe("calculateSpeedStats", () => {
  test("has no figures for no data", () => {
    expect(calculateSpeedStats([])).toEqual({
      avgDownload: null,
      avgUpload: null,
      maxDownload: null,
      maxUpload: null,
    });
  });

  test("computes average/max independently for download and upload", () => {
    const stats = calculateSpeedStats([
      { download_speed: 100, upload_speed: 10 },
      { download_speed: 200, upload_speed: 20 },
    ]);

    expect(stats).toEqual({
      avgDownload: 150,
      avgUpload: 15,
      maxDownload: 200,
      maxUpload: 20,
    });
  });

  test("has no figures for the empty series while the other still has data", () => {
    const stats = calculateSpeedStats([
      { download_speed: 100, upload_speed: undefined },
      { download_speed: 200, upload_speed: undefined },
    ]);

    expect(stats).toEqual({
      avgDownload: 150,
      avgUpload: null,
      maxDownload: 200,
      maxUpload: null,
    });
  });

  test("has no download figures when only uploads were measured", () => {
    const stats = calculateSpeedStats([
      { download_speed: undefined, upload_speed: 20 },
    ]);

    expect(stats).toEqual({
      avgDownload: null,
      avgUpload: 20,
      maxDownload: null,
      maxUpload: 20,
    });
  });
});

describe("a test with no reading", () => {
  const rows = [
    { download_speed: undefined, upload_speed: undefined },
    { download_speed: 100, upload_speed: 10 },
    { download_speed: 300, upload_speed: 30 },
  ];

  test("is left out of the average, max and median", () => {
    expect(calculateSpeedStats(rows)).toEqual({
      avgDownload: 200,
      avgUpload: 20,
      maxDownload: 300,
      maxUpload: 30,
    });
    expect(speedMedians(rows)).toEqual({ download: 200, upload: 20 });
  });

  test("leaves a series of only unread tests with no figures", () => {
    const unread = [{ download_speed: undefined, upload_speed: undefined }];

    expect(calculateSpeedStats(unread)).toEqual({
      avgDownload: null,
      avgUpload: null,
      maxDownload: null,
      maxUpload: null,
    });
    expect(speedMedians(unread)).toEqual({ download: null, upload: null });
  });
});

describe("speedMedians", () => {
  test("is null for both with no tests", () => {
    expect(speedMedians([])).toEqual({ download: null, upload: null });
  });

  test("takes the median of the measured tests, the mean of the middle pair for an even count", () => {
    expect(
      speedMedians([
        { download_speed: 100, upload_speed: 10 },
        { download_speed: 300, upload_speed: 30 },
        { download_speed: 200, upload_speed: 20 },
        { download_speed: 400, upload_speed: 40 },
      ])
    ).toEqual({ download: 250, upload: 25 });
  });

  test("keeps the two series apart when one was never measured", () => {
    expect(
      speedMedians([{ download_speed: 100, upload_speed: undefined }])
    ).toEqual({ download: 100, upload: null });
  });
});

describe("testsAreDense", () => {
  const HOUR_MS = 3_600_000;
  const at = (...gapsMs: number[]) =>
    Array_.scan(gapsMs, 0, (time, gap) => time + gap);

  test("is true for hourly tests, even with a little drift", () => {
    expect(testsAreDense(at(HOUR_MS, HOUR_MS + 40_000, HOUR_MS - 5_000))).toBe(
      true
    );
  });

  test("is true for tests more often than hourly", () => {
    expect(testsAreDense(at(30 * 60_000, 30 * 60_000, 30 * 60_000))).toBe(true);
  });

  test("is false for tests every few hours", () => {
    expect(testsAreDense(at(4 * HOUR_MS, 4 * HOUR_MS, 4 * HOUR_MS))).toBe(
      false
    );
  });

  test("judges by the typical gap, so one long outage between tests does not decide it", () => {
    expect(
      testsAreDense(at(HOUR_MS, HOUR_MS, 12 * HOUR_MS, HOUR_MS, HOUR_MS))
    ).toBe(true);
  });

  test("is false with fewer than two tests, since there is nothing to join", () => {
    expect(testsAreDense([])).toBe(false);
    expect(testsAreDense([5])).toBe(false);
  });
});

describe("seriesFigures", () => {
  test("is none for a series with no values", () => {
    expect(seriesFigures([])).toEqual(Option.none());
  });

  test("reports the average and the highest value, and keeps a zero", () => {
    expect(seriesFigures([0, 3, 9])).toEqual(Option.some({ avg: 4, peak: 9 }));
    expect(seriesFigures([0])).toEqual(Option.some({ avg: 0, peak: 0 }));
  });
});
