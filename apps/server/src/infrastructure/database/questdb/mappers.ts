import type { Metric } from "@wan-monitor/shared";
import type {
  MetricRowSchema,
  OutageHostRow,
  OutageRun,
  OutageRunRow,
} from "@/infrastructure/database/questdb/model";

const BITS_PER_MEGABIT = 1_000_000;

const toMbps = (
  bitsPerSecond: number | null | undefined
): number | undefined =>
  bitsPerSecond == null ? undefined : bitsPerSecond / BITS_PER_MEGABIT;

/** Renames bandwidth to Mbps speeds and turns every null column into an absent key. */
export const toMetric = (row: typeof MetricRowSchema.Type): Metric => ({
  timestamp: row.timestamp,
  source: row.source,
  host: row.host ?? undefined,
  latency: row.latency ?? undefined,
  latency_p50: row.latency_p50 ?? undefined,
  latency_p95: row.latency_p95 ?? undefined,
  jitter: row.jitter ?? undefined,
  packet_loss: row.packet_loss ?? undefined,
  connectivity_status: row.connectivity_status ?? undefined,
  download_speed: toMbps(row.download_bandwidth),
  upload_speed: toMbps(row.upload_bandwidth),
  server_location: row.server_location ?? undefined,
  isp: row.isp ?? undefined,
  external_ip: row.external_ip ?? undefined,
  internal_ip: row.internal_ip ?? undefined,
});

/** Attaches each run's affected hosts, matched on the run's id. */
export const attachOutageHosts = (
  runs: readonly OutageRunRow[],
  hosts: readonly OutageHostRow[]
): OutageRun[] => {
  const hostsByRun = new Map<number, string[]>();
  for (const { run_id, host } of hosts) {
    const forRun = hostsByRun.get(run_id);
    if (forRun === undefined) {
      hostsByRun.set(run_id, [host]);
    } else {
      forRun.push(host);
    }
  }
  return runs.map((run) => ({
    ...run,
    affected_hosts: hostsByRun.get(run.run_id) ?? [],
  }));
};

/** The measured cycle period in whole milliseconds, or null when unmeasurable. */
export const toCyclePeriodMs = (micros: number | null): number | null =>
  micros === null ? null : Math.round(micros / 1000);
