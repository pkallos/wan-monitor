import { BrowserKeyValueStore } from "@effect/platform-browser";
import { DbUnavailable, InvalidTimeRange } from "@shared/api/errors";
import { Clock, Effect, Option, Schema as S } from "effect";
import { FetchHttpClient } from "effect/http";
import { Command } from "foldkit";
import { makeClient } from "@/api/client";
import {
  DateRangeSelection,
  getDateRangeWindow,
  granularityForRange,
  granularityForSpeedtestRange,
} from "@/dashboard/dateRange";
import { outageWindow } from "@/dashboard/incidents";
import {
  CompletedApplyTheme,
  CompletedSaveSettings,
  FailedFetchConnectivityStatus,
  FailedFetchEarliestData,
  FailedFetchHostLatency,
  FailedFetchLiveConnectivity,
  FailedFetchMetrics,
  FailedFetchOutages,
  FailedFetchPingHosts,
  FailedFetchSpeedtestHistory,
  FailedFetchSummary,
  FailedSaveSettings,
  FailedTriggerSpeedtest,
  type RangeRequest,
  SucceededFetchConnectivityStatus,
  SucceededFetchEarliestData,
  SucceededFetchHostLatency,
  SucceededFetchLiveConnectivity,
  SucceededFetchMetrics,
  SucceededFetchOutages,
  SucceededFetchPingHosts,
  SucceededFetchSpeedtestHistory,
  SucceededFetchSummary,
  SucceededTriggerSpeedtest,
} from "@/dashboard/message";
import { resolveTheme, ThemePreference } from "@/dashboard/theme";
import { Settings, writeSettings } from "@/storage";

const DB_UNAVAILABLE_MESSAGE = "Database unavailable.";
const REQUEST_FAILED_MESSAGE = "Request failed";

const isDbUnavailable = S.is(DbUnavailable);
const isInvalidTimeRange = S.is(InvalidTimeRange);

// Typed API errors that carry a message written for the viewer pass it
// through; transport and decoding failures say nothing a viewer can act on.
const fetchErrorMessage = (error: unknown): string =>
  isDbUnavailable(error)
    ? DB_UNAVAILABLE_MESSAGE
    : isInvalidTimeRange(error)
      ? error.message
      : REQUEST_FAILED_MESSAGE;

const DateRangeArgs = {
  token: S.String,
  dateRange: DateRangeSelection,
  maybeEarliestDataMs: S.optional(S.Option(S.Number)),
};

type RangeArgs = {
  token: string;
  dateRange: DateRangeSelection;
  maybeEarliestDataMs?: Option.Option<number>;
};

/**
 * The inputs that decide which window a fetch resolves, spread into a
 * range-scoped Command's args. The fetch echoes them back as `request`.
 */
export const rangeRequest = ({
  dateRange,
  maybeEarliestDataMs = Option.none(),
}: Omit<RangeArgs, "token">): RangeRequest => ({
  dateRange,
  maybeEarliestDataMs,
});

export const fetchMetrics = ({ token, ...range }: RangeArgs) => {
  const request = rangeRequest(range);
  return Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    const window = getDateRangeWindow(
      request.dateRange,
      nowMs,
      request.maybeEarliestDataMs
    );
    const { startTime, endTime } = window;
    const granularity = granularityForRange(window);
    const client = yield* makeClient(Option.some(token));
    // Everything downstream of this charts ping measurements, and pinning a
    // source is also what keeps an aggregated bucket to one row (see
    // `buildQueryMetrics`).
    const response = yield* client.metrics.getMetrics({
      query: {
        startTime,
        endTime,
        granularity,
        source: "ping",
      },
    });
    // The resolved window rides along so the paint step never re-resolves it.
    return SucceededFetchMetrics({
      request,
      metrics: response.data,
      nowMs,
      startTimeMs: Date.parse(startTime),
      endTimeMs: Date.parse(endTime),
      granularity,
    });
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(
        FailedFetchMetrics({ request, error: fetchErrorMessage(error) })
      )
    )
  );
};

export const fetchSpeedtestHistory = ({ token, ...range }: RangeArgs) => {
  const request = rangeRequest(range);
  return Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    const window = getDateRangeWindow(
      request.dateRange,
      nowMs,
      request.maybeEarliestDataMs
    );
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
      request,
      history: response.data,
      startTimeMs: Date.parse(startTime),
      endTimeMs: Date.parse(endTime),
    });
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(
        FailedFetchSpeedtestHistory({
          request,
          error: fetchErrorMessage(error),
        })
      )
    )
  );
};

export const fetchConnectivityStatus = ({ token, ...range }: RangeArgs) => {
  const request = rangeRequest(range);
  return Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    const window = getDateRangeWindow(
      request.dateRange,
      nowMs,
      request.maybeEarliestDataMs
    );
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
      request,
      points: response.data,
      maybeUptimePercentage: Option.fromNullishOr(
        response.meta.uptimePercentage
      ),
      maybeAvailabilityPercentage: Option.fromNullishOr(
        response.meta.availabilityPercentage
      ),
      coveragePercentage: response.meta.coveragePercentage,
      startTimeMs: Date.parse(startTime),
      endTimeMs: Date.parse(endTime),
      granularity: granularityForRange(window),
    });
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(
        FailedFetchConnectivityStatus({
          request,
          error: fetchErrorMessage(error),
        })
      )
    )
  );
};

/**
 * Takes no date range on purpose: the live indicator answers "right now", and
 * the absence of a range in this signature is what keeps it that way.
 */
export const fetchLiveConnectivity = ({ token }: { token: string }) =>
  Effect.gen(function* () {
    const client = yield* makeClient(Option.some(token));
    const response = yield* client.connectivityStatus.getLiveConnectivity();
    return SucceededFetchLiveConnectivity({
      status: response.status,
      maybeLastSampleAtMs:
        response.lastSampleAt !== null
          ? Option.some(Date.parse(response.lastSampleAt))
          : Option.none(),
    });
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(
        FailedFetchLiveConnectivity({ error: fetchErrorMessage(error) })
      )
    )
  );

export const fetchSummary = ({ token, ...range }: RangeArgs) => {
  const request = rangeRequest(range);
  return Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    const { startTime, endTime } = getDateRangeWindow(
      request.dateRange,
      nowMs,
      request.maybeEarliestDataMs
    );
    const client = yield* makeClient(Option.some(token));
    const summary = yield* client.summary.getSummary({
      query: { startTime, endTime },
    });
    return SucceededFetchSummary({ summary, request });
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(
        FailedFetchSummary({ error: fetchErrorMessage(error), request })
      )
    )
  );
};

export const fetchOutages = ({ token, ...range }: RangeArgs) => {
  const request = rangeRequest(range);
  return Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    const { isClamped, ...window } = outageWindow(
      getDateRangeWindow(request.dateRange, nowMs, request.maybeEarliestDataMs)
    );
    const client = yield* makeClient(Option.some(token));
    const outages = yield* client.connectivityStatus.getOutages({
      query: window,
    });
    return SucceededFetchOutages({
      outages,
      isClamped,
      fetchedAtMs: nowMs,
      request,
    });
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(
        FailedFetchOutages({ error: fetchErrorMessage(error), request })
      )
    )
  );
};

export const fetchHostLatency = ({
  token,
  hosts,
  ...range
}: RangeArgs & { hosts: ReadonlyArray<string> }) => {
  const request = rangeRequest(range);
  return Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    const window = getDateRangeWindow(
      request.dateRange,
      nowMs,
      request.maybeEarliestDataMs
    );
    const { startTime, endTime } = window;
    const granularity = granularityForRange(window);
    const client = yield* makeClient(Option.some(token));
    const series = yield* Effect.forEach(
      hosts,
      (host) =>
        client.metrics
          .getMetrics({
            query: {
              startTime,
              endTime,
              granularity,
              host,
              source: "ping",
              percentiles: "p50",
            },
          })
          .pipe(Effect.map((response) => ({ host, metrics: response.data }))),
      { concurrency: "unbounded" }
    );
    return SucceededFetchHostLatency({
      series,
      startTimeMs: Date.parse(startTime),
      endTimeMs: Date.parse(endTime),
      granularity,
      request,
    });
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(
        FailedFetchHostLatency({ error: fetchErrorMessage(error), request })
      )
    )
  );
};

export const fetchPingHosts = ({ token }: { token: string }) =>
  Effect.gen(function* () {
    const client = yield* makeClient(Option.some(token));
    const hosts = yield* client.ping.getHosts();
    return SucceededFetchPingHosts({ hosts });
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(FailedFetchPingHosts({ error: fetchErrorMessage(error) }))
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
          message: "Speed test request failed.",
          isAlreadyRunning: false,
        })
      )
    )
  );

// The one place that owns `<html>`'s `dark` class at runtime. It has to sit
// there, not on the dashboard root, because the Tailwind variant is
// `&:where(.dark, .dark *)` (styles.css) and must also reach the login screen.
export const applyTheme = ({ theme }: { theme: ThemePreference }) =>
  Effect.sync(() => {
    const resolved = resolveTheme(theme);
    document.documentElement.classList.toggle("dark", resolved === "dark");
    document.documentElement.style.colorScheme = resolved;
    return CompletedApplyTheme();
  }).pipe(Effect.catch(() => Effect.succeed(CompletedApplyTheme())));

export const saveSettings = ({ settings }: { settings: Settings }) =>
  writeSettings(settings).pipe(
    Effect.as(CompletedSaveSettings()),
    Effect.catch((error) =>
      Effect.succeed(FailedSaveSettings({ error: String(error) }))
    )
  );

export const FetchMetrics = Command.define("FetchMetrics", {
  args: DateRangeArgs,
  messages: [SucceededFetchMetrics, FailedFetchMetrics],
  execute: (args) =>
    fetchMetrics(args).pipe(Effect.provide(FetchHttpClient.layer)),
});

export const FetchSpeedtestHistory = Command.define("FetchSpeedtestHistory", {
  args: DateRangeArgs,
  messages: [SucceededFetchSpeedtestHistory, FailedFetchSpeedtestHistory],
  execute: (args) =>
    fetchSpeedtestHistory(args).pipe(Effect.provide(FetchHttpClient.layer)),
});

export const FetchConnectivityStatus = Command.define(
  "FetchConnectivityStatus",
  {
    args: DateRangeArgs,
    messages: [SucceededFetchConnectivityStatus, FailedFetchConnectivityStatus],
    execute: (args) =>
      fetchConnectivityStatus(args).pipe(Effect.provide(FetchHttpClient.layer)),
  }
);

export const FetchLiveConnectivity = Command.define("FetchLiveConnectivity", {
  args: { token: S.String },
  messages: [SucceededFetchLiveConnectivity, FailedFetchLiveConnectivity],
  execute: (args) =>
    fetchLiveConnectivity(args).pipe(Effect.provide(FetchHttpClient.layer)),
});

export const FetchSummary = Command.define("FetchSummary", {
  args: DateRangeArgs,
  messages: [SucceededFetchSummary, FailedFetchSummary],
  execute: (args) =>
    fetchSummary(args).pipe(Effect.provide(FetchHttpClient.layer)),
});

export const FetchOutages = Command.define("FetchOutages", {
  args: DateRangeArgs,
  messages: [SucceededFetchOutages, FailedFetchOutages],
  execute: (args) =>
    fetchOutages(args).pipe(Effect.provide(FetchHttpClient.layer)),
});

export const FetchHostLatency = Command.define("FetchHostLatency", {
  args: { ...DateRangeArgs, hosts: S.Array(S.String) },
  messages: [SucceededFetchHostLatency, FailedFetchHostLatency],
  execute: (args) =>
    fetchHostLatency(args).pipe(Effect.provide(FetchHttpClient.layer)),
});

export const FetchPingHosts = Command.define("FetchPingHosts", {
  args: { token: S.String },
  messages: [SucceededFetchPingHosts, FailedFetchPingHosts],
  execute: (args) =>
    fetchPingHosts(args).pipe(Effect.provide(FetchHttpClient.layer)),
});

export const FetchEarliestData = Command.define("FetchEarliestData", {
  args: { token: S.String },
  messages: [SucceededFetchEarliestData, FailedFetchEarliestData],
  execute: (args) =>
    fetchEarliestData(args).pipe(Effect.provide(FetchHttpClient.layer)),
});

export const TriggerSpeedtest = Command.define("TriggerSpeedtest", {
  args: { token: S.String },
  messages: [SucceededTriggerSpeedtest, FailedTriggerSpeedtest],
  execute: (args) =>
    triggerSpeedtest(args).pipe(Effect.provide(FetchHttpClient.layer)),
});

export const ApplyTheme = Command.define("ApplyTheme", {
  args: { theme: ThemePreference },
  messages: [CompletedApplyTheme],
  execute: applyTheme,
});

export const SaveSettings = Command.define("SaveSettings", {
  args: { settings: Settings },
  messages: [CompletedSaveSettings, FailedSaveSettings],
  execute: (args) =>
    saveSettings(args).pipe(
      Effect.provide(BrowserKeyValueStore.layerLocalStorage),
      // Guards against a defect building the store itself (e.g. `localStorage`
      // throwing with site data blocked), which happens outside saveSettings'
      // own Effect.catch since the layer isn't built yet when that runs.
      Effect.catchDefect((defect) =>
        Effect.succeed(FailedSaveSettings({ error: String(defect) }))
      )
    ),
});
