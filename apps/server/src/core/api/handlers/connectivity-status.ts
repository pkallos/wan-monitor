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
import { MAX_OUTAGES, summarizeOutages } from "@/core/analytics/outages";
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
  { startMs, endMs }: TimeWindow,
  nowMs: number
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
      nowMs,
      intervalMs: config.ping.intervalSeconds * 1000,
      hosts: config.ping.hosts,
    });

    const data = rows.map((row) => {
      const observed = row.up_micros + row.degraded_micros + row.down_micros;
      const share = (micros: number) => (micros / observed) * 100;
      return {
        timestamp: row.bucket,
        status: bucketStatus({
          down: row.down_micros,
          degraded: row.degraded_micros,
          observed,
        }),
        upPercentage: share(row.up_micros),
        downPercentage: share(row.down_micros),
        degradedPercentage: share(row.degraded_micros),
      };
    });

    const connectivity = summarizeConnectivity(
      rows,
      startMs,
      Math.min(endMs, nowMs),
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
    return yield* loadConnectivityStatus(query, window, now);
  });

/**
 * Answers "is the link up right now", independent of any date range the
 * dashboard has selected, from the same state pipeline the reports use. The
 * pipeline needs the server's own `PING_INTERVAL_SECONDS` and `PING_HOSTS`,
 * which the browser has no way to know. With no host holding a ping, the status
 * is `noInfo` and `lastSampleAt` says when the monitor last reported.
 */
export const getLiveConnectivityHandler = () =>
  Effect.gen(function* () {
    const db = yield* QuestDB;
    const config = yield* ConfigService;
    const nowMs = yield* Clock.currentTimeMillis;

    const { state, lastSampleAt } = yield* Effect.all(
      {
        state: db.queryLiveConnectivity({
          nowMs,
          intervalMs: config.ping.intervalSeconds * 1000,
          hosts: config.ping.hosts,
        }),
        lastSampleAt: db.queryLatestPingTimestamp(),
      },
      { concurrency: "unbounded" }
    );

    return {
      status: state ?? ("noInfo" as const),
      lastSampleAt,
      windowSeconds: liveConnectivityWindowSeconds(config.ping.intervalSeconds),
    };
  }).pipe(withApiErrors("Failed to query live connectivity"));

const loadOutages = ({ startMs, endMs }: TimeWindow, nowMs: number) =>
  Effect.gen(function* () {
    const db = yield* QuestDB;
    const config = yield* ConfigService;

    const startTime = new Date(startMs);
    const endTime = new Date(endMs);
    const runs = yield* db.queryOutageRuns({
      startTime,
      endTime,
      nowMs,
      intervalMs: config.ping.intervalSeconds * 1000,
      hosts: config.ping.hosts,
    });

    const outages = summarizeOutages(runs, {
      rangeStartMs: startMs,
      rangeEndMs: Math.min(endMs, nowMs),
    });
    const data = outages.slice(0, MAX_OUTAGES);

    return {
      data,
      meta: {
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        count: data.length,
        totalCount: outages.length,
      },
    };
  }).pipe(withApiErrors("Failed to query outages"));

/**
 * The outage log for a window: runs of degraded or down time (see
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
    return yield* loadOutages(window, now);
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
