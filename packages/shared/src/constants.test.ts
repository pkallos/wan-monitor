import {
  liveConnectivityWindowSeconds,
  PACKET_LOSS_THRESHOLDS,
} from "@shared/constants";
import { describe, expect, it } from "vitest";

describe("PACKET_LOSS_THRESHOLDS", () => {
  it("marks pings degraded from 10% loss up, with no upper bound", () => {
    expect(PACKET_LOSS_THRESHOLDS.degradedFloor).toBe(10);
    expect(PACKET_LOSS_THRESHOLDS).not.toHaveProperty("degradedCeiling");
  });
});

describe("liveConnectivityWindowSeconds", () => {
  it("spans 2.5 intervals at the default 30s ping interval", () => {
    expect(liveConnectivityWindowSeconds(30)).toBe(75);
  });

  it("holds at the 60s floor for a faster interval", () => {
    expect(liveConnectivityWindowSeconds(10)).toBe(60);
  });

  it("follows the interval once 2.5 intervals exceed the floor", () => {
    expect(liveConnectivityWindowSeconds(300)).toBe(750);
  });
});
