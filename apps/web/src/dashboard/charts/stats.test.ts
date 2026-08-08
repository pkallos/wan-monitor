import { describe, expect, test } from "vitest";
import {
  calculateJitterStats,
  calculateLatencyStats,
  calculatePacketLossStats,
  calculateSpeedStats,
} from "@/dashboard/charts/stats";

describe("calculateLatencyStats", () => {
  test("returns placeholders for no data", () => {
    expect(calculateLatencyStats([])).toEqual({
      current: "-",
      avg: "-",
      min: "-",
      max: "-",
    });
  });

  test("computes current/avg/min/max from latency samples, ignoring missing values", () => {
    const stats = calculateLatencyStats([
      { latency: 10 },
      { latency: 20 },
      { latency: undefined },
      { latency: 30 },
    ]);

    expect(stats).toEqual({
      current: "30.0",
      avg: "20.0",
      min: "10.0",
      max: "30.0",
    });
  });
});

describe("calculatePacketLossStats", () => {
  test("returns placeholders for no data", () => {
    expect(calculatePacketLossStats([])).toEqual({
      current: "-",
      avg: "-",
      max: "-",
      spikes: 0,
    });
  });

  test("counts samples at or above the degraded floor as spikes", () => {
    const stats = calculatePacketLossStats([
      { packet_loss: 0 },
      { packet_loss: 10 },
      { packet_loss: 40 },
    ]);

    expect(stats).toEqual({
      current: "40.0",
      avg: "16.7",
      max: "40.0",
      spikes: 2,
    });
  });

  test("uses the same boundary the connectivity classification uses", () => {
    // The SQL marks a cycle degraded at `packet_loss >= 10`. Anything below
    // that is `up` on the timeline, so it must not read as a spike here.
    expect(calculatePacketLossStats([{ packet_loss: 5 }]).spikes).toBe(0);
    expect(calculatePacketLossStats([{ packet_loss: 9 }]).spikes).toBe(0);
    expect(calculatePacketLossStats([{ packet_loss: 10 }]).spikes).toBe(1);
  });

  test("counts a 0% reading as a real sample, not a missing one", () => {
    const stats = calculatePacketLossStats([
      { packet_loss: 0 },
      { packet_loss: undefined },
    ]);

    expect(stats.current).toBe("0.0");
    expect(stats.avg).toBe("0.0");
    expect(stats.spikes).toBe(0);
  });
});

describe("calculateJitterStats", () => {
  test("returns placeholders for no data", () => {
    expect(calculateJitterStats([])).toEqual({
      current: "-",
      avg: "-",
      stability: "-",
    });
  });

  test("computes a 100% stability score when jitter never varies", () => {
    const stats = calculateJitterStats([
      { jitter: 5 },
      { jitter: 5 },
      { jitter: 5 },
    ]);

    expect(stats).toEqual({ current: "5.0", avg: "5.0", stability: "100" });
  });

  test("computes a lower stability score as jitter varies more", () => {
    const stats = calculateJitterStats([
      { jitter: 1 },
      { jitter: 20 },
      { jitter: 1 },
    ]);

    expect(Number(stats.stability)).toBeLessThan(100);
  });
});

describe("calculateSpeedStats", () => {
  test("returns placeholders for no data", () => {
    expect(calculateSpeedStats([])).toEqual({
      avgDownload: "-",
      avgUpload: "-",
      maxDownload: "-",
      maxUpload: "-",
    });
  });

  test("computes average/max independently for download and upload", () => {
    const stats = calculateSpeedStats([
      { download_speed: 100, upload_speed: 10 },
      { download_speed: 200, upload_speed: 20 },
    ]);

    expect(stats).toEqual({
      avgDownload: "150.0",
      avgUpload: "15.0",
      maxDownload: "200.0",
      maxUpload: "20.0",
    });
  });

  test("reports a placeholder for the empty series while the other still has data", () => {
    // Every upload measurement is missing. Averaging nothing to "0.0" would
    // claim a measured 0 Mbps upload that was never observed.
    const stats = calculateSpeedStats([
      { download_speed: 100, upload_speed: undefined },
      { download_speed: 200, upload_speed: undefined },
    ]);

    expect(stats).toEqual({
      avgDownload: "150.0",
      avgUpload: "-",
      maxDownload: "200.0",
      maxUpload: "-",
    });
  });

  test("reports a placeholder for downloads when only uploads were measured", () => {
    const stats = calculateSpeedStats([
      { download_speed: undefined, upload_speed: 20 },
    ]);

    expect(stats).toEqual({
      avgDownload: "-",
      avgUpload: "20.0",
      maxDownload: "-",
      maxUpload: "20.0",
    });
  });

  test("keeps a measured 0 Mbps in the average instead of dropping it", () => {
    const stats = calculateSpeedStats([
      { download_speed: 0, upload_speed: 0 },
      { download_speed: 100, upload_speed: 10 },
    ]);

    expect(stats.avgDownload).toBe("50.0");
    expect(stats.avgUpload).toBe("5.0");
  });
});
