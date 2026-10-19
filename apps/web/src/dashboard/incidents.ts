import type { Outage } from "@shared/api/routes/connectivity-status";
import {
  LIVE_WINDOW_MIN_SECONDS,
  liveConnectivityWindowSeconds,
  MAX_OUTAGE_SPAN_DAYS,
} from "@wan-monitor/shared";
import { Array as Array_, Option, Schema as S } from "effect";
import {
  counted,
  formatClock,
  formatLongDuration,
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
  degradedSeconds: number;
}>;

export const outageTotals = (
  outages: ReadonlyArray<Pick<Outage, "status" | "durationSeconds">>
): OutageTotals =>
  Array_.reduce(
    outages,
    { outageCount: 0, degradedCount: 0, downSeconds: 0, degradedSeconds: 0 },
    (totals, outage) =>
      outage.status === "down"
        ? {
            ...totals,
            outageCount: totals.outageCount + 1,
            downSeconds: totals.downSeconds + outage.durationSeconds,
          }
        : {
            ...totals,
            degradedCount: totals.degradedCount + 1,
            degradedSeconds: totals.degradedSeconds + outage.durationSeconds,
          }
  );

/**
 * What the outage log held for the range, in one sentence under the uptime
 * figure: "Down for 51 minutes and degraded for 1 hour 30 minutes.", or that
 * there were no outages.
 */
export const describeOutageLine = (
  { outageCount, degradedCount, downSeconds, degradedSeconds }: OutageTotals,
  isClamped: boolean
): string => {
  const parts = [
    ...(outageCount > 0 ? [`down for ${formatLongDuration(downSeconds)}`] : []),
    ...(degradedCount > 0
      ? [`degraded for ${formatLongDuration(degradedSeconds)}`]
      : []),
  ];
  if (parts.length === 0) {
    return `No outages in ${isClamped ? CLAMPED_WINDOW_PHRASE : "this period"}.`;
  }
  const sentence = `${parts.join(" and ")}${isClamped ? ` in ${CLAMPED_WINDOW_PHRASE}` : ""}`;
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
};

/**
 * The incident log's own summary, for a log with at least one incident: "3
 * incidents in the last 30 days: 2 outages lasting 1 hour 15 minutes in total,
 * and 1 degraded period of 30 minutes."
 */
export const describeIncidents = (
  { outageCount, degradedCount, downSeconds, degradedSeconds }: OutageTotals,
  windowPhrase: string
): string => {
  const kinds = [
    ...(outageCount > 0
      ? [
          outageCount === 1
            ? `1 outage lasting ${formatLongDuration(downSeconds)}`
            : `${outageCount} outages lasting ${formatLongDuration(downSeconds)} in total`,
        ]
      : []),
    ...(degradedCount > 0
      ? [
          degradedCount === 1
            ? `1 degraded period of ${formatLongDuration(degradedSeconds)}`
            : `${degradedCount} degraded periods of ${formatLongDuration(degradedSeconds)} in total`,
        ]
      : []),
  ];
  return `${counted(outageCount + degradedCount, "incident")} in ${windowPhrase}: ${kinds.join(", and ")}.`;
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
export const CLAMPED_WINDOW_PHRASE = `the newest ${MAX_OUTAGE_SPAN_DAYS} days`;

export const outageLogPhrase = (
  isClamped: boolean,
  rangePhrase: string
): string => (isClamped ? CLAMPED_WINDOW_PHRASE : rangePhrase);

/** How many hosts are configured when the outage hit every one of them (and there is more than one). */
const everyConfiguredCount = (
  hosts: ReadonlyArray<string>,
  maybeConfiguredHosts: Option.Option<ReadonlyArray<string>>
): Option.Option<number> =>
  Option.map(
    Option.filter(
      maybeConfiguredHosts,
      (configured) =>
        configured.length > 1 &&
        Array_.every(configured, (host) => Array_.contains(hosts, host))
    ),
    (configured) => configured.length
  );

/** The failing hosts, or "All N hosts" when the outage hit every configured target. */
export const affectedHostsText = (
  hosts: ReadonlyArray<string>,
  maybeConfiguredHosts: Option.Option<ReadonlyArray<string>>
): string => {
  if (hosts.length === 0) return "-";
  return Option.match(everyConfiguredCount(hosts, maybeConfiguredHosts), {
    onNone: () => hosts.join(", "),
    onSome: (count) => `All ${count} hosts`,
  });
};

export const lossText = (loss: number): string =>
  Number.isInteger(loss) ? `${loss}%` : `${loss.toFixed(1)}%`;

/** A dash when every sample failed, so there was no latency to report. */
export const peakText = (peakLatency: number | null): string =>
  peakLatency === null ? "-" : `${peakLatency.toFixed(0)} ms`;

/**
 * How long before the fetch an outage may have ended and still read as open:
 * the live window, which is how long the newest ping stands.
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
 * The incident still running, if there is one: the newest outage, when the
 * live status is degraded or down, the range reaches the present, and the
 * outage ends at or near the time the log was fetched. A range that ended
 * before the fetch has no running incident.
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

const joinWithAnd = (items: ReadonlyArray<string>): string =>
  items.length <= 2
    ? items.join(" and ")
    : `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;

/** Who lost packets, as a sentence subject: "1.1.1.1", "1.1.1.1 and 8.8.8.8", "all 3 hosts". */
const hostsSubject = (
  hosts: ReadonlyArray<string>,
  maybeConfiguredHosts: Option.Option<ReadonlyArray<string>>
): Option.Option<Readonly<{ text: string; isPlural: boolean }>> => {
  if (hosts.length === 0) return Option.none();
  return Option.some(
    Option.match(everyConfiguredCount(hosts, maybeConfiguredHosts), {
      onNone: () => ({ text: joinWithAnd(hosts), isPlural: hosts.length > 1 }),
      onSome: (count) => ({ text: `all ${count} hosts`, isPlural: true }),
    })
  );
};

/** What the running incident has done, completing "Since 2:10 PM, ...": the clause, or none with nothing to say. */
const openIncidentClause = (
  {
    affectedHosts,
    maxPacketLoss,
  }: Pick<Outage, "affectedHosts" | "maxPacketLoss">,
  maybeConfiguredHosts: Option.Option<ReadonlyArray<string>>
): Option.Option<string> => {
  const lost = `up to ${lossText(maxPacketLoss)} of packets`;
  return Option.match(hostsSubject(affectedHosts, maybeConfiguredHosts), {
    onNone: () =>
      maxPacketLoss > 0 ? Option.some(`${lost} have been lost`) : Option.none(),
    onSome: ({ text, isPlural }) =>
      Option.some(
        maxPacketLoss > 0
          ? `${text} ${isPlural ? "have" : "has"} lost ${lost}`
          : `${text} ${isPlural ? "have" : "has"} been affected`
      ),
  });
};

export type OpenIncidentSentence = Readonly<{
  /** When it began: "Since 2:10 PM". */
  since: string;
  /** The rest of the sentence, from its comma to its full stop. */
  rest: string;
}>;

/** "Since 2:10 PM, 1.1.1.1 has lost up to 100% of packets.", split where the time ends. */
export const openIncidentSentence = (
  outage: Pick<Outage, "start" | "affectedHosts" | "maxPacketLoss">,
  maybeConfiguredHosts: Option.Option<ReadonlyArray<string>>,
  nowMs: number
): OpenIncidentSentence => {
  const start = new Date(outage.start);
  const clock = formatClock(start.getTime());
  return {
    since: `Since ${
      isSameLocalDay(start.getTime(), nowMs)
        ? clock
        : `${start.toLocaleDateString([], { month: "short", day: "numeric" })}, ${clock}`
    }`,
    rest: Option.match(openIncidentClause(outage, maybeConfiguredHosts), {
      onNone: () => ".",
      onSome: (clause) => `, ${clause}.`,
    }),
  };
};

/** The stacked incident card's second line: "1.1.1.1, 8.8.8.8. Max loss 100%, peak latency 44 ms." */
export const incidentDetails = (
  hosts: string,
  maxPacketLoss: number,
  peakLatency: number | null
): string =>
  `${hosts === "-" ? "" : `${hosts}. `}Max loss ${lossText(maxPacketLoss)}${peakLatency === null ? "" : `, peak latency ${peakText(peakLatency)}`}.`;
