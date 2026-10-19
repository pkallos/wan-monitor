import { WanMonitorApi } from "@shared/api";
import type { GetSummaryQuery } from "@shared/api/routes/summary";
import type { HostSummary, RangeSummary } from "@wan-monitor/shared";
import { Clock, Effect, type Schema } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { summarizeSpeed } from "@/core/analytics/speed";
import {
  resolveWindow,
  SUMMARY_WINDOWS_MS,
  type TimeWindow,
  validateWindow,
} from "@/core/analytics/window";
import { withApiErrors } from "@/core/api/handlers/db-error";
import { ConfigService } from "@/infrastructure/config/config";
import { QuestDB } from "@/infrastructure/database/questdb";
import type {
  HostStatsRow,
  SummaryStatsRow,
  WindowUptime,
} from "@/infrastructure/database/questdb/model";

const DEFAULT_SUMMARY_SPAN_MS = SUMMARY_WINDOWS_MS.last24h;

const toRangeSummary = (stats: SummaryStatsRow): RangeSummary => ({
  latencyP50: stats.latency_p50,
  latencyP95: stats.latency_p95,
  avgPacketLoss: stats.avg_packet_loss,
  avgJitter: stats.avg_jitter,
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

const toUptimeWindow = (window: WindowUptime | undefined) => ({
  uptimePercentage:
    window === undefined || window.observed_micros === 0
      ? null
      : (window.up_micros / window.observed_micros) * 100,
});

const toDates = ({ startMs, endMs }: TimeWindow) => ({
  startTime: new Date(startMs),
  endTime: new Date(endMs),
});

const loadSummary = (range: TimeWindow, nowMs: number) =>
  Effect.gen(function* () {
    const db = yield* QuestDB;
    const config = yield* ConfigService;

    const windowStartTimes = [
      SUMMARY_WINDOWS_MS.last24h,
      SUMMARY_WINDOWS_MS.last7d,
      SUMMARY_WINDOWS_MS.last30d,
    ].map((spanMs) => new Date(range.endMs - spanMs));

    const results = yield* Effect.all(
      {
        stats: db.querySummaryStats(toDates(range)),
        uptimes: db.queryWindowUptime({
          endTime: new Date(range.endMs),
          nowMs,
          intervalMs: config.ping.intervalSeconds * 1000,
          hosts: config.ping.hosts,
          windowStartTimes,
        }),
        hosts: db.queryHostStats(toDates(range)),
        speedRows: db.querySpeedtests(toDates(range)),
      },
      { concurrency: "unbounded" }
    );

    return {
      range: toRangeSummary(results.stats),
      windows: {
        last24h: toUptimeWindow(results.uptimes[0]),
        last7d: toUptimeWindow(results.uptimes[1]),
        last30d: toUptimeWindow(results.uptimes[2]),
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
    return yield* loadSummary(range, now);
  });

export const SummaryGroupLive = HttpApiBuilder.group(
  WanMonitorApi,
  "summary",
  (handlers) => handlers.handle("getSummary", getSummaryHandler)
);
