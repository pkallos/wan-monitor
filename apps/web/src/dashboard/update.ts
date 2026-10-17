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
export type Context = { readonly token: string; readonly now: () => number };

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

const fetchMetricsCommand = (context: Context, model: Model) =>
  FetchMetrics({ token: context.token, ...rangeRequest(model) });

const fetchSpeedtestHistoryCommand = (context: Context, model: Model) =>
  FetchSpeedtestHistory({ token: context.token, ...rangeRequest(model) });

const fetchConnectivityStatusCommand = (context: Context, model: Model) =>
  FetchConnectivityStatus({ token: context.token, ...rangeRequest(model) });

const fetchSummaryCommand = (context: Context, model: Model) =>
  FetchSummary({ token: context.token, ...rangeRequest(model) });

const fetchOutagesCommand = (context: Context, model: Model) =>
  FetchOutages({ token: context.token, ...rangeRequest(model) });

const enterMetrics =
  (context: Context) =>
  (model: Model): StepReturn =>
    Option.match(AsyncData.loadIfMissing(model.metrics), {
      onNone: () => ({ model }),
      onSome: (next) => ({
        model: modifyFields(model, { metrics: () => next }),
        commands: rangeFetches(model, [fetchMetricsCommand(context, model)]),
      }),
    });

const enterSpeedtestHistory =
  (context: Context) =>
  (model: Model): StepReturn =>
    Option.match(AsyncData.loadIfMissing(model.speedtestHistory), {
      onNone: () => ({ model }),
      onSome: (next) => ({
        model: modifyFields(model, { speedtestHistory: () => next }),
        commands: rangeFetches(model, [
          fetchSpeedtestHistoryCommand(context, model),
        ]),
      }),
    });

const enterConnectivityStatus =
  (context: Context) =>
  (model: Model): StepReturn =>
    Option.match(AsyncData.loadIfMissing(model.connectivityStatus), {
      onNone: () => ({ model }),
      onSome: (next) => ({
        model: modifyFields(model, { connectivityStatus: () => next }),
        commands: rangeFetches(model, [
          fetchConnectivityStatusCommand(context, model),
        ]),
      }),
    });

const enterLiveConnectivity =
  (context: Context) =>
  (model: Model): StepReturn =>
    Option.match(AsyncData.loadIfMissing(model.liveConnectivity), {
      onNone: () => ({ model }),
      onSome: (next) => ({
        model: modifyFields(model, { liveConnectivity: () => next }),
        commands: [FetchLiveConnectivity({ token: context.token })],
      }),
    });

// Re-asserts the model's theme onto `<html>` so it matches even if the boot
// script's pre-hydration paint (`index.html`) somehow diverged from it.
const applyThemeOnEnter = (model: Model): StepReturn => ({
  model,
  commands: [ApplyTheme({ theme: model.theme })],
});

const enterEarliestData =
  (context: Context) =>
  (model: Model): StepReturn =>
    Option.match(model.maybeEarliestDataMs, {
      onNone: () => ({
        model,
        commands: [FetchEarliestData({ token: context.token })],
      }),
      onSome: () => ({ model }),
    });

// Asks again while the start of "All time" is unknown, so a fetch that failed,
// or that ran before the monitor wrote its first sample, does not leave "All
// time" on its fallback window for good.
const refetchEarliestData =
  (context: Context) =>
  (model: Model): StepReturn =>
    Option.isNone(model.maybeEarliestDataMs)
      ? { model, commands: [FetchEarliestData({ token: context.token })] }
      : { model };

const refetchEarliestDataForAllTime =
  (context: Context) =>
  (model: Model): StepReturn =>
    isAllTime(model.dateRange)
      ? refetchEarliestData(context)(model)
      : { model };

const revalidateMetrics =
  (context: Context) =>
  (model: Model): StepReturn =>
    Option.match(AsyncData.revalidate(model.metrics), {
      onNone: () => ({ model }),
      onSome: (next) => ({
        model: modifyFields(model, { metrics: () => next }),
        commands: rangeFetches(model, [fetchMetricsCommand(context, model)]),
      }),
    });

const revalidateSpeedtestHistory =
  (context: Context) =>
  (model: Model): StepReturn =>
    Option.match(AsyncData.revalidate(model.speedtestHistory), {
      onNone: () => ({ model }),
      onSome: (next) => ({
        model: modifyFields(model, { speedtestHistory: () => next }),
        commands: rangeFetches(model, [
          fetchSpeedtestHistoryCommand(context, model),
        ]),
      }),
    });

// A tick retries what failed as well as refreshing what loaded, so one
// transient failure does not stay on screen while auto-refresh reads "on". A
// failure stays as it is while the retry is in flight, so a source that keeps
// failing does not flicker through a loading state on every tick. A source
// that was never asked for is left for `EnteredDashboard`.
const revalidateOrRetry = <A, E>(
  data: AsyncData.AsyncData<A, E>
): Option.Option<AsyncData.AsyncData<A, E>> =>
  AsyncData.isFailure(data) ? Option.some(data) : AsyncData.revalidate(data);

// A Stale live status is one the latest fetch could not confirm, so its
// refetch starts from Loading rather than showing that value again while the
// request is in flight.
const revalidateLive = <A, E>(
  live: AsyncData.AsyncData<A, E>
): Option.Option<AsyncData.AsyncData<A, E>> =>
  AsyncData.isStale(live)
    ? Option.some(AsyncData.Loading())
    : revalidateOrRetry(live);

const revalidateLiveConnectivity =
  (context: Context) =>
  (model: Model): StepReturn =>
    Option.match(revalidateLive(model.liveConnectivity), {
      onNone: () => ({ model }),
      onSome: (next) => ({
        model: modifyFields(model, { liveConnectivity: () => next }),
        commands: [FetchLiveConnectivity({ token: context.token })],
      }),
    });

const revalidateOrRetryConnectivityStatus =
  (context: Context) =>
  (model: Model): StepReturn =>
    Option.match(revalidateOrRetry(model.connectivityStatus), {
      onNone: () => ({ model }),
      onSome: (next) => ({
        model: modifyFields(model, { connectivityStatus: () => next }),
        commands: rangeFetches(model, [
          fetchConnectivityStatusCommand(context, model),
        ]),
      }),
    });

const revalidateOrRetrySummary =
  (context: Context) =>
  (model: Model): StepReturn =>
    Option.match(revalidateOrRetry(model.summary), {
      onNone: () => ({ model }),
      onSome: (next) => ({
        model: modifyFields(model, { summary: () => next }),
        commands: rangeFetches(model, [fetchSummaryCommand(context, model)]),
      }),
    });

const revalidateOrRetryOutages =
  (context: Context) =>
  (model: Model): StepReturn =>
    Option.match(revalidateOrRetry(model.outages), {
      onNone: () => ({ model }),
      onSome: (next) => ({
        model: modifyFields(model, { outages: () => next }),
        commands: rangeFetches(model, [fetchOutagesCommand(context, model)]),
      }),
    });

const enterSummary =
  (context: Context) =>
  (model: Model): StepReturn =>
    Option.match(AsyncData.loadIfMissing(model.summary), {
      onNone: () => ({ model }),
      onSome: (next) => ({
        model: modifyFields(model, { summary: () => next }),
        commands: rangeFetches(model, [fetchSummaryCommand(context, model)]),
      }),
    });

const enterOutages =
  (context: Context) =>
  (model: Model): StepReturn =>
    Option.match(AsyncData.loadIfMissing(model.outages), {
      onNone: () => ({ model }),
      onSome: (next) => ({
        model: modifyFields(model, { outages: () => next }),
        commands: rangeFetches(model, [fetchOutagesCommand(context, model)]),
      }),
    });

const enterPingHosts =
  (context: Context) =>
  (model: Model): StepReturn =>
    Option.match(AsyncData.loadIfMissing(model.pingHosts), {
      onNone: () => ({ model }),
      onSome: (next) => ({
        model: modifyFields(model, { pingHosts: () => next }),
        commands: [FetchPingHosts({ token: context.token })],
      }),
    });

// The host list is static config: a loaded one is kept, and only a failed one
// is asked for again.
const retryPingHosts =
  (context: Context) =>
  (model: Model): StepReturn =>
    AsyncData.isFailure(model.pingHosts)
      ? { model, commands: [FetchPingHosts({ token: context.token })] }
      : { model };

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

const reloadMetrics =
  (context: Context) =>
  (model: Model): StepReturn => ({
    model: modifyFields(model, { metrics: () => forceReload(model.metrics) }),
    commands: rangeFetches(model, [fetchMetricsCommand(context, model)]),
  });

const reloadSummary =
  (context: Context) =>
  (model: Model): StepReturn => ({
    model: modifyFields(model, { summary: () => forceReload(model.summary) }),
    commands: rangeFetches(model, [fetchSummaryCommand(context, model)]),
  });

const reloadOutages =
  (context: Context) =>
  (model: Model): StepReturn => ({
    model: modifyFields(model, { outages: () => forceReload(model.outages) }),
    commands: rangeFetches(model, [fetchOutagesCommand(context, model)]),
  });

const reloadPingHosts =
  (context: Context) =>
  (model: Model): StepReturn => ({
    model: modifyFields(model, {
      pingHosts: () => forceReload(model.pingHosts),
    }),
    commands: [FetchPingHosts({ token: context.token })],
  });

const reloadSpeedtestHistory =
  (context: Context) =>
  (model: Model): StepReturn => ({
    model: modifyFields(model, {
      speedtestHistory: () => forceReload(model.speedtestHistory),
    }),
    commands: rangeFetches(model, [
      fetchSpeedtestHistoryCommand(context, model),
    ]),
  });

const reloadConnectivityStatus =
  (context: Context) =>
  (model: Model): StepReturn => ({
    model: modifyFields(model, {
      connectivityStatus: () => forceReload(model.connectivityStatus),
    }),
    commands: rangeFetches(model, [
      fetchConnectivityStatusCommand(context, model),
    ]),
  });

const reloadLiveConnectivity =
  (context: Context) =>
  (model: Model): StepReturn => ({
    model: modifyFields(model, {
      liveConnectivity: () =>
        AsyncData.isStale(model.liveConnectivity)
          ? AsyncData.Loading()
          : forceReload(model.liveConnectivity),
    }),
    commands: [FetchLiveConnectivity({ token: context.token })],
  });

// The per-host latency lines need the host list, and are only fetched while
// the latency chart is in that view.
const configuredHostNames = (model: Model): ReadonlyArray<string> =>
  Option.match(AsyncData.getData(model.pingHosts), {
    onNone: () => [],
    onSome: ({ hosts }) => hosts,
  });

const fetchHostLatencyCommand = (context: Context, model: Model) =>
  FetchHostLatency({
    token: context.token,
    ...rangeRequest(model),
    hosts: configuredHostNames(model),
  });

const canFetchHostLatency = (model: Model): boolean =>
  model.latencyView === "perHost" && configuredHostNames(model).length > 0;

const loadHostLatency =
  (context: Context) =>
  (model: Model): StepReturn =>
    canFetchHostLatency(model)
      ? {
          model: modifyFields(model, {
            hostLatency: () => forceReload(model.hostLatency),
          }),
          commands: rangeFetches(model, [
            fetchHostLatencyCommand(context, model),
          ]),
        }
      : { model };

const revalidateHostLatency =
  (context: Context) =>
  (model: Model): StepReturn =>
    Option.match(
      canFetchHostLatency(model)
        ? revalidateOrRetry(model.hostLatency)
        : Option.none(),
      {
        onNone: () => ({ model }),
        onSome: (next) => ({
          model: modifyFields(model, { hostLatency: () => next }),
          commands: rangeFetches(model, [
            fetchHostLatencyCommand(context, model),
          ]),
        }),
      }
    );

// Per-host results that land after the viewer switched back to all hosts have
// nothing left to feed, and a stale failure would raise a banner Retry can't
// clear.
const answersPerHostView = (model: Model, request: RangeRequest): boolean =>
  model.latencyView === "perHost" && answersCurrentRange(model, request);

// Every resource whose fetch is scoped to the selected range. Each path that
// moves the range reloads this one list, so a resource added here is reloaded
// by all of them.
const RANGE_SCOPED_RELOADS = [
  reloadMetrics,
  reloadSpeedtestHistory,
  reloadConnectivityStatus,
  reloadSummary,
  reloadOutages,
  loadHostLatency,
];

const reloadRangeScoped =
  (context: Context) =>
  (model: Model): StepReturn =>
    Update.combine(
      model,
      RANGE_SCOPED_RELOADS.map((reload) => reload(context))
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
      loadHostLatency(context)(nextModel);
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
    commands: [TriggerSpeedtest({ token: context.token })],
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
          enterMetrics(context),
          enterSpeedtestHistory(context),
          enterConnectivityStatus(context),
          enterLiveConnectivity(context),
          enterEarliestData(context),
          enterSummary(context),
          enterOutages(context),
          enterPingHosts(context),
          applyThemeOnEnter,
        ]),

      TickedRefresh: () =>
        Update.combine(model, [
          revalidateMetrics(context),
          revalidateSpeedtestHistory(context),
          revalidateOrRetryConnectivityStatus(context),
          revalidateLiveConnectivity(context),
          revalidateOrRetrySummary(context),
          revalidateOrRetryOutages(context),
          retryPingHosts(context),
          revalidateHostLatency(context),
          refetchEarliestDataForAllTime(context),
        ]),

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
          reloadRangeScoped(context),
          reloadLiveConnectivity(context),
          reloadPingHosts(context),
          refetchEarliestData(context),
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
          ? Update.combine(nextModel, [loadHostLatency(context)])
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

      Interacted: () => ({
        model: modifyFields(model, { isIdle: () => false }),
      }),
      WentIdle: () => ({ model: modifyFields(model, { isIdle: () => true }) }),

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
              description: `Download: ${downloadMbps.toFixed(1)} Mbps, Upload: ${uploadMbps.toFixed(1)} Mbps`,
            },
          }
        );
        return {
          model: modifyFields(model, {
            speedtestTrigger: () =>
              AsyncData.Success({ data: { downloadMbps, uploadMbps, pingMs } }),
            toast: () => toastModel,
          }),
          commands: [
            ...rangeFetches(model, [
              fetchMetricsCommand(context, model),
              fetchSpeedtestHistoryCommand(context, model),
              fetchSummaryCommand(context, model),
            ]),
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
