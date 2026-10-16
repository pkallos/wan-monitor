import { Equal, Match as M, Option, Result } from "effect";
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
  FetchLiveConnectivity,
  FetchMetrics,
  FetchSpeedtestHistory,
  rangeRequest,
  SaveSettings,
  TriggerSpeedtest,
} from "@/dashboard/command";
import {
  type DateRangeSelection,
  isAllTime,
  Preset,
  sameDateRange,
} from "@/dashboard/dateRange";
import * as DateRangePicker from "@/dashboard/dateRangePicker";
import {
  DashboardMenu,
  isThemeItem,
  type MenuItem,
  THEME_ITEMS,
} from "@/dashboard/menu";
import {
  GotDateRangePickerMessage,
  GotMenuMessage,
  GotToastMessage,
  type Message,
  type OutMessage,
  type RangeRequest,
  RequestedLogout,
} from "@/dashboard/message";
import { type Model, settingsFromModel } from "@/dashboard/model";
import type { ThemePreference } from "@/dashboard/theme";
import { Toast } from "@/dashboard/toast";

// `now` is injected (rather than read via `Date.now()` here) so `update`
// stays pure with respect to its inputs — the app boundary (auth/update.ts)
// supplies the real clock, and tests can supply a fixed one.
export type Context = { readonly token: string; readonly now: () => number };

type StepReturn = Update.Return<Model, Message>;
type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>;
const withUpdateReturn = M.withReturnType<UpdateReturn>();

// "All time" resolves its start from `maybeEarliestDataMs`, so a response
// issued before that arrived covers a different window than the current one.
const answersCurrentRange = (model: Model, request: RangeRequest): boolean =>
  sameDateRange(request.dateRange, model.dateRange) &&
  (!isAllTime(model.dateRange) ||
    Equal.equals(request.maybeEarliestDataMs, model.maybeEarliestDataMs));

const ignoreStale = (
  model: Model,
  request: RangeRequest,
  apply: () => StepReturn
): StepReturn => (answersCurrentRange(model, request) ? apply() : { model });

const enterMetrics =
  (context: Context) =>
  (model: Model): StepReturn =>
    Option.match(AsyncData.loadIfMissing(model.metrics), {
      onNone: () => ({ model }),
      onSome: (next) => ({
        model: modifyFields(model, { metrics: () => next }),
        commands: [
          FetchMetrics({
            token: context.token,
            ...rangeRequest(model),
          }),
        ],
      }),
    });

const enterSpeedtestHistory =
  (context: Context) =>
  (model: Model): StepReturn =>
    Option.match(AsyncData.loadIfMissing(model.speedtestHistory), {
      onNone: () => ({ model }),
      onSome: (next) => ({
        model: modifyFields(model, { speedtestHistory: () => next }),
        commands: [
          FetchSpeedtestHistory({
            token: context.token,
            ...rangeRequest(model),
          }),
        ],
      }),
    });

const enterConnectivityStatus =
  (context: Context) =>
  (model: Model): StepReturn =>
    Option.match(AsyncData.loadIfMissing(model.connectivityStatus), {
      onNone: () => ({ model }),
      onSome: (next) => ({
        model: modifyFields(model, { connectivityStatus: () => next }),
        commands: [
          FetchConnectivityStatus({
            token: context.token,
            ...rangeRequest(model),
          }),
        ],
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

const revalidateMetrics =
  (context: Context) =>
  (model: Model): StepReturn =>
    Option.match(AsyncData.revalidate(model.metrics), {
      onNone: () => ({ model }),
      onSome: (next) => ({
        model: modifyFields(model, { metrics: () => next }),
        commands: [
          FetchMetrics({
            token: context.token,
            ...rangeRequest(model),
          }),
        ],
      }),
    });

const revalidateSpeedtestHistory =
  (context: Context) =>
  (model: Model): StepReturn =>
    Option.match(AsyncData.revalidate(model.speedtestHistory), {
      onNone: () => ({ model }),
      onSome: (next) => ({
        model: modifyFields(model, { speedtestHistory: () => next }),
        commands: [
          FetchSpeedtestHistory({
            token: context.token,
            ...rangeRequest(model),
          }),
        ],
      }),
    });

const revalidateConnectivityStatus =
  (context: Context) =>
  (model: Model): StepReturn =>
    Option.match(AsyncData.revalidate(model.connectivityStatus), {
      onNone: () => ({ model }),
      onSome: (next) => ({
        model: modifyFields(model, { connectivityStatus: () => next }),
        commands: [
          FetchConnectivityStatus({
            token: context.token,
            ...rangeRequest(model),
          }),
        ],
      }),
    });

const revalidateLiveConnectivity =
  (context: Context) =>
  (model: Model): StepReturn =>
    Option.match(AsyncData.revalidate(model.liveConnectivity), {
      onNone: () => ({ model }),
      onSome: (next) => ({
        model: modifyFields(model, { liveConnectivity: () => next }),
        commands: [FetchLiveConnectivity({ token: context.token })],
      }),
    });

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
    commands: [
      FetchMetrics({
        token: context.token,
        ...rangeRequest(model),
      }),
    ],
  });

const reloadSpeedtestHistory =
  (context: Context) =>
  (model: Model): StepReturn => ({
    model: modifyFields(model, {
      speedtestHistory: () => forceReload(model.speedtestHistory),
    }),
    commands: [
      FetchSpeedtestHistory({
        token: context.token,
        ...rangeRequest(model),
      }),
    ],
  });

const reloadConnectivityStatus =
  (context: Context) =>
  (model: Model): StepReturn => ({
    model: modifyFields(model, {
      connectivityStatus: () => forceReload(model.connectivityStatus),
    }),
    commands: [
      FetchConnectivityStatus({
        token: context.token,
        ...rangeRequest(model),
      }),
    ],
  });

const reloadLiveConnectivity =
  (context: Context) =>
  (model: Model): StepReturn => ({
    model: modifyFields(model, {
      liveConnectivity: () => forceReload(model.liveConnectivity),
    }),
    commands: [FetchLiveConnectivity({ token: context.token })],
  });

// Each chart only needs re-painting when it's actually mounted, there's data
// to show it, and the window that data was fetched for is known. That window
// comes from the model, never from `model.dateRange` (see `TimelineWindow`).

const syncLatencyChart = (
  model: Model
): ReadonlyArray<Command.Command<Message>> =>
  Option.match(
    Option.all([
      model.maybeLatencyChartHostId,
      AsyncData.getData(model.metrics),
      model.maybeMetricsWindow,
    ]),
    {
      onNone: () => [],
      onSome: ([hostId, metrics, window]) => [
        SyncLatencyChart({
          hostId,
          metrics,
          startTimeMs: window.startTimeMs,
          endTimeMs: window.endTimeMs,
          granularity: window.granularity,
        }),
      ],
    }
  );

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

const applyDateRange =
  (context: Context, selection: DateRangeSelection) =>
  (model: Model): StepReturn => {
    const { model: nextModel, commands: reloadCommands } = Update.combine(
      modifyFields(model, { dateRange: () => selection }),
      [
        reloadMetrics(context),
        reloadSpeedtestHistory(context),
        reloadConnectivityStatus(context),
      ]
    );
    return {
      model: nextModel,
      commands: [
        ...(reloadCommands ?? []),
        SaveSettings({ settings: settingsFromModel(nextModel) }),
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
          applyThemeOnEnter,
        ]),

      TickedRefresh: () =>
        Update.combine(model, [
          revalidateMetrics(context),
          revalidateSpeedtestHistory(context),
          revalidateConnectivityStatus(context),
          revalidateLiveConnectivity(context),
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
              applyDateRange(context, selection)(withPicker);
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
        applyDateRange(context, Preset({ preset }))(model),

      ClickedRefreshNow: () =>
        Update.combine(model, [
          reloadMetrics(context),
          reloadSpeedtestHistory(context),
          reloadConnectivityStatus(context),
          reloadLiveConnectivity(context),
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
              Option.some({ startTimeMs, endTimeMs, granularity }),
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
            maybeSpeedtestWindow: () => Option.some({ startTimeMs, endTimeMs }),
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

      // A restored "All time" range resolves its start from
      // `maybeEarliestDataMs` (see `dateRange.ts`), which is unknown at boot
      // — so `EnteredDashboard`'s first fetch runs against the Unix epoch
      // fallback. Once the real earliest timestamp lands, reload rather than
      // just storing it, or a persisted "All time" + paused reload would
      // never repaint past that epoch-wide window.
      SucceededFetchEarliestData: ({ earliestMs }) => {
        const learnedAnUnresolvedAllTimeStart =
          isAllTime(model.dateRange) &&
          Option.isNone(model.maybeEarliestDataMs) &&
          Option.isSome(earliestMs);
        const nextModel = modifyFields(model, {
          maybeEarliestDataMs: () => earliestMs,
        });
        return learnedAnUnresolvedAllTimeStart
          ? Update.combine(nextModel, [
              reloadMetrics(context),
              reloadSpeedtestHistory(context),
              reloadConnectivityStatus(context),
            ])
          : { model: nextModel };
      },

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
            FetchMetrics({
              token: context.token,
              ...rangeRequest(model),
            }),
            FetchSpeedtestHistory({
              token: context.token,
              ...rangeRequest(model),
            }),
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
      "FailedFetchEarliestData",
      () => ({ model })
    ),
    M.exhaustive
  );
