import type { Metric } from "@wan-monitor/shared";
import {
  type MetricRowSchema,
  type OutageRun,
  type OutageRunHostRow,
  type WindowUptime,
  type WindowUptimeRow,
  windowColumn,
} from "@/infrastructure/database/questdb/model";

const BITS_PER_MEGABIT = 1_000_000;

const toMbps = (
  bitsPerSecond: number | null | undefined
): number | undefined =>
  bitsPerSecond == null ? undefined : bitsPerSecond / BITS_PER_MEGABIT;

/** Converts bandwidth in bits per second to Mbps speeds, and turns every null column into an absent key. */
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

const maxOf = (current: number | null, next: number | null): number | null => {
  if (next === null) {
    return current;
  }
  return current === null ? next : Math.max(current, next);
};

/**
 * Folds the (run, host) rows of `buildQueryOutageRuns`, ordered by run, into
 * one run each. The run's worst loss and peak latency are the worst over its
 * rows, and the query reports them only for qualifying pings, so a run no ping
 * qualifies for has none.
 */
export const toOutageRuns = (
  rows: readonly OutageRunHostRow[]
): OutageRun[] => {
  const runs = new Map<number, OutageRun>();
  for (const row of rows) {
    const run = runs.get(row.run_id);
    const affectedBefore = run?.affected_hosts ?? [];
    runs.set(row.run_id, {
      run_id: row.run_id,
      start_time: row.start_time,
      end_time: row.end_time,
      had_down: row.had_down,
      max_packet_loss: maxOf(run?.max_packet_loss ?? null, row.max_packet_loss),
      peak_latency: maxOf(run?.peak_latency ?? null, row.peak_latency),
      affected_hosts: row.affected
        ? [...affectedBefore, row.host]
        : affectedBefore,
    });
  }
  return [...runs.values()];
};

/** Reads the first `count` windows' columns of the window uptime row; a null sum is no time. */
export const toWindowUptimes = (
  row: WindowUptimeRow,
  count: number
): WindowUptime[] =>
  Array.from({ length: count }, (_, i) => ({
    up_micros: row[windowColumn("up", i)] ?? 0,
    observed_micros: row[windowColumn("observed", i)] ?? 0,
  }));
