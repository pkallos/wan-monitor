import { BrowserKeyValueStore } from "@effect/platform-browser";
import { DB_UNAVAILABLE } from "@shared/api/errors";
import { Clock, Effect, Option, Schema as S } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { KeyValueStore } from "effect/unstable/persistence";
import { Command } from "foldkit";
import { makeClient } from "@/api/client";
import {
  DateRangeSelection,
  getDateRangeWindow,
  granularityForRange,
  granularityForSpeedtestRange,
} from "@/dashboard/dateRange";
import {
  CompletedSaveTheme,
  FailedFetchConnectivityStatus,
  FailedFetchEarliestData,
  FailedFetchMetrics,
  FailedFetchSpeedtestHistory,
  FailedSaveTheme,
  FailedTriggerSpeedtest,
  LoadedTheme,
  SucceededFetchConnectivityStatus,
  SucceededFetchEarliestData,
  SucceededFetchMetrics,
  SucceededFetchSpeedtestHistory,
  SucceededTriggerSpeedtest,
} from "@/dashboard/message";
import { Theme } from "@/dashboard/theme";

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

const DateRangeArgs = {
  token: S.String,
  dateRange: DateRangeSelection,
  maybeEarliestDataMs: S.optional(S.Option(S.Number)),
};

export const fetchMetrics = ({
  token,
  dateRange,
  maybeEarliestDataMs,
}: {
  token: string;
  dateRange: DateRangeSelection;
  maybeEarliestDataMs?: Option.Option<number>;
}) =>
  Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    const window = getDateRangeWindow(dateRange, nowMs, maybeEarliestDataMs);
    const { startTime, endTime } = window;
    const granularity = granularityForRange(window);
    const client = yield* makeClient(Option.some(token));
    // Latency, jitter and packet loss are ping measurements. Speedtest rows
    // share the same table and `latency` column but describe a different
    // quantity, and carry no packet loss at all, so they're excluded here
    // rather than averaged into these charts.
    const response = yield* client.metrics.getMetrics({
      query: {
        startTime,
        endTime,
        granularity,
        source: "ping",
      },
    });
    // The window travels with the data so the paint step buckets against the
    // exact range that was fetched instead of re-resolving `dateRange`
    // against a later clock reading.
    return SucceededFetchMetrics({
      metrics: response.data,
      nowMs,
      startTimeMs: Date.parse(startTime),
      endTimeMs: Date.parse(endTime),
      granularity,
    });
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(FailedFetchMetrics({ error: fetchErrorMessage(error) }))
    )
  );

export const fetchSpeedtestHistory = ({
  token,
  dateRange,
  maybeEarliestDataMs,
}: {
  token: string;
  dateRange: DateRangeSelection;
  maybeEarliestDataMs?: Option.Option<number>;
}) =>
  Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    const window = getDateRangeWindow(dateRange, nowMs, maybeEarliestDataMs);
    const { startTime, endTime } = window;
    const granularity = granularityForSpeedtestRange(window);
    const client = yield* makeClient(Option.some(token));
    const response = yield* client.speedtest.getSpeedTestHistory({
      query: {
        startTime,
        endTime,
        ...(granularity !== undefined ? { granularity } : {}),
      },
    });
    return SucceededFetchSpeedtestHistory({
      history: response.data,
      startTimeMs: Date.parse(startTime),
      endTimeMs: Date.parse(endTime),
      maybeGranularity: Option.fromNullishOr(granularity),
    });
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(
        FailedFetchSpeedtestHistory({ error: fetchErrorMessage(error) })
      )
    )
  );

export const fetchConnectivityStatus = ({
  token,
  dateRange,
  maybeEarliestDataMs,
}: {
  token: string;
  dateRange: DateRangeSelection;
  maybeEarliestDataMs?: Option.Option<number>;
}) =>
  Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    const window = getDateRangeWindow(dateRange, nowMs, maybeEarliestDataMs);
    const { startTime, endTime } = window;
    const client = yield* makeClient(Option.some(token));
    const response = yield* client.connectivityStatus.getConnectivityStatus({
      query: {
        startTime,
        endTime,
        granularity: granularityForRange(window),
      },
    });
    return SucceededFetchConnectivityStatus({
      points: response.data,
      uptimePercentage: response.meta.uptimePercentage,
      startTimeMs: Date.parse(startTime),
      endTimeMs: Date.parse(endTime),
      granularity: granularityForRange(window),
    });
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(
        FailedFetchConnectivityStatus({ error: fetchErrorMessage(error) })
      )
    )
  );

export const fetchEarliestData = ({ token }: { token: string }) =>
  Effect.gen(function* () {
    const client = yield* makeClient(Option.some(token));
    const response = yield* client.metrics.getEarliestTimestamp();
    return SucceededFetchEarliestData({
      earliestMs:
        response.timestamp !== null
          ? Option.some(Date.parse(response.timestamp))
          : Option.none(),
    });
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(
        FailedFetchEarliestData({ error: fetchErrorMessage(error) })
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
  DateRangeArgs,
  SucceededFetchMetrics,
  FailedFetchMetrics
)((args) => fetchMetrics(args).pipe(Effect.provide(FetchHttpClient.layer)));

export const FetchSpeedtestHistory = Command.define(
  "FetchSpeedtestHistory",
  DateRangeArgs,
  SucceededFetchSpeedtestHistory,
  FailedFetchSpeedtestHistory
)((args) =>
  fetchSpeedtestHistory(args).pipe(Effect.provide(FetchHttpClient.layer))
);

export const FetchConnectivityStatus = Command.define(
  "FetchConnectivityStatus",
  DateRangeArgs,
  SucceededFetchConnectivityStatus,
  FailedFetchConnectivityStatus
)((args) =>
  fetchConnectivityStatus(args).pipe(Effect.provide(FetchHttpClient.layer))
);

export const FetchEarliestData = Command.define(
  "FetchEarliestData",
  { token: S.String },
  SucceededFetchEarliestData,
  FailedFetchEarliestData
)((args) =>
  fetchEarliestData(args).pipe(Effect.provide(FetchHttpClient.layer))
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
