import { HttpApiBuilder } from "@effect/platform";
import { WanMonitorApi } from "@shared/api";
import type { GetMetricsQueryParams } from "@shared/api/routes/metrics";
import { Clock, Effect, type Schema } from "effect";
import { mapQueryError } from "@/core/api/handlers/db-error";
import { QuestDB } from "@/infrastructure/database/questdb";

export const getMetricsHandler = ({
  urlParams,
}: {
  urlParams: Schema.Schema.Type<typeof GetMetricsQueryParams>;
}) =>
  Effect.gen(function* () {
    const db = yield* QuestDB;
    const now = yield* Clock.currentTimeMillis;

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
        startTime: urlParams.startTime || new Date(now - 3600000).toISOString(),
        endTime: urlParams.endTime || new Date(now).toISOString(),
        count: data.length,
      },
    };
  }).pipe(Effect.catchAll(mapQueryError("Failed to query metrics")));

export const MetricsGroupLive = HttpApiBuilder.group(
  WanMonitorApi,
  "metrics",
  (handlers) => handlers.handle("getMetrics", getMetricsHandler)
);
