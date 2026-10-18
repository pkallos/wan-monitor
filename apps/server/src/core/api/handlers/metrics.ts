import { WanMonitorApi } from "@shared/api";
import type { GetMetricsQueryParams } from "@shared/api/routes/metrics";
import { Clock, Effect, type Schema } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import {
  resolveWindow,
  type TimeWindow,
  validateWindow,
} from "@/core/analytics/window";
import { withApiErrors } from "@/core/api/handlers/db-error";
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
    const data = yield* db.queryMetrics({
      startTime,
      endTime,
      host: query.host,
      limit: query.limit,
      granularity: query.granularity,
      source: query.source,
      percentiles: query.percentiles,
    });

    return {
      data,
      meta: {
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        count: data.length,
      },
    };
  }).pipe(withApiErrors("Failed to query metrics"));

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
  }).pipe(withApiErrors("Failed to query earliest timestamp"));

export const MetricsGroupLive = HttpApiBuilder.group(
  WanMonitorApi,
  "metrics",
  (handlers) =>
    handlers
      .handle("getMetrics", getMetricsHandler)
      .handle("getEarliestTimestamp", getEarliestTimestampHandler)
);
