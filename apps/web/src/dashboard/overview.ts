import type { SpeedMetric } from "@shared/api/routes/speedtest";
import type { GetSummaryResponseType } from "@shared/api/routes/summary";
import { Array as Array_, Match as M, Option, Order } from "effect";
import type { ConnectivityStatus } from "@/dashboard/connectivity";
import type { DateRangeSelection, PresetKey } from "@/dashboard/dateRange";
import {
  counted,
  fixed,
  formatClock,
  formatDurationAgo,
  formatLongDuration,
  formatMonthDay,
} from "@/dashboard/format";

export type ConnectionState = ConnectivityStatus | "checking";

export type ConnectionStatus = Readonly<{ label: string }>;

// The label speaks in reachability ("Online"), not in the history ribbon's
// per-cycle vocabulary ("Up").
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

const UTC_DAY_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
};

const utcDayText = (
  iso: string,
  options: Intl.DateTimeFormatOptions = UTC_DAY_FORMAT
): string => new Date(iso).toLocaleDateString([], options);

/**
 * A custom range as it reads mid-sentence, in the UTC days its picker label
 * uses: "Oct 4 to Oct 10, 2026", or the one day when it starts and ends on it.
 */
const describeCustomRange = ({
  startTime,
  endTime,
}: {
  startTime: string;
  endTime: string;
}): string => {
  const withYear = { ...UTC_DAY_FORMAT, year: "numeric" } as const;
  const start = utcDayText(startTime, withYear);
  const end = utcDayText(endTime, withYear);
  if (start === end) return end;
  const isSameYear =
    new Date(startTime).getUTCFullYear() === new Date(endTime).getUTCFullYear();
  return `${isSameYear ? utcDayText(startTime) : start} to ${end}`;
};

/** The range as it reads mid-sentence: "the last 30 days", "all time", "Oct 4 to Oct 10, 2026". */
export const describeRange = (selection: DateRangeSelection): string =>
  M.value(selection).pipe(
    M.tag("Preset", ({ preset }) => PRESET_PHRASES[preset]),
    M.orElse(describeCustomRange)
  );

/**
 * What the uptime figure rests on when the monitor did not observe the whole
 * range: the covered time, taken as the coverage share of the range's span.
 */
export const coverageNote = (
  coveragePercentage: number,
  spanMs: number
): Option.Option<string> => {
  if (coveragePercentage >= 100) return Option.none();
  if (coveragePercentage <= 0) {
    return Option.some("The monitor has no data for this period.");
  }
  const coveredSeconds = Math.round(
    (spanMs / 1000) * (coveragePercentage / 100)
  );
  return Option.some(
    `The monitor has data for ${formatLongDuration(coveredSeconds)} of this period, and uptime covers only that time.`
  );
};

export const percentText = (value: number | null): string =>
  value === null ? "-" : value.toFixed(2);

const chronological = <A extends { readonly timestamp: string }>(
  rows: ReadonlyArray<A>
): ReadonlyArray<A> =>
  Array_.sortWith(rows, (row) => Date.parse(row.timestamp), Order.Number);

// A test can exist without one of its two measurements, and a genuine zero is
// a reading, so each half falls back to "-" on its own. Triple-digit speeds
// drop the decimal so the figures stay compact.
const formatSpeed = (value: number | null | undefined): string =>
  value === null || value === undefined
    ? "-"
    : value >= 100
      ? value.toFixed(0)
      : value.toFixed(1);

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
    sub: "Averaged over all checks",
  },
  {
    key: "jitter",
    label: "Jitter",
    value: fixed(range.avgJitter, 1),
    unit: "ms",
    sub: "Averaged over all checks",
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

const speedClause = (
  value: number | null | undefined,
  direction: "down" | "up"
): string =>
  value === null || value === undefined
    ? `no ${direction === "down" ? "download" : "upload"} reading`
    : `${formatSpeed(value)} Mbps ${direction}`;

/**
 * The newest test as a sentence: "Last test, Oct 15 at 2:00 PM: 100 Mbps down,
 * 10.0 Mbps up (Fremont, CA).". The server clause drops out when unknown.
 */
export const lastTestLabel = (
  history: ReadonlyArray<
    Pick<
      SpeedMetric,
      "timestamp" | "download_speed" | "upload_speed" | "server_location"
    >
  >
): Option.Option<string> =>
  Option.map(Array_.last(chronological(history)), (latest) => {
    const at = Date.parse(latest.timestamp);
    const server =
      latest.server_location === undefined
        ? ""
        : ` (${latest.server_location})`;
    return `Last test, ${formatMonthDay(at)} at ${formatClock(at)}: ${speedClause(latest.download_speed, "down")}, ${speedClause(latest.upload_speed, "up")}${server}.`;
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
