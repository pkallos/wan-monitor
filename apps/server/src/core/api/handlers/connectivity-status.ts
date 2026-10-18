import { WanMonitorApi } from "@shared/api";
import type {
  GetConnectivityStatusQuery,
  GetOutagesQuery,
} from "@shared/api/routes/connectivity-status";
import {
  DEFAULT_GRANULARITY,
  liveConnectivityWindowSeconds,
  MAX_OUTAGE_SPAN_DAYS,
} from "@wan-monitor/shared";
import { Clock, Effect, type Schema } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import {
  MAX_OUTAGES,
  outageMergeGapMs,
  summarizeOutages,
} from "@/core/analytics/outages";
import { cyclePeriodMs } from "@/core/analytics/period";
import { bucketStatus, summarizeConnectivity } from "@/core/analytics/rollup";
import {
  resolveWindow,
  SUMMARY_WINDOWS_MS,
  type TimeWindow,
  validateWindow,
} from "@/core/analytics/window";
import { withApiErrors } from "@/core/api/handlers/db-error";
import { ConfigService } from "@/infrastructure/config/config";
import { QuestDB } from "@/infrastructure/database/questdb";

const loadConnectivityStatus = (
  query: Schema.Schema.Type<typeof GetConnectivityStatusQuery>,
  { startMs, endMs }: TimeWindow
) =>
  Effect.gen(function* () {
    const db = yield* QuestDB;
    const config = yield* ConfigService;

    // Resolved once so coverage is measured on the same bucket grid the query samples.
    const startTime = new Date(startMs);
    const endTime = new Date(endMs);
    const granularity = query.granularity ?? DEFAULT_GRANULARITY;

    const rows = yield* db.queryConnectivityStatus({
      startTime,
      endTime,
      granularity,
    });

    const data = rows.map((row) => {
      const total = row.total_count || 1;
      return {
        timestamp: row.timestamp,
        status: bucketStatus({
          down: row.down_count,
          degraded: row.degraded_count,
          total: row.total_count,
        }),
        upPercentage: (row.up_count / total) * 100,
        downPercentage: (row.down_count / total) * 100,
        degradedPercentage: (row.degraded_count / total) * 100,
      };
    });

    const connectivity = summarizeConnectivity(
      rows,
      startTime.getTime(),
      endTime.getTime(),
      granularity
    );

    return {
      data,
      meta: {
        ...connectivity,
        expectedSampleIntervalSeconds: config.ping.intervalSeconds,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        count: data.length,
      },
    };
  }).pipe(withApiErrors("Failed to query connectivity status"));

export const getConnectivityStatusHandler = ({
  query,
}: {
  query: Schema.Schema.Type<typeof GetConnectivityStatusQuery>;
}) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const window = yield* validateWindow(
      resolveWindow(query, now, SUMMARY_WINDOWS_MS.last24h)
    );
    return yield* loadConnectivityStatus(query, window);
  });

/**
 * Answers "is the link up right now", independent of any date range the
 * dashboard has selected. The trailing window is sized from the server's own
 * `PING_INTERVAL_SECONDS`, which the browser has no way to know, so the
 * freshness decision lives here rather than in the client.
 */
export const getLiveConnectivityHandler = () =>
  Effect.gen(function* () {
    const db = yield* QuestDB;
    const config = yield* ConfigService;
    const now = yield* Clock.currentTimeMillis;

    const windowSeconds = liveConnectivityWindowSeconds(
      config.ping.intervalSeconds
    );
    const sinceIso = new Date(now - windowSeconds * 1000).toISOString();

    const row = yield* db.queryLiveConnectivity(sinceIso);
    if (row !== null) {
      return {
        status: row.cycle_status,
        lastSampleAt: row.timestamp,
        windowSeconds,
      };
    }

    // Only reached when the window is empty, so the extra round trip stays off
    // the healthy path: it turns silence into "no data since <timestamp>".
    const lastSampleAt = yield* db.queryLatestPingTimestamp();
    return { status: "noInfo" as const, lastSampleAt, windowSeconds };
  }).pipe(withApiErrors("Failed to query live connectivity"));

const loadOutages = ({ startMs, endMs }: TimeWindow) =>
  Effect.gen(function* () {
    const db = yield* QuestDB;
    const config = yield* ConfigService;

    const window = {
      startTime: new Date(startMs),
      endTime: new Date(endMs),
    };
    const measuredPeriodMs = yield* db.queryCyclePeriod(window);
    const periodMs = cyclePeriodMs(
      measuredPeriodMs,
      config.ping.intervalSeconds
    );
    const runs = yield* db.queryOutageRuns({
      ...window,
      mergeGapMs: outageMergeGapMs(periodMs),
    });

    const outages = summarizeOutages(runs, { periodMs, rangeEndMs: endMs });
    const data = outages.slice(0, MAX_OUTAGES);

    return {
      data,
      meta: {
        startTime: window.startTime.toISOString(),
        endTime: window.endTime.toISOString(),
        count: data.length,
        totalCount: outages.length,
      },
    };
  }).pipe(withApiErrors("Failed to query outages"));

/**
 * The outage log for a window: runs of non-up ping cycles (see
 * `buildQueryOutageRuns` and `summarizeOutages`), newest first and capped at
 * `MAX_OUTAGES`. Windows wider than `MAX_OUTAGE_SPAN_DAYS` are rejected before
 * any query runs. `meta` carries the resolved window, which is the default
 * trailing 24 hours when none was given.
 */
export const getOutagesHandler = ({
  query,
}: {
  query: Schema.Schema.Type<typeof GetOutagesQuery>;
}) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const window = yield* validateWindow(
      resolveWindow(query, now, SUMMARY_WINDOWS_MS.last24h),
      MAX_OUTAGE_SPAN_DAYS
    );
    return yield* loadOutages(window);
  });

export const ConnectivityStatusGroupLive = HttpApiBuilder.group(
  WanMonitorApi,
  "connectivityStatus",
  (handlers) =>
    handlers
      .handle("getConnectivityStatus", getConnectivityStatusHandler)
      .handle("getLiveConnectivity", getLiveConnectivityHandler)
      .handle("getOutages", getOutagesHandler)
);
