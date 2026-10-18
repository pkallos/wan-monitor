import { Match as M, Option, Result } from "effect";
import { AsyncData, Command, Update } from "foldkit";
import { modifyFields } from "foldkit/struct";
import {
  SyncJitterChart,
  SyncLatencyChart,
  SyncPacketLossChart,
  SyncSpeedChart,
} from "@/dashboard/charts/command";
import {
  ApplyTheme,
  FetchConnectivityStatus,
  FetchEarliestData,
  FetchHostLatency,
  FetchLiveConnectivity,
  FetchMetrics,
  FetchOutages,
  FetchPingHosts,
  FetchSpeedtestHistory,
  FetchSummary,
  rangeRequest,
  SaveSettings,
  TriggerSpeedtest,
} from "@/dashboard/command";
import {
  bucketCount,
  bucketIndexOf,
  bucketStartMs,
} from "@/dashboard/connectivity";
import {
  type DateRangeSelection,
  isAllTime,
  Preset,
  rangeFromBrush,
} from "@/dashboard/dateRange";
import * as DateRangePicker from "@/dashboard/dateRangePicker";
import { speedClause } from "@/dashboard/format";
import { assignIncidents } from "@/dashboard/incidents";
import type { LatencyView } from "@/dashboard/latencyView";
import { LatencyViewRadioGroup } from "@/dashboard/latencyViewRadioGroup";
import {
  DashboardMenu,
  isThemeItem,
  type MenuItem,
  THEME_ITEMS,
} from "@/dashboard/menu";
import {
  GotDateRangePickerMessage,
  GotLatencyViewMessage,
  GotMenuMessage,
  GotToastMessage,
  type Message,
  type OutMessage,
  type RangeRequest,
  RequestedLogout,
} from "@/dashboard/message";
import {
  answersCurrentRange,
  HostLatencyAsyncData,
  isAwaitingEarliestData,
  type Model,
  settingsFromModel,
} from "@/dashboard/model";
import { segmentForKey } from "@/dashboard/ribbon";
import type { ThemePreference } from "@/dashboard/theme";
import { Toast } from "@/dashboard/toast";
import { hostLatencyFor } from "@/dashboard/view/derived";

// `now` is injected (rather than read via `Date.now()` here) so `update`
// stays pure with respect to its inputs — the app boundary (auth/update.ts)
// supplies the real clock, and tests can supply a fixed one.
export type Context = {
  readonly maybeToken: Option.Option<string>;
  readonly now: () => number;
};

type StepReturn = Update.Return<Model, Message>;
type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>;
const withUpdateReturn = M.withReturnType<UpdateReturn>();

const ignoreStale = (
  model: Model,
  request: RangeRequest,
  apply: () => StepReturn
): StepReturn => (answersCurrentRange(model, request) ? apply() : { model });

// Nothing scoped to the range can be fetched until "All time" knows its start.
const rangeFetches = (
  model: Model,
  commands: ReadonlyArray<Command.Command<Message>>
): ReadonlyArray<Command.Command<Message>> =>
  isAwaitingEarliestData(model) ? [] : commands;

// Re-asserts the model's theme onto `<html>` so it matches even if the boot
// script's pre-hydration paint (`index.html`) somehow diverged from it.
const applyThemeOnEnter = (model: Model): StepReturn => ({
  model,
  commands: [ApplyTheme({ theme: model.theme })],
});

// Asks while the start of "All time" is unknown, so a fetch that failed, or that
// ran before the monitor wrote its first sample, does not leave "All time" on
// its fallback window for good.
const fetchEarliestDataIfUnknown =
  (context: Context) =>
  (model: Model): StepReturn =>
    Option.isNone(model.maybeEarliestDataMs)
      ? {
          model,
          commands: [FetchEarliestData({ maybeToken: context.maybeToken })],
        }
      : { model };

const refetchEarliestDataForAllTime =
  (context: Context) =>
  (model: Model): StepReturn =>
    isAllTime(model.dateRange)
      ? fetchEarliestDataIfUnknown(context)(model)
      : { model };

// A tick retries what failed as well as refreshing what loaded, so one
// transient failure does not stay on screen while auto-refresh reads "on". A
// failure stays as it is while the retry is in flight, so a source that keeps
// failing does not flicker through a loading state on every tick. A source
// that was never asked for is left for `EnteredDashboard`.
const revalidateOrRetry = <A, E>(
  data: AsyncData.AsyncData<A, E>
): Option.Option<AsyncData.AsyncData<A, E>> =>
  AsyncData.isFailure(data) ? Option.some(data) : AsyncData.revalidate(data);

// The time range changing means the current window's data (or in-flight
// fetch) belongs to a query that no longer applies, so this always starts a
// fresh fetch — unlike revalidateOrLoad, which intentionally leaves an
// in-flight fetch alone because that fetch is still answering the same query.
const forceReload = <A, E>(
  data: AsyncData.AsyncData<A, E>
): AsyncData.AsyncData<A, E> =>
  Option.match(AsyncData.getData(data), {
    onNone: () => AsyncData.Loading(),
    onSome: (value) => AsyncData.Refreshing({ data: value }),
  });

// The per-host latency lines need the host list, and are only fetched while
// the latency chart is in that view.
const configuredHostNames = (model: Model): ReadonlyArray<string> =>
  Option.match(AsyncData.getData(model.pingHosts), {
    onNone: () => [],
    onSome: ({ hosts }) => hosts,
  });

const canFetchHostLatency = (model: Model): boolean =>
  model.latencyView === "perHost" && configuredHostNames(model).length > 0;

type Transition<A, E> = (
  data: AsyncData.AsyncData<A, E>
) => Option.Option<AsyncData.AsyncData<A, E>>;

const neverLoad = <A, E>(): Option.Option<AsyncData.AsyncData<A, E>> =>
  Option.none();

const retryFailure = <A, E>(
  data: AsyncData.AsyncData<A, E>
): Option.Option<AsyncData.AsyncData<A, E>> =>
  AsyncData.isFailure(data) ? Option.some(data) : Option.none();

const reloadAlways = <A, E>(
  data: AsyncData.AsyncData<A, E>
): Option.Option<AsyncData.AsyncData<A, E>> => Option.some(forceReload(data));

// A Stale live status is one the latest fetch could not confirm, so its
// refetch starts from Loading rather than showing that value again while the
// request is in flight.
const restartingStale =
  <A, E>(next: Transition<A, E>): Transition<A, E> =>
  (data) =>
    AsyncData.isStale(data) ? Option.some(AsyncData.Loading()) : next(data);

// A range-scoped fetch waits on `rangeFetches` and reruns whenever the range moves.
type ResourceFetch =
  | Readonly<{
      scope: "range";
      fetch: (
        maybeToken: Option.Option<string>,
        request: RangeRequest,
        model: Model
      ) => Command.Command<Message>;
    }>
  | Readonly<{
      scope: "global";
      fetch: (maybeToken: Option.Option<string>) => Command.Command<Message>;
    }>;

type ResourceSpec<A, E> = ResourceFetch &
  Readonly<{
    read: (model: Model) => AsyncData.AsyncData<A, E>;
    write: (model: Model, next: AsyncData.AsyncData<A, E>) => Model;
    isWanted: (model: Model) => boolean;
    enter: Transition<A, E>;
    tick: Transition<A, E>;
    reload: Transition<A, E>;
  }>;

type LifecycleStep = (context: Context) => (model: Model) => StepReturn;

type Resource = Readonly<{
  scope: ResourceFetch["scope"];
  enter: LifecycleStep;
  tick: LifecycleStep;
  reload: LifecycleStep;
}>;

const always = (): boolean => true;

const resource = <A, E>(spec: ResourceSpec<A, E>): Resource => {
  const fetchCommands = (
    context: Context,
    model: Model
  ): ReadonlyArray<Command.Command<Message>> =>
    spec.scope === "range"
      ? rangeFetches(model, [
          spec.fetch(context.maybeToken, rangeRequest(model), model),
        ])
      : [spec.fetch(context.maybeToken)];

  const step =
    (transition: Transition<A, E>): LifecycleStep =>
    (context) =>
    (model) => {
      if (!spec.isWanted(model)) return { model };
      const current = spec.read(model);
      return Option.match(transition(current), {
        onNone: () => ({ model }),
        onSome: (next) => ({
          model: next === current ? model : spec.write(model, next),
          commands: fetchCommands(context, model),
        }),
      });
    };

  return {
    scope: spec.scope,
    enter: step(spec.enter),
    tick: step(spec.tick),
    reload: step(spec.reload),
  };
};

const METRICS = resource({
  scope: "range",
  fetch: (maybeToken, request) => FetchMetrics({ maybeToken, ...request }),
  read: (model) => model.metrics,
  write: (model, metrics) => modifyFields(model, { metrics: () => metrics }),
  isWanted: always,
  enter: AsyncData.loadIfMissing,
  tick: revalidateOrRetry,
  reload: reloadAlways,
});

const SPEEDTEST_HISTORY = resource({
  scope: "range",
  fetch: (maybeToken, request) =>
    FetchSpeedtestHistory({ maybeToken, ...request }),
  read: (model) => model.speedtestHistory,
  write: (model, speedtestHistory) =>
    modifyFields(model, { speedtestHistory: () => speedtestHistory }),
  isWanted: always,
  enter: AsyncData.loadIfMissing,
  tick: revalidateOrRetry,
  reload: reloadAlways,
});

const CONNECTIVITY_STATUS = resource({
  scope: "range",
  fetch: (maybeToken, request) =>
    FetchConnectivityStatus({ maybeToken, ...request }),
  read: (model) => model.connectivityStatus,
  write: (model, connectivityStatus) =>
    modifyFields(model, { connectivityStatus: () => connectivityStatus }),
  isWanted: always,
  enter: AsyncData.loadIfMissing,
  tick: revalidateOrRetry,
  reload: reloadAlways,
});

const LIVE_CONNECTIVITY = resource({
  scope: "global",
  fetch: (maybeToken) => FetchLiveConnectivity({ maybeToken }),
  read: (model) => model.liveConnectivity,
  write: (model, liveConnectivity) =>
    modifyFields(model, { liveConnectivity: () => liveConnectivity }),
  isWanted: always,
  enter: AsyncData.loadIfMissing,
  tick: restartingStale(revalidateOrRetry),
  reload: restartingStale(reloadAlways),
});

const SUMMARY = resource({
  scope: "range",
  fetch: (maybeToken, request) => FetchSummary({ maybeToken, ...request }),
  read: (model) => model.summary,
  write: (model, summary) => modifyFields(model, { summary: () => summary }),
  isWanted: always,
  enter: AsyncData.loadIfMissing,
  tick: revalidateOrRetry,
  reload: reloadAlways,
});

const OUTAGES = resource({
  scope: "range",
  fetch: (maybeToken, request) => FetchOutages({ maybeToken, ...request }),
  read: (model) => model.outages,
  write: (model, outages) => modifyFields(model, { outages: () => outages }),
  isWanted: always,
  enter: AsyncData.loadIfMissing,
  tick: revalidateOrRetry,
  reload: reloadAlways,
});

// The host list is static config, so a tick only retries a failed one.
const PING_HOSTS = resource({
  scope: "global",
  fetch: (maybeToken) => FetchPingHosts({ maybeToken }),
  read: (model) => model.pingHosts,
  write: (model, pingHosts) =>
    modifyFields(model, { pingHosts: () => pingHosts }),
  isWanted: always,
  enter: AsyncData.loadIfMissing,
  tick: retryFailure,
  reload: reloadAlways,
});

// Loaded from `SucceededFetchPingHosts` and `selectLatencyView`, not on entry:
// it needs the host list first.
const HOST_LATENCY = resource({
  scope: "range",
  fetch: (maybeToken, request, model) =>
    FetchHostLatency({
      maybeToken,
      ...request,
      hosts: configuredHostNames(model),
    }),
  read: (model) => model.hostLatency,
  write: (model, hostLatency) =>
    modifyFields(model, { hostLatency: () => hostLatency }),
  isWanted: canFetchHostLatency,
  enter: neverLoad,
  tick: revalidateOrRetry,
  reload: reloadAlways,
});

const RESOURCES = [
  METRICS,
  SPEEDTEST_HISTORY,
  CONNECTIVITY_STATUS,
  LIVE_CONNECTIVITY,
  SUMMARY,
  OUTAGES,
  PING_HOSTS,
  HOST_LATENCY,
];

// Per-host results that land after the viewer switched back to all hosts have
// nothing left to feed, and a stale failure would raise a banner Retry can't
// clear.
const answersPerHostView = (model: Model, request: RangeRequest): boolean =>
  model.latencyView === "perHost" && answersCurrentRange(model, request);

// Every path that moves the range reloads this one list.
const RANGE_SCOPED = RESOURCES.filter(({ scope }) => scope === "range");

const reloadRangeScoped =
  (context: Context) =>
  (model: Model): StepReturn =>
    Update.combine(
      model,
      RANGE_SCOPED.map(({ reload }) => reload(context))
    );

const incidentsOf = (model: Model) =>
  Option.match(AsyncData.getData(model.outages), {
    onNone: () => [],
    onSome: ({ log, request }) =>
      answersCurrentRange(model, request) ? assignIncidents(log.data) : [],
  });

// The bucket a key moves the pin to, read off the window the ribbon is drawn
// from; with no window for the selected range there is nothing to move through.
const pinAfterKey = (
  model: Model,
  key: string,
  maybeSelectedStartMs: Option.Option<number>
): Option.Option<number> =>
  Option.match(
    Option.filter(AsyncData.getData(model.connectivityStatus), ({ request }) =>
      answersCurrentRange(model, request)
    ),
    {
      onNone: () => maybeSelectedStartMs,
      onSome: (window) =>
        Option.match(
          segmentForKey(
            key,
            Option.flatMap(maybeSelectedStartMs, (startMs) =>
              bucketIndexOf(window, startMs)
            ),
            bucketCount(window)
          ),
          {
            onNone: () => maybeSelectedStartMs,
            onSome: (index) => Option.some(bucketStartMs(window, index)),
          }
        ),
    }
  );

// Each chart only needs re-painting when it's actually mounted, there's data
// to show it, and the window that data was fetched for is known. That window
// comes from the model, never from `model.dateRange` (see `TimelineWindow`).

// The per-host view is drawn from the host series alone, on the window they
// were fetched for, so it does not wait on the all-hosts metrics. Until the
// series answer the selected range the all-hosts line stands in.
const syncLatencyChart = (
  model: Model
): ReadonlyArray<Command.Command<Message>> =>
  Option.match(model.maybeLatencyChartHostId, {
    onNone: () => [],
    onSome: (hostId) => {
      const maybeHosts =
        model.latencyView === "perHost"
          ? AsyncData.getData(hostLatencyFor(model))
          : Option.none();
      return Option.match(maybeHosts, {
        onSome: ({ series, window }) => [
          SyncLatencyChart({
            hostId,
            metrics: AsyncData.getOrElse(model.metrics, () => []),
            hostSeries: series,
            startTimeMs: window.startTimeMs,
            endTimeMs: window.endTimeMs,
            granularity: window.granularity,
            incidents: incidentsOf(model),
          }),
        ],
        onNone: () =>
          Option.match(
            Option.all([
              AsyncData.getData(model.metrics),
              model.maybeMetricsWindow,
            ]),
            {
              onNone: () => [],
              onSome: ([metrics, window]) => [
                SyncLatencyChart({
                  hostId,
                  metrics,
                  hostSeries: [],
                  startTimeMs: window.startTimeMs,
                  endTimeMs: window.endTimeMs,
                  granularity: window.granularity,
                  incidents: incidentsOf(model),
                }),
              ],
            }
          ),
      });
    },
  });

const syncPacketLossChart = (
  model: Model
): ReadonlyArray<Command.Command<Message>> =>
  Option.match(
    Option.all([
      model.maybePacketLossChartHostId,
      AsyncData.getData(model.metrics),
      model.maybeMetricsWindow,
    ]),
    {
      onNone: () => [],
      onSome: ([hostId, metrics, window]) => [
        SyncPacketLossChart({
          hostId,
          metrics,
          startTimeMs: window.startTimeMs,
          endTimeMs: window.endTimeMs,
          granularity: window.granularity,
          incidents: incidentsOf(model),
        }),
      ],
    }
  );

const syncJitterChart = (
  model: Model
): ReadonlyArray<Command.Command<Message>> =>
  Option.match(
    Option.all([
      model.maybeJitterChartHostId,
      AsyncData.getData(model.metrics),
      model.maybeMetricsWindow,
    ]),
    {
      onNone: () => [],
      onSome: ([hostId, metrics, window]) => [
        SyncJitterChart({
          hostId,
          metrics,
          startTimeMs: window.startTimeMs,
          endTimeMs: window.endTimeMs,
          granularity: window.granularity,
          incidents: incidentsOf(model),
        }),
      ],
    }
  );

const syncSpeedChart = (
  model: Model
): ReadonlyArray<Command.Command<Message>> =>
  Option.match(
    Option.all([
      model.maybeSpeedChartHostId,
      AsyncData.getData(model.speedtestHistory),
      model.maybeSpeedtestWindow,
    ]),
    {
      onNone: () => [],
      onSome: ([hostId, metrics, window]) => [
        SyncSpeedChart({
          hostId,
          metrics,
          startTimeMs: window.startTimeMs,
          endTimeMs: window.endTimeMs,
        }),
      ],
    }
  );

const syncQualityCharts = (
  model: Model
): ReadonlyArray<Command.Command<Message>> => [
  ...syncLatencyChart(model),
  ...syncPacketLossChart(model),
  ...syncJitterChart(model),
];

const syncAllCharts = (
  model: Model
): ReadonlyArray<Command.Command<Message>> => [
  ...syncQualityCharts(model),
  ...syncSpeedChart(model),
];

// ApplyTheme goes first in every theme change: the chart syncs resolve their
// palette from `<html>`'s class, so it has to be current when they run.
const setThemePreference = (
  model: Model,
  preference: ThemePreference
): StepReturn => {
  const nextModel = modifyFields(model, { theme: () => preference });
  return {
    model: nextModel,
    commands: [
      ApplyTheme({ theme: preference }),
      SaveSettings({ settings: settingsFromModel(nextModel) }),
      ...syncAllCharts(nextModel),
    ],
  };
};

// A range the viewer chooses ends any narrowing a brush did; a brush starts
// one, remembering the range it cut down from, the first time only.
type RangeOrigin = "chosen" | "brush";

const applyDateRange =
  (context: Context, selection: DateRangeSelection, origin: RangeOrigin) =>
  (model: Model): StepReturn => {
    const { model: nextModel, commands: reloadCommands } = reloadRangeScoped(
      context
    )(
      // The ribbon's buckets change with the range, so a hovered or pinned
      // one means nothing in the new window.
      modifyFields(model, {
        dateRange: () => selection,
        hoveredSegmentIndex: () => Option.none(),
        maybeSelectedBucketStartMs: () => Option.none(),
        maybeRangeBeforeBrush: (before) =>
          origin === "chosen"
            ? Option.none()
            : Option.orElse(before, () => Option.some(model.dateRange)),
        // Series for the old range must not paint under the new one.
        hostLatency: () => HostLatencyAsyncData.Idle(),
      })
    );
    return {
      model: nextModel,
      commands: [
        ...(reloadCommands ?? []),
        SaveSettings({ settings: settingsFromModel(nextModel) }),
      ],
    };
  };

const selectLatencyView =
  (context: Context, view: LatencyView) =>
  (model: Model): StepReturn => {
    if (view === model.latencyView) return { model };
    const nextModel = modifyFields(model, {
      latencyView: () => view,
      // The all-hosts line has no use for them, and by the time the viewer
      // comes back the range may have moved on.
      hostLatency: () => HostLatencyAsyncData.Idle(),
    });
    const { model: loaded, commands: fetchCommands } =
      HOST_LATENCY.reload(context)(nextModel);
    return {
      model: loaded,
      commands: [
        SaveSettings({ settings: settingsFromModel(loaded) }),
        ...(fetchCommands ?? []),
        ...syncLatencyChart(loaded),
      ],
    };
  };

const startSpeedtest =
  (context: Context) =>
  (model: Model): StepReturn => ({
    model: modifyFields(model, { speedtestTrigger: () => AsyncData.Loading() }),
    commands: [TriggerSpeedtest({ maybeToken: context.maybeToken })],
  });

const selectMenuItem = (
  context: Context,
  model: Model,
  item: MenuItem
): UpdateReturn =>
  M.value(item).pipe(
    withUpdateReturn,
    M.when(isThemeItem, (themeItem) =>
      setThemePreference(model, THEME_ITEMS[themeItem].preference)
    ),
    M.when("RunSpeedTest", () => startSpeedtest(context)(model)),
    M.when("Logout", () => ({ model, outMessage: RequestedLogout() })),
    M.exhaustive
  );

// A start that was unknown reloads "All time" from it; one it already had does
// not move, so a later, older sample leaves the range where it is.
const settleEarliestData = (
  context: Context,
  model: Model,
  maybeEarliestMs: Option.Option<number>
): StepReturn => {
  const needsReload =
    isAllTime(model.dateRange) &&
    (isAwaitingEarliestData(model) ||
      (Option.isNone(model.maybeEarliestDataMs) &&
        Option.isSome(maybeEarliestMs)));
  const nextModel = modifyFields(model, {
    maybeEarliestDataMs: () => maybeEarliestMs,
    isEarliestDataSettled: () => true,
  });
  return needsReload
    ? reloadRangeScoped(context)(nextModel)
    : { model: nextModel };
};

export const update = (
  model: Model,
  message: Message,
  context: Context
): UpdateReturn =>
  M.value(message).pipe(
    withUpdateReturn,
    M.tags({
      EnteredDashboard: () =>
        Update.combine(model, [
          ...RESOURCES.map(({ enter }) => enter(context)),
          fetchEarliestDataIfUnknown(context),
          applyThemeOnEnter,
        ]),

      TickedRefresh: () =>
        Update.combine(model, [
          ...RESOURCES.map(({ tick }) => tick(context)),
          refetchEarliestDataForAllTime(context),
        ]),

      TickedClock: ({ nowMs }) =>
        nowMs === model.nowMs
          ? { model }
          : { model: modifyFields(model, { nowMs: () => nowMs }) },

      GotDateRangePickerMessage: ({ message: pickerMessage }) => {
        const {
          model: nextPicker,
          commands: pickerCommands,
          outMessage,
        } = DateRangePicker.update(
          model.dateRangePicker,
          pickerMessage,
          model.dateRange,
          context.now(),
          model.maybeEarliestDataMs
        );
        const mappedCommands = Command.mapMessages(
          pickerCommands ?? [],
          (message) => GotDateRangePickerMessage({ message })
        );
        const withPicker = modifyFields(model, {
          dateRangePicker: () => nextPicker,
        });

        if (outMessage === undefined) {
          return { model: withPicker, commands: mappedCommands };
        }

        return M.value(outMessage).pipe(
          withUpdateReturn,
          M.tag("AppliedRange", ({ selection }) => {
            const { model: nextModel, commands: appliedCommands } =
              applyDateRange(context, selection, "chosen")(withPicker);
            return {
              model: nextModel,
              commands: [...mappedCommands, ...(appliedCommands ?? [])],
            };
          }),
          M.tag("Cancelled", () => ({
            model: withPicker,
            commands: mappedCommands,
          })),
          M.exhaustive
        );
      },

      SelectedQuickRange: ({ preset }) =>
        applyDateRange(context, Preset({ preset }), "chosen")(model),

      ClickedRefreshNow: () =>
        Update.combine(model, [
          ...RESOURCES.map(({ reload }) => reload(context)),
          fetchEarliestDataIfUnknown(context),
        ]),

      SucceededFetchMetrics: ({
        request,
        metrics,
        nowMs,
        startTimeMs,
        endTimeMs,
        granularity,
      }) =>
        ignoreStale(model, request, () => {
          const nextModel = modifyFields(model, {
            metrics: () =>
              AsyncData.settle(model.metrics, Result.succeed(metrics)),
            maybeMetricsWindow: () =>
              Option.some({ startTimeMs, endTimeMs, granularity, request }),
            maybeLastUpdatedMs: () => Option.some(nowMs),
          });
          return { model: nextModel, commands: syncQualityCharts(nextModel) };
        }),
      FailedFetchMetrics: ({ request, error }) =>
        ignoreStale(model, request, () => ({
          model: modifyFields(model, {
            metrics: () => AsyncData.settle(model.metrics, Result.fail(error)),
          }),
        })),

      SucceededFetchSpeedtestHistory: ({
        request,
        history,
        startTimeMs,
        endTimeMs,
      }) =>
        ignoreStale(model, request, () => {
          const nextModel = modifyFields(model, {
            speedtestHistory: () =>
              AsyncData.settle(model.speedtestHistory, Result.succeed(history)),
            maybeSpeedtestWindow: () =>
              Option.some({ startTimeMs, endTimeMs, request }),
          });
          return { model: nextModel, commands: syncSpeedChart(nextModel) };
        }),
      FailedFetchSpeedtestHistory: ({ request, error }) =>
        ignoreStale(model, request, () => ({
          model: modifyFields(model, {
            speedtestHistory: () =>
              AsyncData.settle(model.speedtestHistory, Result.fail(error)),
          }),
        })),

      SucceededFetchConnectivityStatus: ({
        request,
        points,
        maybeUptimePercentage,
        maybeAvailabilityPercentage,
        coveragePercentage,
        startTimeMs,
        endTimeMs,
        granularity,
      }) =>
        ignoreStale(model, request, () => ({
          model: modifyFields(model, {
            connectivityStatus: () =>
              AsyncData.settle(
                model.connectivityStatus,
                Result.succeed({
                  points,
                  maybeUptimePercentage,
                  maybeAvailabilityPercentage,
                  coveragePercentage,
                  startTimeMs,
                  endTimeMs,
                  granularity,
                  request,
                })
              ),
          }),
        })),
      FailedFetchConnectivityStatus: ({ request, error }) =>
        ignoreStale(model, request, () => ({
          model: modifyFields(model, {
            connectivityStatus: () =>
              AsyncData.settle(model.connectivityStatus, Result.fail(error)),
          }),
        })),

      SucceededFetchLiveConnectivity: ({ status, maybeLastSampleAtMs }) => ({
        model: modifyFields(model, {
          liveConnectivity: () =>
            AsyncData.settle(
              model.liveConnectivity,
              Result.succeed({ status, maybeLastSampleAtMs })
            ),
        }),
      }),
      FailedFetchLiveConnectivity: ({ error }) => ({
        model: modifyFields(model, {
          liveConnectivity: () =>
            AsyncData.settle(model.liveConnectivity, Result.fail(error)),
        }),
      }),

      SucceededFetchSummary: ({ summary, request }) =>
        ignoreStale(model, request, () => ({
          model: modifyFields(model, {
            summary: () =>
              AsyncData.settle(
                model.summary,
                Result.succeed({ summary, request })
              ),
          }),
        })),
      FailedFetchSummary: ({ error, request }) =>
        ignoreStale(model, request, () => ({
          model: modifyFields(model, {
            summary: () => AsyncData.settle(model.summary, Result.fail(error)),
          }),
        })),

      SucceededFetchOutages: ({ outages, isClamped, fetchedAtMs, request }) =>
        ignoreStale(model, request, () => {
          const nextModel = modifyFields(model, {
            outages: () =>
              AsyncData.settle(
                model.outages,
                Result.succeed({
                  log: outages,
                  isClamped,
                  fetchedAtMs,
                  request,
                })
              ),
          });
          return { model: nextModel, commands: syncQualityCharts(nextModel) };
        }),
      FailedFetchOutages: ({ error, request }) =>
        ignoreStale(model, request, () => ({
          model: modifyFields(model, {
            outages: () => AsyncData.settle(model.outages, Result.fail(error)),
          }),
        })),

      // The per-host lines wait on the host list: when it arrives while that
      // view is open and nothing has been asked for yet, ask now.
      SucceededFetchPingHosts: ({ hosts }) => {
        const nextModel = modifyFields(model, {
          pingHosts: () =>
            AsyncData.settle(model.pingHosts, Result.succeed(hosts)),
        });
        return AsyncData.isIdle(nextModel.hostLatency)
          ? Update.combine(nextModel, [HOST_LATENCY.reload(context)])
          : { model: nextModel };
      },
      FailedFetchPingHosts: ({ error }) => ({
        model: modifyFields(model, {
          pingHosts: () =>
            AsyncData.settle(model.pingHosts, Result.fail(error)),
        }),
      }),

      // "All time" has no start until this answers, so a restored "All time"
      // holds back its range fetches (see `rangeFetches`) and loads them here,
      // from the earliest datapoint or, with none, from its fallback window.
      SucceededFetchEarliestData: ({ earliestMs }) =>
        settleEarliestData(context, model, earliestMs),
      FailedFetchEarliestData: () =>
        settleEarliestData(context, model, model.maybeEarliestDataMs),

      ClickedTogglePause: () => {
        const nextModel = modifyFields(model, {
          isPaused: (paused) => !paused,
        });
        return {
          model: nextModel,
          commands: [SaveSettings({ settings: settingsFromModel(nextModel) })],
        };
      },

      // Foldkit re-renders on any new model reference, so a message that
      // changes nothing returns the model it was given.
      Interacted: () =>
        model.isIdle
          ? { model: modifyFields(model, { isIdle: () => false }) }
          : { model },
      WentIdle: () =>
        model.isIdle
          ? { model }
          : { model: modifyFields(model, { isIdle: () => true }) },

      GotLatencyViewMessage: ({ message: radioMessage }) => {
        const {
          model: nextRadioGroup,
          commands: radioCommands,
          outMessage,
        } = LatencyViewRadioGroup.update(
          model.latencyViewRadioGroup,
          radioMessage
        );
        const withRadioGroup = modifyFields(model, {
          latencyViewRadioGroup: () => nextRadioGroup,
        });
        const mappedCommands = Command.mapMessages(
          radioCommands ?? [],
          (message) => GotLatencyViewMessage({ message })
        );

        if (outMessage === undefined) {
          return { model: withRadioGroup, commands: mappedCommands };
        }

        const selected = selectLatencyView(
          context,
          outMessage.value
        )(withRadioGroup);
        return {
          ...selected,
          commands: [...mappedCommands, ...(selected.commands ?? [])],
        };
      },

      SucceededFetchHostLatency: ({
        series,
        startTimeMs,
        endTimeMs,
        granularity,
        request,
      }) => {
        if (!answersPerHostView(model, request)) return { model };
        const nextModel = modifyFields(model, {
          hostLatency: () =>
            AsyncData.settle(
              model.hostLatency,
              Result.succeed({
                series,
                window: { startTimeMs, endTimeMs, granularity, request },
              })
            ),
        });
        return { model: nextModel, commands: syncLatencyChart(nextModel) };
      },
      FailedFetchHostLatency: ({ error, request }) =>
        answersPerHostView(model, request)
          ? {
              model: modifyFields(model, {
                hostLatency: () =>
                  AsyncData.settle(model.hostLatency, Result.fail(error)),
              }),
            }
          : { model },

      BrushedChartRange: ({ startMs, endMs }) =>
        Option.match(rangeFromBrush(startMs, endMs), {
          onNone: () => ({ model }),
          onSome: (range) => applyDateRange(context, range, "brush")(model),
        }),

      ClickedResetRange: () =>
        Option.match(model.maybeRangeBeforeBrush, {
          onNone: () => ({ model }),
          onSome: (range) => applyDateRange(context, range, "chosen")(model),
        }),

      HoveredConnectivitySegment: ({ index }) => ({
        model: modifyFields(model, {
          hoveredSegmentIndex: () => Option.some(index),
        }),
      }),
      UnhoveredConnectivitySegment: () => ({
        model: modifyFields(model, {
          hoveredSegmentIndex: () => Option.none(),
        }),
      }),
      ToggledConnectivitySegment: ({ startMs }) => ({
        model: modifyFields(model, {
          maybeSelectedBucketStartMs: (selected) =>
            Option.contains(selected, startMs)
              ? Option.none()
              : Option.some(startMs),
        }),
      }),
      ClearedConnectivitySelection: () => ({
        model: modifyFields(model, {
          maybeSelectedBucketStartMs: () => Option.none(),
        }),
      }),
      PressedRibbonKey: ({ key }) => ({
        model: modifyFields(model, {
          maybeSelectedBucketStartMs: (selected) =>
            key === "Escape"
              ? Option.none()
              : pinAfterKey(model, key, selected),
        }),
      }),
      MeasuredRibbon: ({ widthPx }) => ({
        model: modifyFields(model, {
          maybeRibbonWidthPx: () => Option.some(widthPx),
        }),
      }),

      ChangedSystemTheme: () =>
        model.theme === "system"
          ? {
              model,
              commands: [
                ApplyTheme({ theme: model.theme }),
                ...syncAllCharts(model),
              ],
            }
          : { model },

      GotMenuMessage: ({ message: menuMessage }) => {
        const {
          model: nextMenu,
          commands: menuCommands,
          outMessage,
        } = DashboardMenu.update(model.menu, menuMessage);
        const withMenu = modifyFields(model, { menu: () => nextMenu });
        const mappedCommands = Command.mapMessages(
          menuCommands ?? [],
          (message) => GotMenuMessage({ message })
        );

        if (outMessage === undefined) {
          return { model: withMenu, commands: mappedCommands };
        }

        const selected = selectMenuItem(context, withMenu, outMessage.value);
        return {
          ...selected,
          commands: [...mappedCommands, ...(selected.commands ?? [])],
        };
      },

      ClickedTriggerSpeedtest: () => startSpeedtest(context)(model),
      SucceededTriggerSpeedtest: ({ downloadMbps, uploadMbps, pingMs }) => {
        const { model: toastModel, commands: toastCommands } = Toast.show(
          model.toast,
          {
            variant: "Success",
            payload: {
              title: "Speed test complete",
              description: `${speedClause(downloadMbps, "down")}, ${speedClause(uploadMbps, "up")}`,
            },
          }
        );
        const { model: reloaded, commands: reloadCommands = [] } =
          Update.combine(
            modifyFields(model, {
              speedtestTrigger: () =>
                AsyncData.Success({
                  data: { downloadMbps, uploadMbps, pingMs },
                }),
              toast: () => toastModel,
            }),
            [METRICS, SPEEDTEST_HISTORY, SUMMARY].map(({ reload }) =>
              reload(context)
            )
          );
        return {
          model: reloaded,
          commands: [
            ...reloadCommands,
            ...Command.mapMessages(toastCommands ?? [], (message) =>
              GotToastMessage({ message })
            ),
          ],
        };
      },
      FailedTriggerSpeedtest: ({ message, isAlreadyRunning }) => {
        const { model: toastModel, commands: toastCommands } = Toast.show(
          model.toast,
          {
            variant: isAlreadyRunning ? "Warning" : "Error",
            payload: {
              title: isAlreadyRunning
                ? "Speed test in progress"
                : "Speed test failed",
              description: message,
            },
          }
        );
        return {
          model: modifyFields(model, {
            speedtestTrigger: () => AsyncData.Failure({ error: message }),
            toast: () => toastModel,
          }),
          commands: Command.mapMessages(toastCommands ?? [], (message) =>
            GotToastMessage({ message })
          ),
        };
      },

      SucceededMountLatencyChart: ({ hostId }) => {
        const nextModel = modifyFields(model, {
          maybeLatencyChartHostId: () => Option.some(hostId),
        });
        return { model: nextModel, commands: syncLatencyChart(nextModel) };
      },
      SucceededMountPacketLossChart: ({ hostId }) => {
        const nextModel = modifyFields(model, {
          maybePacketLossChartHostId: () => Option.some(hostId),
        });
        return { model: nextModel, commands: syncPacketLossChart(nextModel) };
      },
      SucceededMountJitterChart: ({ hostId }) => {
        const nextModel = modifyFields(model, {
          maybeJitterChartHostId: () => Option.some(hostId),
        });
        return { model: nextModel, commands: syncJitterChart(nextModel) };
      },
      SucceededMountSpeedChart: ({ hostId }) => {
        const nextModel = modifyFields(model, {
          maybeSpeedChartHostId: () => Option.some(hostId),
        });
        return { model: nextModel, commands: syncSpeedChart(nextModel) };
      },

      GotToastMessage: ({ message }) => {
        const { model: nextToast, commands } = Toast.update(
          model.toast,
          message
        );
        return {
          model: modifyFields(model, { toast: () => nextToast }),
          commands: Command.mapMessages(commands ?? [], (message) =>
            GotToastMessage({ message })
          ),
        };
      },
    }),
    // Fire-and-forget acknowledgments: the effect already happened (a mount
    // failed, a chart repaint settled), so there's nothing left to do beyond
    // letting DevTools/Story/Scene see the Command settled.
    M.tag(
      "FailedMountLatencyChart",
      "CompletedSyncLatencyChart",
      "FailedSyncLatencyChart",
      "FailedMountPacketLossChart",
      "CompletedSyncPacketLossChart",
      "FailedSyncPacketLossChart",
      "FailedMountJitterChart",
      "CompletedSyncJitterChart",
      "FailedSyncJitterChart",
      "FailedMountSpeedChart",
      "CompletedSyncSpeedChart",
      "FailedSyncSpeedChart",
      "CompletedApplyTheme",
      "CompletedSaveSettings",
      "FailedSaveSettings",
      () => ({ model })
    ),
    M.exhaustive
  );
