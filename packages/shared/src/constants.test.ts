import {
  liveConnectivityWindowSeconds,
  PACKET_LOSS_THRESHOLDS,
} from "@shared/constants";
import { describe, expect, it } from "vitest";

describe("PACKET_LOSS_THRESHOLDS", () => {
  it("marks samples degraded from 10% loss up to 50%", () => {
    expect(PACKET_LOSS_THRESHOLDS.degradedFloor).toBe(10);
    expect(PACKET_LOSS_THRESHOLDS.degradedCeiling).toBe(50);
  });

  it("keeps the degraded band non-empty", () => {
    expect(PACKET_LOSS_THRESHOLDS.degradedFloor).toBeLessThan(
      PACKET_LOSS_THRESHOLDS.degradedCeiling
    );
  });
});

describe("liveConnectivityWindowSeconds", () => {
  it("spans two cycles at the default 30s ping interval", () => {
    expect(liveConnectivityWindowSeconds(30)).toBe(60);
  });

  it("holds at the 60s floor for a faster interval", () => {
    expect(liveConnectivityWindowSeconds(10)).toBe(60);
  });

  it("follows the interval once two cycles exceed the floor", () => {
    expect(liveConnectivityWindowSeconds(300)).toBe(600);
  });
});
