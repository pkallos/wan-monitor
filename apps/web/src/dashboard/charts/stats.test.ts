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

  test("counts samples over 5% as spikes", () => {
    const stats = calculatePacketLossStats([
      { packet_loss: 0 },
      { packet_loss: 6 },
      { packet_loss: 8 },
    ]);

    expect(stats).toEqual({
      current: "8.0",
      avg: "4.7",
      max: "8.0",
      spikes: 2,
    });
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
});
