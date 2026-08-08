import { WanMonitorApi } from "@shared/api";
import type { GetMetricsQueryParams } from "@shared/api/routes/metrics";
import { Clock, Effect, type Schema } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { mapQueryError } from "@/core/api/handlers/db-error";
import { QuestDB } from "@/infrastructure/database/questdb";

export const getMetricsHandler = ({
  query,
}: {
  query: Schema.Schema.Type<typeof GetMetricsQueryParams>;
}) =>
  Effect.gen(function* () {
    const db = yield* QuestDB;
    const now = yield* Clock.currentTimeMillis;

    const rawData = yield* db.queryMetrics({
      startTime: query.startTime ? new Date(query.startTime) : undefined,
      endTime: query.endTime ? new Date(query.endTime) : undefined,
      host: query.host,
      limit: query.limit,
      granularity: query.granularity,
      source: query.source,
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
        startTime: query.startTime || new Date(now - 3600000).toISOString(),
        endTime: query.endTime || new Date(now).toISOString(),
        count: data.length,
      },
    };
  }).pipe(Effect.catch(mapQueryError("Failed to query metrics")));

export const getEarliestTimestampHandler = () =>
  Effect.gen(function* () {
    const db = yield* QuestDB;
    const timestamp = yield* db.queryEarliestTimestamp();
    return { timestamp };
  }).pipe(Effect.catch(mapQueryError("Failed to query earliest timestamp")));

export const MetricsGroupLive = HttpApiBuilder.group(
  WanMonitorApi,
  "metrics",
  (handlers) =>
    handlers
      .handle("getMetrics", getMetricsHandler)
      .handle("getEarliestTimestamp", getEarliestTimestampHandler)
);
