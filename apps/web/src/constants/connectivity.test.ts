import { PACKET_LOSS_THRESHOLDS } from "@wan-monitor/shared";
import { describe, expect, it } from "vitest";
import { CONNECTIVITY_THRESHOLDS } from "@/constants/connectivity";

describe("CONNECTIVITY_THRESHOLDS", () => {
  it("derives degraded packet-loss thresholds from the shared source of truth", () => {
    expect(CONNECTIVITY_THRESHOLDS.degradedPacketLoss).toBe(
      PACKET_LOSS_THRESHOLDS.degradedFloor
    );
    expect(CONNECTIVITY_THRESHOLDS.maxDegradedPacketLoss).toBe(
      PACKET_LOSS_THRESHOLDS.degradedCeiling
    );
  });
});
