import type { Metric } from "@shared/api/routes/metrics";
import type { SpeedMetric } from "@shared/api/routes/speedtest";
import { Array as Array_, Match as M, Option, Order } from "effect";
import {
  calculateJitterStats,
  calculateLatencyStats,
  calculatePacketLossStats,
} from "@/dashboard/charts/stats";
import type { ConnectivityStatus } from "@/dashboard/connectivity";
import type { DateRangeSelection, PresetKey } from "@/dashboard/dateRange";
import type { StatusTone } from "@/ui/statusBadge";

export const formatDurationAgo = (elapsedMs: number): string => {
  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};

export type ConnectionState = ConnectivityStatus | "checking";

export type ConnectionSummary = Readonly<{
  headline: string;
  label: string;
  tone: StatusTone;
}>;

// The label speaks in reachability ("Online"), not in the timeline tooltip's
// per-cycle vocabulary ("Up"). A silent monitor tones neutral, never as an
// outage: it says nothing about the WAN itself.
export const CONNECTION_SUMMARIES: Record<ConnectionState, ConnectionSummary> =
  {
    up: { headline: "Connection is healthy.", label: "Online", tone: "good" },
    degraded: {
      headline: "Connection is degraded.",
      label: "Degraded",
      tone: "warning",
    },
    down: { headline: "Connection is down.", label: "Offline", tone: "error" },
    noInfo: { headline: "No recent data.", label: "No Data", tone: "neutral" },
    checking: {
      headline: "Checking connection…",
      label: "Checking…",
      tone: "neutral",
    },
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
        onNone: () => "no monitoring data",
        onSome: (sampleAtMs) =>
          `last seen ${formatDurationAgo(nowMs - sampleAtMs)}`,
      })
    );
  }
  return Option.map(
    maybeLastSampleAtMs,
    (sampleAtMs) => `last sample ${formatDurationAgo(nowMs - sampleAtMs)}`
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

export const describeRange = (selection: DateRangeSelection): string =>
  M.value(selection).pipe(
    M.tag("Preset", ({ preset }) => PRESET_PHRASES[preset]),
    M.orElse(() => "the selected range")
  );

export const uptimeSummary = (
  maybeUptimePercentage: Option.Option<number>,
  rangePhrase: string
): string =>
  Option.match(maybeUptimePercentage, {
    onNone: () => "No uptime data for this period.",
    onSome: (uptime) => `${uptime.toFixed(1)}% uptime over ${rangePhrase}.`,
  });

/** One headline number with its unit, a caption, and the series behind its sparkline. */
export type Figure = Readonly<{
  label: string;
  value: string;
  unit: string;
  caption: string;
  series: ReadonlyArray<number | null>;
}>;

const chronological = <A extends { readonly timestamp: string }>(
  rows: ReadonlyArray<A>
): ReadonlyArray<A> =>
  Array_.sortWith(rows, (row) => Date.parse(row.timestamp), Order.Number);

const seriesOf = <A extends { readonly timestamp: string }>(
  rows: ReadonlyArray<A>,
  pick: (row: A) => number | undefined
): ReadonlyArray<number | null> =>
  Array_.map(chronological(rows), (row) => pick(row) ?? null);

export const availabilityFigure = (
  maybeAvailabilityPercentage: Option.Option<number>,
  points: ReadonlyArray<{ readonly downPercentage: number }>
): Figure => ({
  label: "Availability",
  value: Option.match(maybeAvailabilityPercentage, {
    onNone: () => "-",
    onSome: (availability) => availability.toFixed(1),
  }),
  unit: "%",
  caption: "up or degraded",
  series: Array_.map(points, (point) => 100 - point.downPercentage),
});

type MetricRow = Pick<
  Metric,
  "timestamp" | "latency" | "packet_loss" | "jitter"
>;

export const latencyFigure = (metrics: ReadonlyArray<MetricRow>): Figure => ({
  label: "Latency",
  value: calculateLatencyStats(metrics).avg,
  unit: "ms",
  caption: "avg",
  series: seriesOf(metrics, (row) => row.latency),
});

export const packetLossFigure = (
  metrics: ReadonlyArray<MetricRow>
): Figure => ({
  label: "Packet loss",
  value: calculatePacketLossStats(metrics).avg,
  unit: "%",
  caption: "avg",
  series: seriesOf(metrics, (row) => row.packet_loss),
});

export const jitterFigure = (metrics: ReadonlyArray<MetricRow>): Figure => ({
  label: "Jitter",
  value: calculateJitterStats(metrics).avg,
  unit: "ms",
  caption: "avg",
  series: seriesOf(metrics, (row) => row.jitter),
});

// A test can exist without one of its two measurements, and a genuine zero is
// a reading, so each half falls back to "-" on its own. Triple-digit speeds
// drop the decimal so the pair still fits a hero tile at display size.
const formatSpeed = (value: number | undefined): string =>
  value === undefined
    ? "-"
    : value >= 100
      ? value.toFixed(0)
      : value.toFixed(1);

export const speedFigure = (
  history: ReadonlyArray<
    Pick<SpeedMetric, "timestamp" | "download_speed" | "upload_speed">
  >,
  nowMs: number
): Figure => {
  const ordered = chronological(history);
  return {
    label: "Download / Upload",
    value: Option.match(Array_.last(ordered), {
      onNone: () => "-",
      onSome: (latest) =>
        `${formatSpeed(latest.download_speed)} / ${formatSpeed(latest.upload_speed)}`,
    }),
    unit: "Mbps",
    caption: Option.match(Array_.last(ordered), {
      onNone: () => "no tests yet",
      onSome: (latest) =>
        `latest test, ${formatDurationAgo(nowMs - Date.parse(latest.timestamp))}`,
    }),
    series: Array_.map(ordered, (row) => row.download_speed ?? null),
  };
};

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
      onNone: () => ({ isp: "Unknown ISP", maybeExternalIp: Option.none() }),
      onSome: (latest) => ({
        isp: latest.isp ?? "Unknown ISP",
        maybeExternalIp: Option.fromNullishOr(latest.external_ip),
      }),
    }
  );

const LAST_TEST_TIME_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

/** "Last test · Oct 15, 2:00 PM · Fremont, CA"; the server clause drops out when unknown. */
export const lastTestLabel = (
  history: ReadonlyArray<Pick<SpeedMetric, "timestamp" | "server_location">>
): Option.Option<string> =>
  Option.map(Array_.last(chronological(history)), (latest) =>
    [
      "Last test",
      new Date(latest.timestamp).toLocaleString([], LAST_TEST_TIME_FORMAT),
      ...(latest.server_location === undefined ? [] : [latest.server_location]),
    ].join(" · ")
  );

export type FetchErrorEntry = Readonly<{
  source: string;
  maybeError: Option.Option<string>;
}>;

/**
 * One line per distinct error, naming every source that hit it, so an outage
 * that fails all three fetches with the same message reads once instead of
 * three times.
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
