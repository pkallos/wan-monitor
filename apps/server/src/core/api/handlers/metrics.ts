import { HttpApiBuilder } from "@effect/platform";
import { WanMonitorApi } from "@shared/api";
import type { GetMetricsQueryParams } from "@shared/api/routes/metrics";
import { Effect, type Schema } from "effect";
import { QuestDB } from "@/infrastructure/database/questdb";

export const getMetricsHandler = ({
  urlParams,
}: {
  urlParams: Schema.Schema.Type<typeof GetMetricsQueryParams>;
}) =>
  Effect.gen(function* () {
    const db = yield* QuestDB;

    const rawData = yield* db.queryMetrics({
      startTime: urlParams.startTime
        ? new Date(urlParams.startTime)
        : undefined,
      endTime: urlParams.endTime ? new Date(urlParams.endTime) : undefined,
      host: urlParams.host,
      limit: urlParams.limit,
      granularity: urlParams.granularity,
    });

    const data = rawData.map((m) => ({
      timestamp: m.timestamp,
      source: m.source,
      host: m.host ?? undefined,
      latency: m.latency ?? undefined,
      jitter: m.jitter ?? undefined,
      packet_loss: m.packet_loss ?? undefined,
      connectivity_status: m.connectivity_status ?? undefined,
      download_speed: m.download_speed ?? undefined,
      upload_speed: m.upload_speed ?? undefined,
      server_location: m.server_location ?? undefined,
      isp: m.isp ?? undefined,
      external_ip: m.external_ip ?? undefined,
      internal_ip: m.internal_ip ?? undefined,
    }));

    return {
      data,
      meta: {
        startTime:
          urlParams.startTime || new Date(Date.now() - 3600000).toISOString(),
        endTime: urlParams.endTime || new Date().toISOString(),
        count: data.length,
      },
    };
  }).pipe(
    Effect.catchAll((error) => Effect.fail(`Failed to query metrics: ${error}`))
  );

export const MetricsGroupLive = HttpApiBuilder.group(
  WanMonitorApi,
  "metrics",
  (handlers) => handlers.handle("getMetrics", getMetricsHandler)
);
