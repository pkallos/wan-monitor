import type {
  ConnectivityStatusRow,
  MetricRow,
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
    download_speed: row.download_bandwidth
      ? (row.download_bandwidth as number) / 1_000_000
      : undefined,
    upload_speed: row.upload_bandwidth
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

export const mapConnectivityStatusRow = (
  row: Record<string, unknown>
): ConnectivityStatusRow => ({
  timestamp: row.timestamp as string,
  up_count: Number(row.up_count ?? 0),
  down_count: Number(row.down_count ?? 0),
  degraded_count: Number(row.degraded_count ?? 0),
  total_count: Number(row.total_count ?? 0),
});
