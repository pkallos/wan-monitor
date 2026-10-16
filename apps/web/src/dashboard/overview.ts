import type { SpeedMetric } from "@shared/api/routes/speedtest";
import type { GetSummaryResponseType } from "@shared/api/routes/summary";
import { Array as Array_, Match as M, Option, Order } from "effect";
import type { ConnectivityStatus } from "@/dashboard/connectivity";
import {
  type DateRangeSelection,
  formatDateRangeLabel,
  type PresetKey,
} from "@/dashboard/dateRange";
import type { Delta, SummaryDeltas } from "@/dashboard/deltas";
import { fixed, formatDateTime } from "@/dashboard/format";

export const formatDurationAgo = (elapsedMs: number): string => {
  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};

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
          `Last sample ${formatDurationAgo(nowMs - sampleAtMs)}`,
      })
    );
  }
  return Option.map(
    maybeLastSampleAtMs,
    (sampleAtMs) => `Last sample ${formatDurationAgo(nowMs - sampleAtMs)}`
  );
};

type PresetNames = Readonly<{ phrase: string; title: string; tag: string }>;

const PRESET_NAMES: Record<PresetKey, PresetNames> = {
  last1h: { phrase: "the last hour", title: "1 hour", tag: "1h" },
  last24h: { phrase: "the last 24 hours", title: "24 hours", tag: "24h" },
  last7d: { phrase: "the last 7 days", title: "7 days", tag: "7d" },
  last30d: { phrase: "the last 30 days", title: "30 days", tag: "30d" },
  mtd: { phrase: "the month to date", title: "Month to date", tag: "MTD" },
  qtd: {
    phrase: "the quarter to date",
    title: "Quarter to date",
    tag: "QTD",
  },
  ytd: { phrase: "the year to date", title: "Year to date", tag: "YTD" },
  last12m: { phrase: "the last 12 months", title: "12 months", tag: "12m" },
  allTime: { phrase: "all time", title: "All time", tag: "all time" },
};

/** The range as it reads mid-sentence; a custom range is named by its dates. */
export const describeRange = (selection: DateRangeSelection): string =>
  M.value(selection).pipe(
    M.tag("Preset", ({ preset }) => PRESET_NAMES[preset].phrase),
    M.orElse((custom) => formatDateRangeLabel(custom))
  );

/** The range as a card subtitle opens with it: "7 days", "Month to date". */
export const rangeTitle = (selection: DateRangeSelection): string =>
  M.value(selection).pipe(
    M.tag("Preset", ({ preset }) => PRESET_NAMES[preset].title),
    M.orElse((custom) => formatDateRangeLabel(custom))
  );

/** A preset's short form for a figure's caption; a custom range has none. */
export const rangeTag = (
  selection: DateRangeSelection
): Option.Option<string> =>
  M.value(selection).pipe(
    M.tag("Preset", ({ preset }) => Option.some(PRESET_NAMES[preset].tag)),
    M.orElse(() => Option.none())
  );

export const percentText = (value: number | null): string =>
  value === null ? "-" : value.toFixed(2);

const chronological = <A extends { readonly timestamp: string }>(
  rows: ReadonlyArray<A>
): ReadonlyArray<A> =>
  Array_.sortWith(rows, (row) => Date.parse(row.timestamp), Order.Number);

// A test can exist without one of its two measurements, and a genuine zero is
// a reading, so each half falls back to "-" on its own. Triple-digit speeds
// drop the decimal so the pair stays compact.
const formatSpeed = (value: number | null | undefined): string =>
  value === null || value === undefined
    ? "-"
    : value >= 100
      ? value.toFixed(0)
      : value.toFixed(1);

type SpeedRow = Pick<
  SpeedMetric,
  "timestamp" | "download_speed" | "upload_speed"
>;

/** The newest test's download and upload as "941 / 917", or "-" with no tests. */
export const latestSpeedPair = (history: ReadonlyArray<SpeedRow>): string =>
  Option.match(Array_.last(chronological(history)), {
    onNone: () => "-",
    onSome: (latest) =>
      `${formatSpeed(latest.download_speed)} / ${formatSpeed(latest.upload_speed)}`,
  });

/** One figure of the stat rail: a labelled number, a line under it, and its change. */
export type RailStat = Readonly<{
  key: "latency" | "loss" | "jitter" | "download" | "upload";
  label: string;
  value: string;
  unit: string;
  sub: string;
  delta: Option.Option<Delta>;
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
    ? "median"
    : count === 0
      ? "No tests in this range."
      : `median · ${count} ${count === 1 ? "test" : "tests"}`;

export const railStats = (
  { range, speed }: RailFigures,
  maybeDeltas: Option.Option<SummaryDeltas>
): ReadonlyArray<RailStat> => {
  const deltaOf = (pick: (deltas: SummaryDeltas) => Option.Option<Delta>) =>
    Option.flatMap(maybeDeltas, pick);
  return [
    {
      key: "latency",
      label: "Latency p50",
      value: fixed(range.latencyP50, 1),
      unit: "ms",
      sub: `p95 ${range.latencyP95 === null ? "-" : `${range.latencyP95.toFixed(1)} ms`}`,
      delta: deltaOf((deltas) => deltas.latency),
    },
    {
      key: "loss",
      label: "Packet loss",
      value: fixed(range.avgPacketLoss, 2),
      unit: "%",
      sub: "average",
      delta: deltaOf((deltas) => deltas.loss),
    },
    {
      key: "jitter",
      label: "Jitter",
      value: fixed(range.avgJitter, 1),
      unit: "ms",
      sub: "average",
      delta: deltaOf((deltas) => deltas.jitter),
    },
    {
      key: "download",
      label: "Download",
      value: formatSpeed(speed.downloadMedian),
      unit: "Mbps",
      sub: testCountText(speed.count),
      delta: Option.none(),
    },
    {
      key: "upload",
      label: "Upload",
      value: formatSpeed(speed.uploadMedian),
      unit: "Mbps",
      sub: testCountText(speed.count),
      delta: Option.none(),
    },
  ];
};

/** The rail of a summary that has no figures: every cell reads "-" under its usual label. */
export const unreportedRailStats: ReadonlyArray<RailStat> = railStats(
  {
    range: {
      latencyP50: null,
      latencyP95: null,
      avgPacketLoss: null,
      avgJitter: null,
    },
    speed: { downloadMedian: null, uploadMedian: null, count: null },
  },
  Option.none()
);

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

/** "Last test · Oct 15, 2:00 PM · Fremont, CA"; the server clause drops out when unknown. */
export const lastTestLabel = (
  history: ReadonlyArray<Pick<SpeedMetric, "timestamp" | "server_location">>
): Option.Option<string> =>
  Option.map(Array_.last(chronological(history)), (latest) =>
    [
      "Last test",
      formatDateTime(latest.timestamp),
      ...(latest.server_location === undefined ? [] : [latest.server_location]),
    ].join(" · ")
  );

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
