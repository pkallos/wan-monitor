import type { GetOutagesResponseType } from "@shared/api/routes/connectivity-status";
import type { GetHostsResponseType } from "@shared/api/routes/ping";
import type {
  GetSummaryResponseType,
  RangeSummary,
} from "@shared/api/routes/summary";
import { Option } from "effect";
import { Preset } from "@/dashboard/dateRange";
import {
  OutagesAsyncData,
  type OutagesData,
  PingHostsAsyncData,
  SummaryAsyncData,
  type SummaryData,
} from "@/dashboard/model";

export const rangeSummary = (
  overrides: Partial<RangeSummary> = {}
): RangeSummary => ({
  latencyP50: 14.2,
  latencyP95: 31.8,
  avgPacketLoss: 0.5,
  avgJitter: 2.1,
  ...overrides,
});

export const summaryResponse = (
  overrides: Partial<GetSummaryResponseType> = {}
): GetSummaryResponseType => ({
  range: rangeSummary(),
  windows: {
    last24h: { uptimePercentage: 99.9 },
    last7d: { uptimePercentage: 99.4 },
    last30d: { uptimePercentage: 99.6 },
  },
  hosts: [
    {
      host: "1.1.1.1",
      latencyP50: 12,
      latencyP95: 30,
      avgPacketLoss: 0.1,
      avgJitter: 1.5,
      availabilityPercentage: 99.9,
      lastStatus: "up",
    },
    {
      host: "8.8.8.8",
      latencyP50: 16,
      latencyP95: 44,
      avgPacketLoss: 0.9,
      avgJitter: 2.7,
      availabilityPercentage: 99.1,
      lastStatus: "degraded",
    },
  ],
  speed: {
    downloadMedian: 941,
    uploadMedian: 917,
    count: 24,
  },
  meta: {
    startTime: "2026-07-21T00:00:00.000Z",
    endTime: "2026-07-28T00:00:00.000Z",
  },
  ...overrides,
});

export const outagesResponse = (
  data: GetOutagesResponseType["data"] = []
): GetOutagesResponseType => ({
  data,
  meta: {
    startTime: "2026-06-28T00:00:00.000Z",
    endTime: "2026-07-28T12:00:00.000Z",
    count: data.length,
    totalCount: data.length,
  },
});

export const hostsResponse = (
  hosts: ReadonlyArray<string> = ["1.1.1.1", "8.8.8.8"]
): GetHostsResponseType => ({
  hosts,
  pingIntervalSeconds: 30,
  speedtestIntervalSeconds: 3600,
});

/** A range request matching the default model's range, for results the test doesn't care about. */
export const DEFAULT_REQUEST = {
  dateRange: Preset({ preset: "last30d" }),
  maybeEarliestDataMs: Option.none<number>(),
};

/** Outage data fetched for the default range at the log fixture's end time. */
export const outagesData = (
  log: GetOutagesResponseType = outagesResponse(),
  overrides: Partial<OutagesData> = {}
): OutagesData => ({
  log,
  isClamped: false,
  fetchedAtMs: Date.parse(log.meta.endTime),
  request: DEFAULT_REQUEST,
  ...overrides,
});

/** Summary data fetched for the default range. */
export const summaryData = (
  summary: GetSummaryResponseType = summaryResponse(),
  request: SummaryData["request"] = DEFAULT_REQUEST
): SummaryData => ({ summary, request });

/** Settled data for the three insight fetches, to spread into a model. */
export const loadedInsights = () => ({
  summary: SummaryAsyncData.Success({ data: summaryData() }),
  outages: OutagesAsyncData.Success({ data: outagesData() }),
  pingHosts: PingHostsAsyncData.Success({ data: hostsResponse() }),
});

export const outageFixture = (
  overrides: Partial<GetOutagesResponseType["data"][number]> = {}
): GetOutagesResponseType["data"][number] => ({
  start: "2026-07-27T02:00:00.000Z",
  end: "2026-07-27T02:06:30.000Z",
  durationSeconds: 390,
  status: "down",
  affectedHosts: ["1.1.1.1", "8.8.8.8"],
  maxPacketLoss: 100,
  peakLatency: null,
  ...overrides,
});

/** Runs `run` with the process time zone set to `timeZone`, then restores it. */
export const withTimeZone = <A>(timeZone: string, run: () => A): A => {
  const original = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    return run();
  } finally {
    if (original === undefined) {
      Reflect.deleteProperty(process.env, "TZ");
    } else {
      process.env.TZ = original;
    }
  }
};
