import type { HostSummary } from "@shared/api/routes/summary";
import { Array as Array_, Option } from "effect";
import { everyInterval, fixed } from "@/dashboard/format";

export type HostTone = "good" | "warning" | "error" | "none";

export type HostRow = Readonly<{
  host: string;
  tone: HostTone;
  statusWord: string;
  p50: string;
  p95: string;
  loss: string;
  jitter: string;
  availability: string;
}>;

const STATUS: Record<
  HostSummary["lastStatus"],
  { tone: HostTone; word: string }
> = {
  up: { tone: "good", word: "Up" },
  degraded: { tone: "warning", word: "Degraded" },
  down: { tone: "error", word: "Down" },
};

const summaryRow = (host: HostSummary): HostRow => ({
  host: host.host,
  tone: STATUS[host.lastStatus].tone,
  statusWord: STATUS[host.lastStatus].word,
  p50: fixed(host.latencyP50, 1, " ms"),
  p95: fixed(host.latencyP95, 1, " ms"),
  loss: fixed(host.avgPacketLoss, 2, "%"),
  jitter: fixed(host.avgJitter, 1, " ms"),
  availability: fixed(host.availabilityPercentage, 2, "%"),
});

const noDataRow = (host: string): HostRow => ({
  host,
  tone: "none",
  statusWord: "No data",
  p50: "-",
  p95: "-",
  loss: "-",
  jitter: "-",
  availability: "-",
});

/**
 * One row per host the summary reports, plus a "No data" row for each
 * configured host it omits, in the configured order. A summary that reports no
 * host at all is an empty range, not a row of gaps.
 */
export const hostRows = (
  hosts: ReadonlyArray<HostSummary>,
  maybeConfigured: Option.Option<ReadonlyArray<string>> = Option.none()
): ReadonlyArray<HostRow> => {
  if (hosts.length === 0) return [];
  const configured = Option.getOrElse(maybeConfigured, () => []);
  const reported = new Map(Array_.map(hosts, (host) => [host.host, host]));
  return [
    ...Array_.map(configured, (name) => {
      const maybeHost = reported.get(name);
      return maybeHost === undefined ? noDataRow(name) : summaryRow(maybeHost);
    }),
    ...Array_.map(
      Array_.filter(hosts, ({ host }) => !Array_.contains(configured, host)),
      summaryRow
    ),
  ];
};

export const hostsCaption = (
  hostCount: number,
  pingIntervalSeconds: number
): string =>
  `${hostCount} ${hostCount === 1 ? "host" : "hosts"} · ping ${everyInterval(pingIntervalSeconds)}`;
