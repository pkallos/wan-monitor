import type { SpeedMetric } from "@shared/api/routes/speedtest";
import { Array as Array_, Option } from "effect";
import type { ConnectivityStatus } from "@/dashboard/connectivity";

export type CardStatus = "good" | "warning" | "error" | "neutral";

export interface SummaryCard {
  readonly title: string;
  readonly value: string;
  readonly status: Option.Option<CardStatus>;
  readonly subtitle: Option.Option<string>;
}

export const formatDurationAgo = (elapsedMs: number): string => {
  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};

const formatTimeAgo = (timestamp: string): string =>
  `as of ${formatDurationAgo(Date.now() - new Date(timestamp).getTime())}`;

const CONNECTIVITY_CARD_TITLE = "Connectivity";

// The card speaks in reachability ("Online"), not in the timeline tooltip's
// per-cycle vocabulary ("Up"), so it keeps its own labels.
const LIVE_CONNECTIVITY_VALUES: Record<ConnectivityStatus, string> = {
  up: "Online",
  degraded: "Degraded",
  down: "Offline",
  noInfo: "No Data",
};

const LIVE_CONNECTIVITY_CARD_STATUS: Record<ConnectivityStatus, CardStatus> = {
  up: "good",
  degraded: "warning",
  down: "error",
  // Grey, never red: the monitor going quiet says nothing about the WAN.
  noInfo: "neutral",
};

/** Shown until the first live response lands, so the card doesn't flash a
 *  false "No Data" on load. */
export const CHECKING_CONNECTIVITY_CARD: SummaryCard = {
  title: CONNECTIVITY_CARD_TITLE,
  value: "Checking…",
  status: Option.none(),
  subtitle: Option.none(),
};

export interface LiveConnectivity {
  readonly status: ConnectivityStatus;
  readonly maybeLastSampleAtMs: Option.Option<number>;
}

const liveConnectivitySubtitle = (
  live: LiveConnectivity,
  nowMs: number
): Option.Option<string> =>
  live.status === "noInfo"
    ? Option.some(
        Option.match(live.maybeLastSampleAtMs, {
          onNone: () => "no monitoring data",
          onSome: (sampleAtMs) =>
            `last seen ${formatDurationAgo(nowMs - sampleAtMs)}`,
        })
      )
    : Option.map(
        live.maybeLastSampleAtMs,
        (sampleAtMs) => `as of ${formatDurationAgo(nowMs - sampleAtMs)}`
      );

export const liveConnectivityCard = (
  live: LiveConnectivity,
  nowMs: number
): SummaryCard => ({
  title: CONNECTIVITY_CARD_TITLE,
  value: LIVE_CONNECTIVITY_VALUES[live.status],
  status: Option.some(LIVE_CONNECTIVITY_CARD_STATUS[live.status]),
  subtitle: liveConnectivitySubtitle(live, nowMs),
});

const speedCard = (
  title: string,
  history: ReadonlyArray<{
    readonly value: number | undefined;
    readonly timestamp: string;
  }>
): SummaryCard =>
  Option.match(Array_.head(history), {
    onNone: () => ({
      title,
      value: "- Mbps",
      status: Option.none(),
      subtitle: Option.none(),
    }),
    // A reading can exist without this particular measurement, so an absent
    // value renders as the same placeholder an absent reading does.
    onSome: (latest) =>
      latest.value === undefined
        ? {
            title,
            value: "- Mbps",
            status: Option.none(),
            subtitle: Option.some(formatTimeAgo(latest.timestamp)),
          }
        : {
            title,
            value: `${latest.value.toFixed(1)} Mbps`,
            status: Option.some("good" as const),
            subtitle: Option.some(formatTimeAgo(latest.timestamp)),
          },
  });

export const downloadSpeedCard = (
  history: ReadonlyArray<Pick<SpeedMetric, "download_speed" | "timestamp">>
): SummaryCard =>
  speedCard(
    "Download Speed",
    Array_.map(history, (m) => ({
      value: m.download_speed,
      timestamp: m.timestamp,
    }))
  );

export const uploadSpeedCard = (
  history: ReadonlyArray<Pick<SpeedMetric, "upload_speed" | "timestamp">>
): SummaryCard =>
  speedCard(
    "Upload Speed",
    Array_.map(history, (m) => ({
      value: m.upload_speed,
      timestamp: m.timestamp,
    }))
  );

export interface NetworkInfo {
  readonly isp: string;
  readonly maybeExternalIp: Option.Option<string>;
}

/** Reads from the newest sample that actually carries an ISP, so a failed
 *  speed test — which records a row with no ISP — doesn't blank the header
 *  while a good reading from an hour earlier is still on hand. */
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
