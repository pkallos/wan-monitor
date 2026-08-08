import { WanMonitorApi } from "@shared/api";
import type { GetConnectivityStatusQuery } from "@shared/api/routes/connectivity-status";
import {
  DEFAULT_GRANULARITY,
  DEGRADED_BUCKET_MIN_SHARE,
  expectedBucketCount,
  liveConnectivityWindowSeconds,
} from "@wan-monitor/shared";
import { Clock, Effect, type Schema } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { mapQueryError } from "@/core/api/handlers/db-error";
import { ConfigService } from "@/infrastructure/config/config";
import { QuestDB } from "@/infrastructure/database/questdb";

export const getConnectivityStatusHandler = ({
  query,
}: {
  query: Schema.Schema.Type<typeof GetConnectivityStatusQuery>;
}) =>
  Effect.gen(function* () {
    const db = yield* QuestDB;
    const config = yield* ConfigService;
    const now = yield* Clock.currentTimeMillis;

    // The window is resolved once here and passed explicitly to the query, so
    // the bucket grid coverage is measured against is the same grid the query
    // sampled over.
    const startTime = query.startTime
      ? new Date(query.startTime)
      : new Date(now - 24 * 60 * 60 * 1000);
    const endTime = query.endTime ? new Date(query.endTime) : new Date(now);
    const granularity = query.granularity ?? DEFAULT_GRANULARITY;

    const rows = yield* db.queryConnectivityStatus({
      startTime,
      endTime,
      granularity,
    });

    const data = rows.map((row) => {
      const total = row.total_count || 1;
      // A bucket only reads as "degraded" once a meaningful share of its
      // cycles were degraded, not the instant a single cycle crosses the
      // packet-loss floor — otherwise one blip inside a long-window, coarse
      // rollup bucket (many cycles per bucket) paints the whole bucket
      // orange.
      const degradedShare = row.degraded_count / total;
      return {
        timestamp: row.timestamp,
        status:
          row.down_count > 0
            ? ("down" as const)
            : degradedShare >= DEGRADED_BUCKET_MIN_SHARE
              ? ("degraded" as const)
              : ("up" as const),
        upPercentage: (row.up_count / total) * 100,
        downPercentage: (row.down_count / total) * 100,
        degradedPercentage: (row.degraded_count / total) * 100,
      };
    });

    // uptimePercentage is deliberately "clean up only": it counts strictly
    // `up` cycles over all cycles. Degraded cycles count toward the
    // denominator but NOT the numerator, so degradation lowers the uptime
    // figure rather than being treated as full availability.
    // availabilityPercentage counts `up` and `degraded` together, so a link
    // that stayed reachable throughout (even if lossy) doesn't read as a total
    // outage. Both are shipped so callers can pick which one to headline.
    //
    // Both are P(link in this state | the collector was running). Unmonitored
    // stretches are excluded from the denominator entirely and reported through
    // `coveragePercentage` instead, so a monitor that ran for one hour of a
    // 24-hour window reports its real uptime over ~4% coverage rather than
    // diluting uptime toward zero with time nobody was watching. With no cycles
    // at all the ratio has no denominator, so it is null, not 0 — nothing was
    // observed, which is not the same as observing a total outage.
    const observedCycles = rows.reduce((sum, row) => sum + row.total_count, 0);
    const totalUpPoints = rows.reduce((sum, row) => sum + row.up_count, 0);
    const totalDegradedPoints = rows.reduce(
      (sum, row) => sum + row.degraded_count,
      0
    );
    const uptimePercentage =
      observedCycles > 0 ? (totalUpPoints / observedCycles) * 100 : null;
    const availabilityPercentage =
      observedCycles > 0
        ? ((totalUpPoints + totalDegradedPoints) / observedCycles) * 100
        : null;

    // A failed ping still writes a row (see `pingExecutor`'s failure path), so
    // a bucket holding no rows at all means the collector wasn't running for
    // it, not that the link was down. Every bucket with cycles is present in
    // `rows`: `SAMPLE BY` without `FILL` emits nothing for an empty interval.
    const expectedBuckets = expectedBucketCount(
      startTime.getTime(),
      endTime.getTime(),
      granularity
    );
    const observedBuckets = rows.length;
    // The query's upper bound is inclusive while `expectedBucketCount` counts
    // the half-open [start, end), so a window ending exactly on a boundary can
    // observe one bucket more than expected. Clamping keeps coverage a
    // percentage; widening the filter would drop a real bucket of data.
    const coveragePercentage =
      expectedBuckets > 0
        ? Math.min(100, (observedBuckets / expectedBuckets) * 100)
        : 0;

    return {
      data,
      meta: {
        uptimePercentage,
        availabilityPercentage,
        expectedBuckets,
        observedBuckets,
        coveragePercentage,
        observedCycles,
        expectedSampleIntervalSeconds: config.ping.intervalSeconds,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        count: data.length,
      },
    };
  }).pipe(Effect.catch(mapQueryError("Failed to query connectivity status")));

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
  }).pipe(Effect.catch(mapQueryError("Failed to query live connectivity")));

export const ConnectivityStatusGroupLive = HttpApiBuilder.group(
  WanMonitorApi,
  "connectivityStatus",
  (handlers) =>
    handlers
      .handle("getConnectivityStatus", getConnectivityStatusHandler)
      .handle("getLiveConnectivity", getLiveConnectivityHandler)
);
