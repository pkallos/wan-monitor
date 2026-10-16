import type { Outage } from "@shared/api/routes/connectivity-status";
import {
  LIVE_WINDOW_MIN_SECONDS,
  liveConnectivityWindowSeconds,
  MAX_OUTAGE_SPAN_DAYS,
} from "@wan-monitor/shared";
import { Array as Array_, Option, Schema as S } from "effect";
import {
  formatClock,
  formatDuration,
  isSameLocalDay,
} from "@/dashboard/format";
import type { OutagesData } from "@/dashboard/model";
import type { ConnectionState } from "@/dashboard/overview";

/** What the charts need to mark an outage: where it sits, how bad, and its letter. */
export const Incident = S.Struct({
  ref: S.String,
  startMs: S.Number,
  endMs: S.Number,
  status: S.Literals(["down", "degraded"]),
});
export type Incident = typeof Incident.Type;

const ALPHABET_LENGTH = 26;
const LETTER_A = 65;

/** A, B, ... Z, AA, AB, ...: bijective base 26, so a long log never runs out of refs. */
export const refLabel = (index: number): string => {
  const letter = String.fromCharCode(LETTER_A + (index % ALPHABET_LENGTH));
  const rest = Math.floor(index / ALPHABET_LENGTH);
  return rest === 0 ? letter : `${refLabel(rest - 1)}${letter}`;
};

/**
 * Pairs each outage with its ref. The endpoint answers newest first, but the
 * oldest outage is A: a new outage takes the next letter instead of renaming
 * every older one.
 */
export const assignIncidents = (
  newestFirst: ReadonlyArray<Outage>
): ReadonlyArray<Incident> =>
  Array_.map(newestFirst, (outage, index) => ({
    ref: refLabel(newestFirst.length - 1 - index),
    startMs: Date.parse(outage.start),
    endMs: Date.parse(outage.end),
    status: outage.status,
  }));

export type OutageTotals = Readonly<{
  outageCount: number;
  degradedCount: number;
  downSeconds: number;
}>;

export const outageTotals = (
  outages: ReadonlyArray<Pick<Outage, "status" | "durationSeconds">>
): OutageTotals =>
  Array_.reduce(
    outages,
    { outageCount: 0, degradedCount: 0, downSeconds: 0 },
    (totals, outage) =>
      outage.status === "down"
        ? {
            ...totals,
            outageCount: totals.outageCount + 1,
            downSeconds: totals.downSeconds + outage.durationSeconds,
          }
        : { ...totals, degradedCount: totals.degradedCount + 1 }
  );

/** "2 down, 2 degraded, 18m 30s down", or that nothing happened. */
export const describeTotals = ({
  outageCount,
  degradedCount,
  downSeconds,
}: OutageTotals): string => {
  const parts = [
    ...(outageCount > 0 ? [`${outageCount} down`] : []),
    ...(degradedCount > 0 ? [`${degradedCount} degraded`] : []),
    ...(downSeconds > 0 ? [`${formatDuration(downSeconds)} down`] : []),
  ];
  return parts.length === 0 ? "No incidents" : parts.join(", ");
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The outage log refuses a window wider than `MAX_OUTAGE_SPAN_DAYS`, so a
 * wider range is cut to its newest days, and the flag lets the card say so.
 */
export const outageWindow = (window: {
  startTime: string;
  endTime: string;
}): Readonly<{ startTime: string; endTime: string; isClamped: boolean }> => {
  const endMs = Date.parse(window.endTime);
  const earliestMs = endMs - MAX_OUTAGE_SPAN_DAYS * DAY_MS;
  return Date.parse(window.startTime) < earliestMs
    ? {
        startTime: new Date(earliestMs).toISOString(),
        endTime: window.endTime,
        isClamped: true,
      }
    : { ...window, isClamped: false };
};

/**
 * What to call the window the outage totals cover: the range's own phrase, or
 * the newest `MAX_OUTAGE_SPAN_DAYS` days when the log had to be clamped to them.
 */
export const CLAMPED_WINDOW_PHRASE = `the last ${MAX_OUTAGE_SPAN_DAYS} days`;

export const outageLogPhrase = (
  isClamped: boolean,
  rangePhrase: string
): string => (isClamped ? CLAMPED_WINDOW_PHRASE : rangePhrase);

/** The failing hosts, or "All N hosts" when the outage hit every configured target. */
export const affectedHostsText = (
  hosts: ReadonlyArray<string>,
  maybeConfiguredHosts: Option.Option<ReadonlyArray<string>>
): string => {
  if (hosts.length === 0) return "-";
  const maybeEveryConfigured = Option.filter(
    maybeConfiguredHosts,
    (configured) =>
      configured.length > 1 &&
      Array_.every(configured, (host) => Array_.contains(hosts, host))
  );
  return Option.match(maybeEveryConfigured, {
    onNone: () => hosts.join(", "),
    onSome: (configured) => `All ${configured.length} hosts`,
  });
};

export const lossText = (loss: number): string =>
  Number.isInteger(loss) ? `${loss}%` : `${loss.toFixed(1)}%`;

/** A dash when every sample failed, so there was no latency to report. */
export const peakText = (peakLatency: number | null): string =>
  peakLatency === null ? "-" : `${peakLatency.toFixed(0)} ms`;

/**
 * How stale the newest cycle may be while the live status still reports it:
 * the live status's own window, so a log fetched in that gap can end an
 * outage slightly before the fetch.
 */
const openIncidentSlackMs = (
  maybePingIntervalSeconds: Option.Option<number>
): number =>
  1000 *
  Option.match(maybePingIntervalSeconds, {
    onNone: () => LIVE_WINDOW_MIN_SECONDS,
    onSome: liveConnectivityWindowSeconds,
  });

/**
 * The incident still running, if there is one. A running outage ends one cycle
 * after its newest non-up cycle, clipped to the range end, so it is open when
 * the range reaches the present and the outage ends at or near the time the
 * log was fetched. A range that ended earlier has nothing running in it, and
 * the live status then confirms the connection has not recovered since.
 */
export const openIncident = (
  { log, fetchedAtMs }: Pick<OutagesData, "log" | "fetchedAtMs">,
  liveStatus: ConnectionState,
  maybePingIntervalSeconds: Option.Option<number>
): Option.Option<Outage> => {
  if (liveStatus !== "degraded" && liveStatus !== "down") return Option.none();
  if (Date.parse(log.meta.endTime) < fetchedAtMs) return Option.none();
  const slackMs = openIncidentSlackMs(maybePingIntervalSeconds);
  return Option.filter(
    Array_.head(log.data),
    (newest) => Date.parse(newest.end) >= fetchedAtMs - slackMs
  );
};

export type OpenIncidentParts = Readonly<{
  since: string;
  details: ReadonlyArray<string>;
}>;

/** When the incident began, then the failing hosts and the worst loss: whatever it has. */
export const openIncidentParts = (
  outage: Pick<Outage, "start" | "affectedHosts" | "maxPacketLoss">,
  maybeConfiguredHosts: Option.Option<ReadonlyArray<string>>,
  nowMs: number
): OpenIncidentParts => {
  const start = new Date(outage.start);
  const clock = formatClock(start.getTime());
  const hosts = affectedHostsText(outage.affectedHosts, maybeConfiguredHosts);
  return {
    since: `Since ${
      isSameLocalDay(start.getTime(), nowMs)
        ? clock
        : `${start.toLocaleDateString([], { month: "short", day: "numeric" })}, ${clock}`
    }`,
    details: [
      ...(hosts === "-" ? [] : [hosts]),
      ...(outage.maxPacketLoss > 0
        ? [`up to ${lossText(outage.maxPacketLoss)} loss`]
        : []),
    ],
  };
};
