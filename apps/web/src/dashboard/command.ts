import { BrowserKeyValueStore } from "@effect/platform-browser";
import { DB_UNAVAILABLE } from "@shared/api/errors";
import { Clock, Effect, Option, Schema as S } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { KeyValueStore } from "effect/unstable/persistence";
import { Command } from "foldkit";
import { makeClient } from "@/api/client";
import { getGranularityForTimeRange } from "@/dashboard/charts/timeline";
import {
  CompletedSaveTheme,
  FailedFetchConnectivityStatus,
  FailedFetchMetrics,
  FailedFetchSpeedtestHistory,
  FailedSaveTheme,
  FailedTriggerSpeedtest,
  LoadedTheme,
  SucceededFetchConnectivityStatus,
  SucceededFetchMetrics,
  SucceededFetchSpeedtestHistory,
  SucceededTriggerSpeedtest,
} from "@/dashboard/message";
import { Theme } from "@/dashboard/theme";
import { getTimeRangeWindow, TimeRange } from "@/dashboard/timeRange";

const THEME_STORAGE_KEY = "wan_monitor_theme";

const DB_UNAVAILABLE_MESSAGE =
  "Database temporarily unavailable. Retrying automatically.";

const isDbUnavailableError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "error" in error &&
  error.error === DB_UNAVAILABLE;

const fetchErrorMessage = (error: unknown): string =>
  isDbUnavailableError(error) ? DB_UNAVAILABLE_MESSAGE : String(error);

const TimeRangeArgs = {
  token: S.String,
  timeRange: TimeRange,
};

export const fetchMetrics = ({
  token,
  timeRange,
}: {
  token: string;
  timeRange: TimeRange;
}) =>
  Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    const { startTime, endTime } = getTimeRangeWindow(timeRange, nowMs);
    const client = yield* makeClient(Option.some(token));
    const response = yield* client.metrics.getMetrics({
      query: {
        startTime,
        endTime,
        granularity: getGranularityForTimeRange(timeRange),
      },
    });
    return SucceededFetchMetrics({ metrics: response.data, nowMs });
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(FailedFetchMetrics({ error: fetchErrorMessage(error) }))
    )
  );

export const fetchSpeedtestHistory = ({
  token,
  timeRange,
}: {
  token: string;
  timeRange: TimeRange;
}) =>
  Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    const { startTime, endTime } = getTimeRangeWindow(timeRange, nowMs);
    const client = yield* makeClient(Option.some(token));
    const response = yield* client.speedtest.getSpeedTestHistory({
      query: { startTime, endTime },
    });
    return SucceededFetchSpeedtestHistory({ history: response.data });
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(
        FailedFetchSpeedtestHistory({ error: fetchErrorMessage(error) })
      )
    )
  );

export const fetchConnectivityStatus = ({
  token,
  timeRange,
}: {
  token: string;
  timeRange: TimeRange;
}) =>
  Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    const { startTime, endTime } = getTimeRangeWindow(timeRange, nowMs);
    const client = yield* makeClient(Option.some(token));
    const response = yield* client.connectivityStatus.getConnectivityStatus({
      query: {
        startTime,
        endTime,
        granularity: getGranularityForTimeRange(timeRange),
      },
    });
    return SucceededFetchConnectivityStatus({
      points: response.data,
      uptimePercentage: response.meta.uptimePercentage,
      startTimeMs: Date.parse(startTime),
      endTimeMs: Date.parse(endTime),
      granularity: getGranularityForTimeRange(timeRange),
    });
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(
        FailedFetchConnectivityStatus({ error: fetchErrorMessage(error) })
      )
    )
  );

export const triggerSpeedtest = ({ token }: { token: string }) =>
  Effect.gen(function* () {
    const client = yield* makeClient(Option.some(token));
    const response = yield* client.speedtest.triggerSpeedTest();

    if (!response.success) {
      return FailedTriggerSpeedtest({
        message: response.error.message,
        isAlreadyRunning: response.error.code === "SPEED_TEST_ALREADY_RUNNING",
      });
    }
    return SucceededTriggerSpeedtest({
      downloadMbps: response.result.downloadMbps,
      uploadMbps: response.result.uploadMbps,
      pingMs: response.result.pingMs,
    });
  }).pipe(
    Effect.catch(() =>
      Effect.succeed(
        FailedTriggerSpeedtest({
          message: "Something went wrong running the speed test.",
          isAlreadyRunning: false,
        })
      )
    )
  );

export const loadTheme = Effect.gen(function* () {
  const store = yield* KeyValueStore.KeyValueStore;
  const stored = yield* store.get(THEME_STORAGE_KEY);
  return LoadedTheme({ theme: stored === "dark" ? "dark" : "light" });
}).pipe(Effect.catch(() => Effect.succeed(LoadedTheme({ theme: "light" }))));

export const saveTheme = ({ theme }: { theme: Theme }) =>
  Effect.gen(function* () {
    const store = yield* KeyValueStore.KeyValueStore;
    yield* store.set(THEME_STORAGE_KEY, theme);
    return CompletedSaveTheme();
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(FailedSaveTheme({ error: String(error) }))
    )
  );

export const FetchMetrics = Command.define(
  "FetchMetrics",
  TimeRangeArgs,
  SucceededFetchMetrics,
  FailedFetchMetrics
)((args) => fetchMetrics(args).pipe(Effect.provide(FetchHttpClient.layer)));

export const FetchSpeedtestHistory = Command.define(
  "FetchSpeedtestHistory",
  TimeRangeArgs,
  SucceededFetchSpeedtestHistory,
  FailedFetchSpeedtestHistory
)((args) =>
  fetchSpeedtestHistory(args).pipe(Effect.provide(FetchHttpClient.layer))
);

export const FetchConnectivityStatus = Command.define(
  "FetchConnectivityStatus",
  TimeRangeArgs,
  SucceededFetchConnectivityStatus,
  FailedFetchConnectivityStatus
)((args) =>
  fetchConnectivityStatus(args).pipe(Effect.provide(FetchHttpClient.layer))
);

export const TriggerSpeedtest = Command.define(
  "TriggerSpeedtest",
  { token: S.String },
  SucceededTriggerSpeedtest,
  FailedTriggerSpeedtest
)((args) => triggerSpeedtest(args).pipe(Effect.provide(FetchHttpClient.layer)));

export const LoadTheme = Command.define(
  "LoadTheme",
  LoadedTheme
)(loadTheme.pipe(Effect.provide(BrowserKeyValueStore.layerLocalStorage)));

export const SaveTheme = Command.define(
  "SaveTheme",
  { theme: Theme },
  CompletedSaveTheme,
  FailedSaveTheme
)((args) =>
  saveTheme(args).pipe(Effect.provide(BrowserKeyValueStore.layerLocalStorage))
);
