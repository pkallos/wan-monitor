import type { Granularity } from "@shared/api/routes/metrics";
import type { SpeedMetric } from "@shared/api/routes/speedtest";
import type { GetSummaryResponseType } from "@shared/api/routes/summary";
import { Array as Array_, Match as M, Option, Order } from "effect";
import type { ConnectivityStatus } from "@/dashboard/connectivity";
import {
  type DateRangeSelection,
  describeCustomRange,
  type PresetKey,
  SPEEDTEST_AGGREGATION_THRESHOLD_MS,
} from "@/dashboard/dateRange";
import {
  counted,
  everyInterval,
  fixed,
  formatClock,
  formatDurationAgo,
  formatLongDuration,
  formatMonthDay,
  formatSpeed,
  speedClause,
} from "@/dashboard/format";

export type ConnectionState = ConnectivityStatus | "checking";

export type ConnectionStatus = Readonly<{ label: string }>;

// The label speaks in reachability ("Online"), not in the history ribbon's
// per-bucket vocabulary ("Up").
export const CONNECTION_STATUS: Record<ConnectionState, ConnectionStatus> = {
  up: { label: "Online" },
  degraded: { label: "Degraded" },
  down: { label: "Offline" },
  noInfo: { label: "No data" },
  checking: { label: "Checking…" },
};

export const lastSampleText = (
  state: ConnectionState,
  maybeLastSampleAtMs: Option.Option<number>,
  nowMs: number
): Option.Option<string> => {
  if (state === "checking") return Option.none();
  if (state === "noInfo") {
    return Option.some(
      Option.match(maybeLastSampleAtMs, {
        onNone: () => "No samples yet",
        onSome: (sampleAtMs) =>
          `Last checked ${formatDurationAgo(nowMs - sampleAtMs)}`,
      })
    );
  }
  return Option.map(
    maybeLastSampleAtMs,
    (sampleAtMs) => `Last checked ${formatDurationAgo(nowMs - sampleAtMs)}`
  );
};

const PRESET_PHRASES: Record<PresetKey, string> = {
  last1h: "the last hour",
  last24h: "the last 24 hours",
  last7d: "the last 7 days",
  last30d: "the last 30 days",
  mtd: "the month to date",
  qtd: "the quarter to date",
  ytd: "the year to date",
  last12m: "the last 12 months",
  allTime: "all time",
};

/** The range as it reads mid-sentence: "the last 30 days", "all time", "Oct 4 to Oct 10, 2026". */
export const describeRange = (selection: DateRangeSelection): string =>
  M.value(selection).pipe(
    M.tag("Preset", ({ preset }) => PRESET_PHRASES[preset]),
    M.orElse(describeCustomRange)
  );

/**
 * What the uptime figure rests on when the monitor did not observe the whole
 * range: the time with data, as the server counted it.
 */
export const coverageNote = (
  coveragePercentage: number,
  observedSeconds: number
): Option.Option<string> => {
  if (coveragePercentage >= 100) return Option.none();
  if (coveragePercentage <= 0) {
    return Option.some("The monitor has no data for this period.");
  }
  return Option.some(
    `The monitor has data for ${formatLongDuration(observedSeconds)} of this period, and uptime covers only that time.`
  );
};

export const percentText = (value: number | null): string =>
  value === null ? "-" : value.toFixed(2);

const chronological = <A extends { readonly timestamp: string }>(
  rows: ReadonlyArray<A>
): ReadonlyArray<A> =>
  Array_.sortWith(rows, (row) => Date.parse(row.timestamp), Order.Number);

/** One figure of the stat rail: a labelled number and the line under it. */
export type RailStat = Readonly<{
  key: "latency" | "loss" | "jitter" | "download" | "upload";
  label: string;
  value: string;
  unit: string;
  sub: string;
}>;

/** The figures the rail reads; a null count is a summary that never reported one. */
type RailFigures = Readonly<{
  range: Pick<
    GetSummaryResponseType["range"],
    "latencyP50" | "latencyP95" | "avgPacketLoss" | "avgJitter"
  >;
  speed: Readonly<{
    downloadMedian: number | null;
    uploadMedian: number | null;
    count: number | null;
  }>;
}>;

const testCountText = (count: number | null): string =>
  count === null
    ? "Median"
    : count === 0
      ? "No tests in this range."
      : `Median of ${counted(count, "test")}`;

export const railStats = ({
  range,
  speed,
}: RailFigures): ReadonlyArray<RailStat> => [
  {
    key: "latency",
    label: "Latency p50",
    value: fixed(range.latencyP50, 1),
    unit: "ms",
    sub: `95th percentile ${range.latencyP95 === null ? "-" : `${range.latencyP95.toFixed(1)} ms`}`,
  },
  {
    key: "loss",
    label: "Packet loss",
    value: fixed(range.avgPacketLoss, 2),
    unit: "%",
    sub: "Averaged over all pings",
  },
  {
    key: "jitter",
    label: "Jitter",
    value: fixed(range.avgJitter, 1),
    unit: "ms",
    sub: "Averaged over all pings",
  },
  {
    key: "download",
    label: "Download",
    value: formatSpeed(speed.downloadMedian),
    unit: "Mbps",
    sub: testCountText(speed.count),
  },
  {
    key: "upload",
    label: "Upload",
    value: formatSpeed(speed.uploadMedian),
    unit: "Mbps",
    sub: testCountText(speed.count),
  },
];

/** The rail of a summary that has no figures: every cell reads "-" under its usual label. */
export const unreportedRailStats: ReadonlyArray<RailStat> = railStats({
  range: {
    latencyP50: null,
    latencyP95: null,
    avgPacketLoss: null,
    avgJitter: null,
  },
  speed: { downloadMedian: null, uploadMedian: null, count: null },
});

export interface NetworkInfo {
  readonly isp: string;
  readonly maybeExternalIp: Option.Option<string>;
}

/** Reads from the newest sample that carries an ISP, so a failed speed test
 *  (which records a row with no ISP) doesn't blank the header. */
export const networkInfo = (
  history: ReadonlyArray<Pick<SpeedMetric, "isp" | "external_ip">>
): NetworkInfo =>
  Option.match(
    Array_.findFirst(
      history,
      (sample) => sample.isp !== undefined && sample.isp.length > 0
    ),
    {
      onNone: () => ({ isp: "ISP unknown", maybeExternalIp: Option.none() }),
      onSome: (latest) => ({
        isp: latest.isp ?? "ISP unknown",
        maybeExternalIp: Option.fromNullishOr(latest.external_ip),
      }),
    }
  );

/** The ISP, with the public IP when the speed tests recorded one: "TestISP, public IP 1.2.3.4". */
export const networkText = ({ isp, maybeExternalIp }: NetworkInfo): string =>
  Option.match(maybeExternalIp, {
    onNone: () => isp,
    onSome: (externalIp) => `${isp}, public IP ${externalIp}`,
  });

const BUCKET_ADJECTIVES: Record<Granularity, string> = {
  "1m": "1-minute",
  "5m": "5-minute",
  "15m": "15-minute",
  "1h": "hourly",
  "6h": "6-hour",
  "1d": "daily",
};

const BUCKET_AMOUNTS: Record<Granularity, string> = {
  "1m": "a minute",
  "5m": "5 minutes",
  "15m": "15 minutes",
  "1h": "an hour",
  "6h": "6 hours",
  "1d": "a day",
};

/** "A test runs every hour.", the cadence read from the configured interval. */
export const speedCadenceText = (speedtestIntervalSeconds: number): string =>
  `A test runs ${everyInterval(speedtestIntervalSeconds)}.`;

/** What the speed figures are when the history came in buckets: "Over 7 days or more, each point averages an hour of tests." */
export const speedAveragesNote = (bucket: Granularity): string =>
  `Over ${formatLongDuration(SPEEDTEST_AGGREGATION_THRESHOLD_MS / 1000)} or more, each point averages ${BUCKET_AMOUNTS[bucket]} of tests.`;

/**
 * The newest test as a sentence: "Last test, Oct 15 at 2:00 PM: 100 Mbps down,
 * 10.0 Mbps up (Fremont, CA).". The server clause drops out when unknown. A
 * history fetched in buckets holds averages, so the newest row is named as
 * one: "Latest hourly average, Oct 15 at 2:00 PM: ...". A daily bucket is cut
 * at UTC midnight, so it names its UTC day and no time.
 */
export const lastTestLabel = (
  history: ReadonlyArray<
    Pick<
      SpeedMetric,
      "timestamp" | "download_speed" | "upload_speed" | "server_location"
    >
  >,
  maybeBucket: Option.Option<Granularity>
): Option.Option<string> =>
  Option.map(Array_.last(chronological(history)), (latest) => {
    const at = Date.parse(latest.timestamp);
    const lead = Option.match(maybeBucket, {
      onNone: () => "Last test",
      onSome: (bucket) => `Latest ${BUCKET_ADJECTIVES[bucket]} average`,
    });
    const when = Option.exists(maybeBucket, (bucket) => bucket === "1d")
      ? formatMonthDay(at, "UTC")
      : `${formatMonthDay(at)} at ${formatClock(at)}`;
    const server =
      latest.server_location === undefined
        ? ""
        : ` (${latest.server_location})`;
    return `${lead}, ${when}: ${speedClause(latest.download_speed, "down")}, ${speedClause(latest.upload_speed, "up")}${server}.`;
  });

export type FetchErrorEntry = Readonly<{
  source: string;
  maybeError: Option.Option<string>;
}>;

/**
 * One line per distinct error, naming every source that hit it, so an outage
 * that fails several fetches with the same message reads once instead of once
 * per source.
 */
export const describeFetchErrors = (
  entries: ReadonlyArray<FetchErrorEntry>
): ReadonlyArray<string> => {
  const initial: ReadonlyArray<
    Readonly<{ error: string; sources: ReadonlyArray<string> }>
  > = [];
  return Array_.map(
    Array_.reduce(entries, initial, (groups, { source, maybeError }) =>
      Option.match(maybeError, {
        onNone: () => groups,
        onSome: (error) =>
          Array_.some(groups, (group) => group.error === error)
            ? Array_.map(groups, (group) =>
                group.error === error
                  ? { ...group, sources: [...group.sources, source] }
                  : group
              )
            : [...groups, { error, sources: [source] }],
      })
    ),
    ({ error, sources }) => `${sources.join(", ")}: ${error}`
  );
};
