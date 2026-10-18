import { MetricSchema } from "@shared/api/routes/metrics";
import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

describe("MetricSchema connectivity_status", () => {
  const decodeMetric = Schema.decodeUnknownResult(MetricSchema);
  const metric = { timestamp: "2024-02-10T08:00:00.000Z", source: "ping" };

  it.each(["up", "down", "degraded"])("accepts %j", (connectivity_status) => {
    expect(
      Result.isSuccess(decodeMetric({ ...metric, connectivity_status }))
    ).toBe(true);
  });

  it("accepts an absent status", () => {
    expect(Result.isSuccess(decodeMetric(metric))).toBe(true);
  });

  it.each(["sideways", ""])("rejects %j", (connectivity_status) => {
    expect(
      Result.isFailure(decodeMetric({ ...metric, connectivity_status }))
    ).toBe(true);
  });
});
