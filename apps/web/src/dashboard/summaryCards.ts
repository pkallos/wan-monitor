import type { Metric } from "@shared/api/routes/metrics";
import type { SpeedMetric } from "@shared/api/routes/speedtest";
import { Array as Array_, Option } from "effect";

export type CardStatus = "good" | "warning" | "error";

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

export const connectivityCard = (
  metrics: ReadonlyArray<Pick<Metric, "connectivity_status" | "timestamp">>
): SummaryCard =>
  Option.match(Array_.head(metrics), {
    onNone: () => ({
      title: "Connectivity",
      value: "Offline",
      status: Option.some("error" as const),
      subtitle: Option.none(),
    }),
    onSome: (latest) => {
      const isUp = latest.connectivity_status === "up";
      return {
        title: "Connectivity",
        value: isUp ? "Online" : "Offline",
        status: Option.some(isUp ? ("good" as const) : ("error" as const)),
        subtitle: Option.some(formatTimeAgo(latest.timestamp)),
      };
    },
  });

const speedCard = (
  title: string,
  history: ReadonlyArray<{ readonly value: number; readonly timestamp: string }>
): SummaryCard =>
  Option.match(Array_.head(history), {
    onNone: () => ({
      title,
      value: "- Mbps",
      status: Option.none(),
      subtitle: Option.none(),
    }),
    onSome: (latest) => ({
      title,
      value: `${latest.value.toFixed(1)} Mbps`,
      status: Option.some("good" as const),
      subtitle: Option.some(formatTimeAgo(latest.timestamp)),
    }),
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

export const networkInfo = (
  history: ReadonlyArray<Pick<SpeedMetric, "isp" | "external_ip">>
): NetworkInfo =>
  Option.match(Array_.head(history), {
    onNone: () => ({ isp: "Unknown ISP", maybeExternalIp: Option.none() }),
    onSome: (latest) => ({
      isp: latest.isp ?? "Unknown ISP",
      maybeExternalIp: Option.fromNullishOr(latest.external_ip),
    }),
  });
