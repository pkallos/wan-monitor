import {
  GetConnectivityStatusQuery,
  GetOutagesQuery,
} from "@shared/api/routes/connectivity-status";
import { GetMetricsQueryParams } from "@shared/api/routes/metrics";
import { SpeedTestHistoryQuery } from "@shared/api/routes/speedtest";
import { GetSummaryQuery } from "@shared/api/routes/summary";
import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

describe.each([
  ["GetSummaryQuery", GetSummaryQuery],
  ["GetOutagesQuery", GetOutagesQuery],
  ["GetMetricsQueryParams", GetMetricsQueryParams],
  ["GetConnectivityStatusQuery", GetConnectivityStatusQuery],
  ["SpeedTestHistoryQuery", SpeedTestHistoryQuery],
] as const)("%s time bounds", (_name, query) => {
  const decodeQuery = Schema.decodeUnknownResult(query);

  it("accepts ISO timestamps, or none", () => {
    expect(
      Result.isSuccess(
        decodeQuery({
          startTime: "2024-02-10T08:00:00.000Z",
          endTime: "2024-02-11T08:00:00+05:30",
        })
      )
    ).toBe(true);
    expect(Result.isSuccess(decodeQuery({}))).toBe(true);
  });

  it.each(["garbage", "2024-02-10", "2024-02-30T00:00:00Z", ""])(
    "rejects the startTime %j",
    (startTime) => {
      expect(Result.isFailure(decodeQuery({ startTime }))).toBe(true);
    }
  );

  it("says what a valid timestamp looks like", () => {
    const result = decodeQuery({ startTime: "garbage" });

    expect(Result.isFailure(result) && String(result.failure)).toContain(
      "Expected an ISO 8601 timestamp in years 0000 to 9999, such as 2024-02-10T08:00:00Z"
    );
  });

  it("rejects an invalid endTime", () => {
    expect(Result.isFailure(decodeQuery({ endTime: "tomorrow" }))).toBe(true);
  });
});

describe.each([
  ["GetMetricsQueryParams", GetMetricsQueryParams],
  ["SpeedTestHistoryQuery", SpeedTestHistoryQuery],
] as const)("%s limit", (_name, query) => {
  const decodeQuery = Schema.decodeUnknownResult(query);

  it.each(["1", "500"])("accepts the limit %j", (limit) => {
    expect(Result.isSuccess(decodeQuery({ limit }))).toBe(true);
  });

  it.each(["-1", "1.5", "0", "abc", "", "9007199254740993"])(
    "rejects the limit %j",
    (limit) => {
      expect(Result.isFailure(decodeQuery({ limit }))).toBe(true);
    }
  );

  it("says what a valid limit looks like", () => {
    const result = decodeQuery({ limit: "-1" });

    expect(Result.isFailure(result) && String(result.failure)).toContain(
      "Expected a positive integer"
    );
  });

  it("accepts no limit", () => {
    expect(Result.isSuccess(decodeQuery({}))).toBe(true);
  });
});
