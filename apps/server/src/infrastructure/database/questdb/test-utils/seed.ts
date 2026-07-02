import type { NetworkMetric } from "@shared/metrics";
import { Data, type Duration, Effect, Schedule } from "effect";
import type { QuestDBService } from "@/infrastructure/database/questdb/service";
import { QUESTDB_HTTP_URL } from "@/infrastructure/database/questdb/test-utils/setup";

/**
 * Error raised while waiting for seeded rows to become queryable.
 */
class SeedError extends Data.TaggedError("SeedError")<{
  readonly message: string;
}> {}

/**
 * Deterministic seed data for integration tests.
 * This data is designed to test various query scenarios:
 * - Multiple sources (ping vs speedtest)
 * - Multiple hosts
 * - Time-based filtering
 * - Granularity aggregation
 * - Null/undefined field handling
 */

export interface SeedDataWindow {
  readonly startTime: Date;
  readonly endTime: Date;
  readonly expectedPointCount: number;
}

/**
 * Create a deterministic set of ping metrics for a specific time window.
 * Returns metrics every minute for the specified duration.
 */
export const createPingMetrics = (
  startTime: Date,
  durationMinutes: number,
  host: string
): NetworkMetric[] => {
  const metrics: NetworkMetric[] = [];

  for (let i = 0; i < durationMinutes; i++) {
    const timestamp = new Date(startTime.getTime() + i * 60 * 1000);

    // Create deterministic but varied latency values
    const baseLatency = 20 + (i % 10) * 2; // Ranges from 20-38ms
    const jitter = 1 + (i % 5) * 0.5; // Ranges from 1-3ms
    const packetLoss = i % 20 === 0 ? 5 : 0; // 5% loss every 20th point

    metrics.push({
      timestamp,
      source: "ping",
      host,
      latency: baseLatency,
      jitter,
      packetLoss,
      connectivityStatus: packetLoss > 0 ? "degraded" : "up",
    });
  }

  return metrics;
};

/**
 * Create a deterministic set of speedtest metrics for a specific time window.
 * Returns metrics every 15 minutes for the specified duration.
 */
export const createSpeedtestMetrics = (
  startTime: Date,
  durationMinutes: number
): NetworkMetric[] => {
  const metrics: NetworkMetric[] = [];
  const intervalMinutes = 15;
  const count = Math.floor(durationMinutes / intervalMinutes);

  for (let i = 0; i < count; i++) {
    const timestamp = new Date(
      startTime.getTime() + i * intervalMinutes * 60 * 1000
    );

    // Create deterministic but varied bandwidth values (in bps)
    const baseDownload = 100_000_000 + (i % 5) * 10_000_000; // 100-140 Mbps
    const baseUpload = 20_000_000 + (i % 3) * 5_000_000; // 20-30 Mbps
    const latency = 15 + (i % 8) * 2; // 15-29ms

    metrics.push({
      timestamp,
      source: "speedtest",
      latency,
      downloadBandwidth: baseDownload,
      uploadBandwidth: baseUpload,
      connectivityStatus: "up",
      serverLocation: i % 2 === 0 ? "New York" : "San Francisco",
      isp: "Test ISP",
      externalIp: `192.0.2.${100 + i}`,
      internalIp: "10.0.0.100",
    });
  }

  return metrics;
};

/**
 * Standard test window: 1 hour of data
 */
export const createStandardTestWindow = (
  baseTime: Date = new Date("2024-01-15T12:00:00Z")
): {
  window: SeedDataWindow;
  pingMetrics: NetworkMetric[];
  speedtestMetrics: NetworkMetric[];
} => {
  const startTime = baseTime;
  const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // 1 hour later

  // Create ping metrics every minute (60 points)
  const pingMetrics = createPingMetrics(startTime, 60, "8.8.8.8");

  // Create speedtest metrics every 15 minutes (4 points)
  const speedtestMetrics = createSpeedtestMetrics(startTime, 60);

  return {
    window: {
      startTime,
      endTime,
      expectedPointCount: pingMetrics.length + speedtestMetrics.length,
    },
    pingMetrics,
    speedtestMetrics,
  };
};

/**
 * Multi-host test window: 30 minutes of data from two different hosts
 */
export const createMultiHostTestWindow = (
  baseTime: Date = new Date("2024-01-15T14:00:00Z")
): {
  window: SeedDataWindow;
  host1Metrics: NetworkMetric[];
  host2Metrics: NetworkMetric[];
} => {
  const startTime = baseTime;
  const endTime = new Date(startTime.getTime() + 30 * 60 * 1000); // 30 minutes later

  const host1Metrics = createPingMetrics(startTime, 30, "8.8.8.8");
  const host2Metrics = createPingMetrics(startTime, 30, "1.1.1.1");

  return {
    window: {
      startTime,
      endTime,
      expectedPointCount: host1Metrics.length + host2Metrics.length,
    },
    host1Metrics,
    host2Metrics,
  };
};

/**
 * Query the current row count of network_metrics via the QuestDB HTTP API.
 * Used to detect when freshly seeded ILP writes have become queryable.
 */
const countMetricRows = (): Effect.Effect<number, SeedError> =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(
        `${QUESTDB_HTTP_URL}/exec?query=${encodeURIComponent(
          "SELECT count() FROM network_metrics"
        )}`
      );

      if (!response.ok) {
        throw new Error(`Count query failed: ${response.status}`);
      }

      const body = (await response.json()) as {
        dataset?: ReadonlyArray<ReadonlyArray<number>>;
      };

      return body.dataset?.[0]?.[0] ?? 0;
    },
    catch: (error) =>
      new SeedError({ message: `Failed to count metric rows: ${error}` }),
  });

/**
 * Poll until QuestDB has indexed at least `expectedCount` rows, or the timeout
 * elapses.
 *
 * ILP writes are buffered and committed asynchronously, so a freshly flushed
 * batch is not guaranteed to be queryable immediately. A fixed sleep is flaky
 * under CI load (the commit lag can exceed the sleep, yielding empty query
 * results); polling the actual row count makes seeding deterministic.
 */
const waitForRowCount = (
  expectedCount: number,
  timeout: Duration.DurationInput = "15 seconds"
): Effect.Effect<void, SeedError> =>
  Effect.gen(function* () {
    const count = yield* countMetricRows();

    if (count < expectedCount) {
      return yield* Effect.fail(
        new SeedError({
          message: `QuestDB indexed ${count} rows, expected at least ${expectedCount}`,
        })
      );
    }
  }).pipe(
    Effect.retry(Schedule.spaced("200 millis").pipe(Schedule.upTo(timeout)))
  );

/**
 * Seed the database with test data.
 */
export const seedDatabase = (
  db: QuestDBService,
  metrics: NetworkMetric[]
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    // Write all metrics sequentially to ensure deterministic ordering
    for (const metric of metrics) {
      yield* db.writeMetric(metric);
    }

    // Explicitly flush the ILP sender to ensure all data is written
    // The ILP protocol uses buffering and auto-flush intervals,
    // so we need to force a flush before querying the data
    yield* db.flush();

    // Wait until the seeded rows are actually queryable rather than sleeping a
    // fixed interval. Callers truncate the table before seeding, so the table
    // should converge to exactly `metrics.length` rows.
    yield* waitForRowCount(metrics.length);
  });

/**
 * Create a complete deterministic seed dataset for integration tests.
 */
export const createSeedDataset = () => {
  const standardWindow = createStandardTestWindow();
  const multiHostWindow = createMultiHostTestWindow();

  return {
    standardWindow,
    multiHostWindow,
    allMetrics: [
      ...standardWindow.pingMetrics,
      ...standardWindow.speedtestMetrics,
      ...multiHostWindow.host1Metrics,
      ...multiHostWindow.host2Metrics,
    ],
  };
};
