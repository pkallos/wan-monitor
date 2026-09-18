import { Match as M, Option, Result } from "effect";
import { AsyncData, Command, Update } from "foldkit";
import { evo } from "foldkit/struct";
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
  SaveSettings,
  TriggerSpeedtest,
} from "@/dashboard/command";
import * as DateRangePicker from "@/dashboard/dateRangePicker";
import {
  GotDateRangePickerMessage,
  GotToastMessage,
  type Message,
} from "@/dashboard/message";
import { type Model, settingsFromModel } from "@/dashboard/model";
import type { Theme } from "@/dashboard/theme";
import { Toast } from "@/dashboard/toast";

// `now` is injected (rather than read via `Date.now()` here) so `update`
// stays pure with respect to its inputs — the app boundary (auth/update.ts)
// supplies the real clock, and tests can supply a fixed one.
export type Context = { readonly token: string; readonly now: () => number };

type UpdateReturn = Update.Return<Model, Message>;
const withUpdateReturn = M.withReturnType<UpdateReturn>();

const enterMetrics =
  (context: Context) =>
  (model: Model): UpdateReturn =>
    Option.match(AsyncData.loadIfMissing(model.metrics), {
      onNone: () => ({ model }),
      onSome: (next) => ({
        model: evo(model, { metrics: () => next }),
        commands: [
          FetchMetrics({
            token: context.token,
            dateRange: model.dateRange,
            maybeEarliestDataMs: model.maybeEarliestDataMs,
          }),
        ],
      }),
    });

const enterSpeedtestHistory =
  (context: Context) =>
  (model: Model): UpdateReturn =>
    Option.match(AsyncData.loadIfMissing(model.speedtestHistory), {
      onNone: () => ({ model }),
      onSome: (next) => ({
        model: evo(model, { speedtestHistory: () => next }),
        commands: [
          FetchSpeedtestHistory({
            token: context.token,
            dateRange: model.dateRange,
            maybeEarliestDataMs: model.maybeEarliestDataMs,
          }),
        ],
      }),
    });

const enterConnectivityStatus =
  (context: Context) =>
  (model: Model): UpdateReturn =>
    Option.match(AsyncData.loadIfMissing(model.connectivityStatus), {
      onNone: () => ({ model }),
      onSome: (next) => ({
        model: evo(model, { connectivityStatus: () => next }),
        commands: [
          FetchConnectivityStatus({
            token: context.token,
            dateRange: model.dateRange,
            maybeEarliestDataMs: model.maybeEarliestDataMs,
          }),
        ],
      }),
    });

const enterLiveConnectivity =
  (context: Context) =>
  (model: Model): UpdateReturn =>
    Option.match(AsyncData.loadIfMissing(model.liveConnectivity), {
      onNone: () => ({ model }),
      onSome: (next) => ({
        model: evo(model, { liveConnectivity: () => next }),
        commands: [FetchLiveConnectivity({ token: context.token })],
      }),
    });

// Re-asserts the model's theme onto `<html>` so it matches even if the boot
// script's pre-hydration paint (`index.html`) somehow diverged from it.
const applyThemeOnEnter = (model: Model): UpdateReturn => ({
  model,
  commands: [ApplyTheme({ theme: model.theme })],
});

const enterEarliestData =
  (context: Context) =>
  (model: Model): UpdateReturn =>
    Option.match(model.maybeEarliestDataMs, {
      onNone: () => ({
        model,
        commands: [FetchEarliestData({ token: context.token })],
      }),
      onSome: () => ({ model }),
    });

const toggleTheme = (theme: Theme): Theme =>
  theme === "light" ? "dark" : "light";

const revalidateMetrics =
  (context: Context) =>
  (model: Model): UpdateReturn =>
    Option.match(AsyncData.revalidate(model.metrics), {
      onNone: () => ({ model }),
      onSome: (next) => ({
        model: evo(model, { metrics: () => next }),
        commands: [
          FetchMetrics({
            token: context.token,
            dateRange: model.dateRange,
            maybeEarliestDataMs: model.maybeEarliestDataMs,
          }),
        ],
      }),
    });

const revalidateSpeedtestHistory =
  (context: Context) =>
  (model: Model): UpdateReturn =>
    Option.match(AsyncData.revalidate(model.speedtestHistory), {
      onNone: () => ({ model }),
      onSome: (next) => ({
        model: evo(model, { speedtestHistory: () => next }),
        commands: [
          FetchSpeedtestHistory({
            token: context.token,
            dateRange: model.dateRange,
            maybeEarliestDataMs: model.maybeEarliestDataMs,
          }),
        ],
      }),
    });

const revalidateConnectivityStatus =
  (context: Context) =>
  (model: Model): UpdateReturn =>
    Option.match(AsyncData.revalidate(model.connectivityStatus), {
      onNone: () => ({ model }),
      onSome: (next) => ({
        model: evo(model, { connectivityStatus: () => next }),
        commands: [
          FetchConnectivityStatus({
            token: context.token,
            dateRange: model.dateRange,
            maybeEarliestDataMs: model.maybeEarliestDataMs,
          }),
        ],
      }),
    });

const revalidateLiveConnectivity =
  (context: Context) =>
  (model: Model): UpdateReturn =>
    Option.match(AsyncData.revalidate(model.liveConnectivity), {
      onNone: () => ({ model }),
      onSome: (next) => ({
        model: evo(model, { liveConnectivity: () => next }),
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
  (model: Model): UpdateReturn => ({
    model: evo(model, { metrics: () => forceReload(model.metrics) }),
    commands: [
      FetchMetrics({
        token: context.token,
        dateRange: model.dateRange,
        maybeEarliestDataMs: model.maybeEarliestDataMs,
      }),
    ],
  });

const reloadSpeedtestHistory =
  (context: Context) =>
  (model: Model): UpdateReturn => ({
    model: evo(model, {
      speedtestHistory: () => forceReload(model.speedtestHistory),
    }),
    commands: [
      FetchSpeedtestHistory({
        token: context.token,
        dateRange: model.dateRange,
        maybeEarliestDataMs: model.maybeEarliestDataMs,
      }),
    ],
  });

const reloadConnectivityStatus =
  (context: Context) =>
  (model: Model): UpdateReturn => ({
    model: evo(model, {
      connectivityStatus: () => forceReload(model.connectivityStatus),
    }),
    commands: [
      FetchConnectivityStatus({
        token: context.token,
        dateRange: model.dateRange,
        maybeEarliestDataMs: model.maybeEarliestDataMs,
      }),
    ],
  });

const reloadLiveConnectivity =
  (context: Context) =>
  (model: Model): UpdateReturn => ({
    model: evo(model, {
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
          theme: model.theme,
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
          theme: model.theme,
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
          theme: model.theme,
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
          theme: model.theme,
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
        const withPicker = evo(model, { dateRangePicker: () => nextPicker });

        if (outMessage === undefined) {
          return { model: withPicker, commands: mappedCommands };
        }

        return M.value(outMessage).pipe(
          withUpdateReturn,
          M.tag("AppliedRange", ({ selection }) => {
            const withAppliedRange = evo(withPicker, {
              dateRange: () => selection,
            });
            // `liveConnectivity` is deliberately absent: it answers "is
            // the link up right now", which no range selection can change.
            const { model: nextModel, commands: reloadCommands } =
              Update.combine(withAppliedRange, [
                reloadMetrics(context),
                reloadSpeedtestHistory(context),
                reloadConnectivityStatus(context),
              ]);
            return {
              model: nextModel,
              commands: [
                ...mappedCommands,
                ...(reloadCommands ?? []),
                SaveSettings({ settings: settingsFromModel(nextModel) }),
              ],
            };
          }),
          M.tag("Cancelled", () => ({
            model: withPicker,
            commands: mappedCommands,
          })),
          M.exhaustive
        );
      },

      ClickedRefreshNow: () =>
        Update.combine(model, [
          reloadMetrics(context),
          reloadSpeedtestHistory(context),
          reloadConnectivityStatus(context),
          reloadLiveConnectivity(context),
        ]),

      SucceededFetchMetrics: ({
        metrics,
        nowMs,
        startTimeMs,
        endTimeMs,
        granularity,
      }) => {
        const nextModel = evo(model, {
          metrics: () =>
            AsyncData.settle(model.metrics, Result.succeed(metrics)),
          maybeMetricsWindow: () =>
            Option.some({ startTimeMs, endTimeMs, granularity }),
          maybeLastUpdatedMs: () => Option.some(nowMs),
        });
        return { model: nextModel, commands: syncQualityCharts(nextModel) };
      },
      FailedFetchMetrics: ({ error }) => ({
        model: evo(model, {
          metrics: () => AsyncData.settle(model.metrics, Result.fail(error)),
        }),
      }),

      SucceededFetchSpeedtestHistory: ({ history, startTimeMs, endTimeMs }) => {
        const nextModel = evo(model, {
          speedtestHistory: () =>
            AsyncData.settle(model.speedtestHistory, Result.succeed(history)),
          maybeSpeedtestWindow: () => Option.some({ startTimeMs, endTimeMs }),
        });
        return { model: nextModel, commands: syncSpeedChart(nextModel) };
      },
      FailedFetchSpeedtestHistory: ({ error }) => ({
        model: evo(model, {
          speedtestHistory: () =>
            AsyncData.settle(model.speedtestHistory, Result.fail(error)),
        }),
      }),

      SucceededFetchConnectivityStatus: ({
        points,
        maybeUptimePercentage,
        coveragePercentage,
        startTimeMs,
        endTimeMs,
        granularity,
      }) => ({
        model: evo(model, {
          connectivityStatus: () =>
            AsyncData.settle(
              model.connectivityStatus,
              Result.succeed({
                points,
                maybeUptimePercentage,
                coveragePercentage,
                startTimeMs,
                endTimeMs,
                granularity,
              })
            ),
        }),
      }),
      FailedFetchConnectivityStatus: ({ error }) => ({
        model: evo(model, {
          connectivityStatus: () =>
            AsyncData.settle(model.connectivityStatus, Result.fail(error)),
        }),
      }),

      SucceededFetchLiveConnectivity: ({ status, maybeLastSampleAtMs }) => ({
        model: evo(model, {
          liveConnectivity: () =>
            AsyncData.settle(
              model.liveConnectivity,
              Result.succeed({ status, maybeLastSampleAtMs })
            ),
        }),
      }),
      FailedFetchLiveConnectivity: ({ error }) => ({
        model: evo(model, {
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
          model.dateRange._tag === "Preset" &&
          model.dateRange.preset === "allTime" &&
          Option.isNone(model.maybeEarliestDataMs) &&
          Option.isSome(earliestMs);
        const nextModel = evo(model, {
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
        const nextModel = evo(model, { isPaused: (paused) => !paused });
        return {
          model: nextModel,
          commands: [SaveSettings({ settings: settingsFromModel(nextModel) })],
        };
      },

      Interacted: () => ({ model: evo(model, { isIdle: () => false }) }),
      WentIdle: () => ({ model: evo(model, { isIdle: () => true }) }),

      HoveredConnectivitySegment: ({ index }) => ({
        model: evo(model, { hoveredSegmentIndex: () => Option.some(index) }),
      }),
      UnhoveredConnectivitySegment: () => ({
        model: evo(model, { hoveredSegmentIndex: () => Option.none() }),
      }),

      ClickedToggleTheme: () => {
        const nextTheme = toggleTheme(model.theme);
        const nextModel = evo(model, { theme: () => nextTheme });
        return {
          model: nextModel,
          commands: [
            ApplyTheme({ theme: nextTheme }),
            SaveSettings({ settings: settingsFromModel(nextModel) }),
            ...syncQualityCharts(nextModel),
            ...syncSpeedChart(nextModel),
          ],
        };
      },

      ClickedTriggerSpeedtest: () => ({
        model: evo(model, {
          speedtestTrigger: () => AsyncData.Loading(),
        }),
        commands: [TriggerSpeedtest({ token: context.token })],
      }),
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
          model: evo(model, {
            speedtestTrigger: () =>
              AsyncData.Success({ data: { downloadMbps, uploadMbps, pingMs } }),
            toast: () => toastModel,
          }),
          commands: [
            FetchMetrics({
              token: context.token,
              dateRange: model.dateRange,
              maybeEarliestDataMs: model.maybeEarliestDataMs,
            }),
            FetchSpeedtestHistory({
              token: context.token,
              dateRange: model.dateRange,
              maybeEarliestDataMs: model.maybeEarliestDataMs,
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
          model: evo(model, {
            speedtestTrigger: () => AsyncData.Failure({ error: message }),
            toast: () => toastModel,
          }),
          commands: Command.mapMessages(toastCommands ?? [], (message) =>
            GotToastMessage({ message })
          ),
        };
      },

      SucceededMountLatencyChart: ({ hostId }) => {
        const nextModel = evo(model, {
          maybeLatencyChartHostId: () => Option.some(hostId),
        });
        return { model: nextModel, commands: syncLatencyChart(nextModel) };
      },
      SucceededMountPacketLossChart: ({ hostId }) => {
        const nextModel = evo(model, {
          maybePacketLossChartHostId: () => Option.some(hostId),
        });
        return { model: nextModel, commands: syncPacketLossChart(nextModel) };
      },
      SucceededMountJitterChart: ({ hostId }) => {
        const nextModel = evo(model, {
          maybeJitterChartHostId: () => Option.some(hostId),
        });
        return { model: nextModel, commands: syncJitterChart(nextModel) };
      },
      SucceededMountSpeedChart: ({ hostId }) => {
        const nextModel = evo(model, {
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
          model: evo(model, { toast: () => nextToast }),
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
