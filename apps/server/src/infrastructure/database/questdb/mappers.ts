import type {
  ConnectivityStatusRow,
  CycleStatus,
  HostStatsRow,
  LiveConnectivityRow,
  MetricRow,
  OutageHostRow,
  OutageRun,
  OutageRunRow,
  SummaryStatsRow,
} from "@/infrastructure/database/questdb/model";

export const mapMetricRow = (row: Record<string, unknown>): MetricRow =>
  ({
    timestamp: row.timestamp as string,
    source: row.source as "ping" | "speedtest",
    host: row.host as string | undefined,
    latency:
      row.latency !== null && row.latency !== undefined
        ? (row.latency as number)
        : undefined,
    jitter:
      row.jitter !== null && row.jitter !== undefined
        ? (row.jitter as number)
        : undefined,
    packet_loss:
      row.packet_loss !== null && row.packet_loss !== undefined
        ? (row.packet_loss as number)
        : undefined,
    connectivity_status: row.connectivity_status as string | undefined,
    download_speed:
      row.download_bandwidth !== null && row.download_bandwidth !== undefined
        ? (row.download_bandwidth as number) / 1_000_000
        : undefined,
    upload_speed:
      row.upload_bandwidth !== null && row.upload_bandwidth !== undefined
        ? (row.upload_bandwidth as number) / 1_000_000
        : undefined,
    server_location:
      row.server_location !== null && row.server_location !== undefined
        ? (row.server_location as string)
        : undefined,
    isp:
      row.isp !== null && row.isp !== undefined
        ? (row.isp as string)
        : undefined,
    external_ip:
      row.external_ip !== null && row.external_ip !== undefined
        ? (row.external_ip as string)
        : undefined,
    internal_ip:
      row.internal_ip !== null && row.internal_ip !== undefined
        ? (row.internal_ip as string)
        : undefined,
  }) satisfies MetricRow;

// Mirrors `CYCLE_STATUS_CASE`'s own ELSE branch: a cycle that is neither down
// nor degraded is up.
const toCycleStatus = (value: unknown): CycleStatus =>
  value === "down" ? "down" : value === "degraded" ? "degraded" : "up";

export const mapLiveConnectivityRow = (
  row: Record<string, unknown>
): LiveConnectivityRow => ({
  timestamp: row.timestamp as string,
  cycle_status: toCycleStatus(row.cycle_status),
});

export const mapConnectivityStatusRow = (
  row: Record<string, unknown>
): ConnectivityStatusRow => ({
  timestamp: row.timestamp as string,
  up_count: Number(row.up_count ?? 0),
  down_count: Number(row.down_count ?? 0),
  degraded_count: Number(row.degraded_count ?? 0),
  total_count: Number(row.total_count ?? 0),
});

const toNumberOrNull = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

export const mapSummaryStatsRow = (
  row: Record<string, unknown>
): SummaryStatsRow => ({
  latency_p50: toNumberOrNull(row.latency_p50),
  latency_p95: toNumberOrNull(row.latency_p95),
  avg_packet_loss: toNumberOrNull(row.avg_packet_loss),
  avg_jitter: toNumberOrNull(row.avg_jitter),
});

export const mapHostStatsRow = (
  row: Record<string, unknown>
): HostStatsRow => ({
  host: String(row.host),
  latency_p50: toNumberOrNull(row.latency_p50),
  latency_p95: toNumberOrNull(row.latency_p95),
  avg_packet_loss: toNumberOrNull(row.avg_packet_loss),
  avg_jitter: toNumberOrNull(row.avg_jitter),
  answered_count: Number(row.answered_count ?? 0),
  total_count: Number(row.total_count ?? 0),
  last_status: toCycleStatus(row.last_status),
});

export const mapOutageRunRow = (
  row: Record<string, unknown>
): OutageRunRow => ({
  run_id: Number(row.run_id),
  start_time: String(row.start_time),
  last_time: String(row.last_time),
  had_down: Number(row.had_down) > 0,
  max_packet_loss: toNumberOrNull(row.max_packet_loss),
  peak_latency: toNumberOrNull(row.peak_latency),
});

export const mapOutageHostRow = (
  row: Record<string, unknown>
): OutageHostRow => ({
  run_id: Number(row.run_id),
  host: String(row.host),
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
export const mapCyclePeriodMs = (
  row: Record<string, unknown> | undefined
): number | null => {
  const micros = toNumberOrNull(row?.period_micros);
  return micros === null ? null : Math.round(micros / 1000);
};
