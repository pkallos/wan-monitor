import { GetConnectivityStatusQuery } from "@shared/api/routes/connectivity-status";
import {
  GetMetricsQueryParams,
  GranularitySchema,
} from "@shared/api/routes/metrics";
import { SpeedTestHistoryQuery } from "@shared/api/routes/speedtest";
import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

describe.each([
  ["GetMetricsQueryParams", GetMetricsQueryParams],
  ["GetConnectivityStatusQuery", GetConnectivityStatusQuery],
  ["SpeedTestHistoryQuery", SpeedTestHistoryQuery],
] as const)("%s granularity", (_name, query) => {
  const decodeQuery = Schema.decodeUnknownResult(query);

  it.each(GranularitySchema.literals)("accepts %j", (granularity) => {
    expect(Result.isSuccess(decodeQuery({ granularity }))).toBe(true);
  });

  it.each(["2m", ""])("rejects %j", (granularity) => {
    expect(Result.isFailure(decodeQuery({ granularity }))).toBe(true);
  });
});
