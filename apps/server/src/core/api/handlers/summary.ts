import { WanMonitorApi } from "@shared/api";
import type { GetSummaryQuery } from "@shared/api/routes/summary";
import type { HostSummary, RangeSummary } from "@wan-monitor/shared";
import { Clock, Effect, type Schema } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import {
  type ConnectivitySummary,
  summarizeConnectivity,
} from "@/core/analytics/rollup";
import { summarizeSpeed } from "@/core/analytics/speed";
import {
  coverageGranularity,
  resolveWindow,
  SUMMARY_WINDOWS_MS,
  type TimeWindow,
  validateWindow,
} from "@/core/analytics/window";
import { withApiErrors } from "@/core/api/handlers/db-error";
import { QuestDB } from "@/infrastructure/database/questdb";
import type {
  HostStatsRow,
  SummaryStatsRow,
} from "@/infrastructure/database/questdb/model";

const DEFAULT_SUMMARY_SPAN_MS = SUMMARY_WINDOWS_MS.last24h;

const toRangeSummary = (
  stats: SummaryStatsRow,
  connectivity: ConnectivitySummary
): RangeSummary => ({
  latencyP50: stats.latency_p50,
  latencyP95: stats.latency_p95,
  avgPacketLoss: stats.avg_packet_loss,
  avgJitter: stats.avg_jitter,
  uptimePercentage: connectivity.uptimePercentage,
  availabilityPercentage: connectivity.availabilityPercentage,
  coveragePercentage: connectivity.coveragePercentage,
});

const toHostSummary = (row: HostStatsRow): HostSummary => ({
  host: row.host,
  latencyP50: row.latency_p50,
  latencyP95: row.latency_p95,
  avgPacketLoss: row.avg_packet_loss,
  avgJitter: row.avg_jitter,
  availabilityPercentage: (row.answered_count / row.total_count) * 100,
  lastStatus: row.last_status,
});

const toDates = ({ startMs, endMs }: TimeWindow) => ({
  startTime: new Date(startMs),
  endTime: new Date(endMs),
});

const loadSummary = (range: TimeWindow) =>
  Effect.gen(function* () {
    const db = yield* QuestDB;

    const connectivityOver = ({ startMs, endMs }: TimeWindow) => {
      const granularity = coverageGranularity(endMs - startMs);
      return db
        .queryConnectivityStatus({
          startTime: new Date(startMs),
          endTime: new Date(endMs),
          granularity,
        })
        .pipe(
          Effect.map((rows) =>
            summarizeConnectivity(rows, startMs, endMs, granularity)
          )
        );
    };

    const rangeSummaryOver = (window: TimeWindow) =>
      Effect.all(
        {
          stats: db.querySummaryStats(toDates(window)),
          connectivity: connectivityOver(window),
        },
        { concurrency: "unbounded" }
      ).pipe(
        Effect.map(({ stats, connectivity }) =>
          toRangeSummary(stats, connectivity)
        )
      );

    const trailingWindow = (spanMs: number): TimeWindow => ({
      startMs: range.endMs - spanMs,
      endMs: range.endMs,
    });

    const uptimeOver = (spanMs: number) =>
      connectivityOver(trailingWindow(spanMs)).pipe(
        Effect.map(({ uptimePercentage }) => ({ uptimePercentage }))
      );

    const results = yield* Effect.all(
      {
        range: rangeSummaryOver(range),
        last24h: uptimeOver(SUMMARY_WINDOWS_MS.last24h),
        last7d: uptimeOver(SUMMARY_WINDOWS_MS.last7d),
        last30d: uptimeOver(SUMMARY_WINDOWS_MS.last30d),
        hosts: db.queryHostStats(toDates(range)),
        speedRows: db.querySpeedtests(toDates(range)),
      },
      { concurrency: "unbounded" }
    );

    return {
      range: results.range,
      windows: {
        last24h: results.last24h,
        last7d: results.last7d,
        last30d: results.last30d,
      },
      hosts: results.hosts.map(toHostSummary),
      speed: summarizeSpeed(results.speedRows),
      meta: {
        startTime: new Date(range.startMs).toISOString(),
        endTime: new Date(range.endMs).toISOString(),
      },
    };
  }).pipe(withApiErrors("Failed to query summary"));

export const getSummaryHandler = ({
  query,
}: {
  query: Schema.Schema.Type<typeof GetSummaryQuery>;
}) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const range = yield* validateWindow(
      resolveWindow(query, now, DEFAULT_SUMMARY_SPAN_MS)
    );
    return yield* loadSummary(range);
  });

export const SummaryGroupLive = HttpApiBuilder.group(
  WanMonitorApi,
  "summary",
  (handlers) => handlers.handle("getSummary", getSummaryHandler)
);
