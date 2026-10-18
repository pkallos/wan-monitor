import { WanMonitorApi } from "@shared/api";
import type { GetMetricsQueryParams } from "@shared/api/routes/metrics";
import { Clock, Effect, type Schema } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import {
  resolveWindow,
  type TimeWindow,
  validateWindow,
} from "@/core/analytics/window";
import { mapQueryError } from "@/core/api/handlers/db-error";
import { QuestDB } from "@/infrastructure/database/questdb";

const DEFAULT_METRICS_SPAN_MS = 60 * 60 * 1000;

const loadMetrics = (
  query: Schema.Schema.Type<typeof GetMetricsQueryParams>,
  { startMs, endMs }: TimeWindow
) =>
  Effect.gen(function* () {
    const db = yield* QuestDB;

    const startTime = new Date(startMs);
    const endTime = new Date(endMs);
    const rawData = yield* db.queryMetrics({
      startTime,
      endTime,
      host: query.host,
      limit: query.limit,
      granularity: query.granularity,
      source: query.source,
      percentiles: query.percentiles,
    });

    const data = rawData.map((m) => ({
      timestamp: m.timestamp,
      source: m.source,
      host: m.host ?? undefined,
      latency: m.latency ?? undefined,
      latency_p50: m.latency_p50 ?? undefined,
      latency_p95: m.latency_p95 ?? undefined,
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
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        count: data.length,
      },
    };
  }).pipe(Effect.catch(mapQueryError("Failed to query metrics")));

export const getMetricsHandler = ({
  query,
}: {
  query: Schema.Schema.Type<typeof GetMetricsQueryParams>;
}) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const window = yield* validateWindow(
      resolveWindow(query, now, DEFAULT_METRICS_SPAN_MS)
    );
    return yield* loadMetrics(query, window);
  });

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
