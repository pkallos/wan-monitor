import type { Sender } from "@questdb/nodejs-client";
import type { NetworkMetric } from "@wan-monitor/shared/metrics";

export const writeMetricToSender = (
  sender: Sender,
  metric: NetworkMetric
): void => {
  let row = sender.table("network_metrics").symbol("source", metric.source);

  if (metric.host) row = row.symbol("host", metric.host);
  if (metric.latency !== undefined)
    row = row.floatColumn("latency", metric.latency);
  if (metric.jitter !== undefined)
    row = row.floatColumn("jitter", metric.jitter);
  if (metric.packetLoss !== undefined)
    row = row.floatColumn("packet_loss", metric.packetLoss);
  if (metric.connectivityStatus)
    row = row.stringColumn("connectivity_status", metric.connectivityStatus);
  if (metric.downloadBandwidth !== undefined)
    row = row.intColumn("download_bandwidth", metric.downloadBandwidth);
  if (metric.uploadBandwidth !== undefined)
    row = row.intColumn("upload_bandwidth", metric.uploadBandwidth);
  if (metric.serverLocation)
    row = row.stringColumn("server_location", metric.serverLocation);
  if (metric.isp) row = row.stringColumn("isp", metric.isp);
  if (metric.externalIp)
    row = row.stringColumn("external_ip", metric.externalIp);
  if (metric.internalIp)
    row = row.stringColumn("internal_ip", metric.internalIp);

  row.at(BigInt(metric.timestamp.getTime()) * 1_000_000n, "ns");
};
