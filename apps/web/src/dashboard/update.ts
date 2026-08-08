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
  FetchConnectivityStatus,
  FetchEarliestData,
  FetchLiveConnectivity,
  FetchMetrics,
  FetchSpeedtestHistory,
  LoadTheme,
  SaveTheme,
  TriggerSpeedtest,
} from "@/dashboard/command";
import * as DateRangePicker from "@/dashboard/dateRangePicker";
import {
  GotDateRangePickerMessage,
  GotToastMessage,
  type Message,
} from "@/dashboard/message";
import type { Model } from "@/dashboard/model";
import type { Theme } from "@/dashboard/theme";
import { Toast } from "@/dashboard/toast";

// `now` is injected (rather than read via `Date.now()` here) so `update`
// stays pure with respect to its inputs — the app boundary (auth/update.ts)
// supplies the real clock, and tests can supply a fixed one.
export type Context = { readonly token: string; readonly now: () => number };

type UpdateReturn = readonly [Model, ReadonlyArray<Command.Command<Message>>];
const withUpdateReturn = M.withReturnType<UpdateReturn>();

const enterMetrics =
  (context: Context) =>
  (model: Model): UpdateReturn =>
    Option.match(AsyncData.loadIfMissing(model.metrics), {
      onNone: () => [model, []],
      onSome: (next) => [
        evo(model, { metrics: () => next }),
        [
          FetchMetrics({
            token: context.token,
            dateRange: model.dateRange,
            maybeEarliestDataMs: model.maybeEarliestDataMs,
          }),
        ],
      ],
    });

const enterSpeedtestHistory =
  (context: Context) =>
  (model: Model): UpdateReturn =>
    Option.match(AsyncData.loadIfMissing(model.speedtestHistory), {
      onNone: () => [model, []],
      onSome: (next) => [
        evo(model, { speedtestHistory: () => next }),
        [
          FetchSpeedtestHistory({
            token: context.token,
            dateRange: model.dateRange,
            maybeEarliestDataMs: model.maybeEarliestDataMs,
          }),
        ],
      ],
    });

const enterConnectivityStatus =
  (context: Context) =>
  (model: Model): UpdateReturn =>
    Option.match(AsyncData.loadIfMissing(model.connectivityStatus), {
      onNone: () => [model, []],
      onSome: (next) => [
        evo(model, { connectivityStatus: () => next }),
        [
          FetchConnectivityStatus({
            token: context.token,
            dateRange: model.dateRange,
            maybeEarliestDataMs: model.maybeEarliestDataMs,
          }),
        ],
      ],
    });

const enterLiveConnectivity =
  (context: Context) =>
  (model: Model): UpdateReturn =>
    Option.match(AsyncData.loadIfMissing(model.liveConnectivity), {
      onNone: () => [model, []],
      onSome: (next) => [
        evo(model, { liveConnectivity: () => next }),
        [FetchLiveConnectivity({ token: context.token })],
      ],
    });

const enterTheme = (model: Model): UpdateReturn =>
  Option.match(model.maybeTheme, {
    onNone: () => [model, [LoadTheme()]],
    onSome: () => [model, []],
  });

const enterEarliestData =
  (context: Context) =>
  (model: Model): UpdateReturn =>
    Option.match(model.maybeEarliestDataMs, {
      onNone: () => [model, [FetchEarliestData({ token: context.token })]],
      onSome: () => [model, []],
    });

const toggleTheme = (theme: Theme): Theme =>
  theme === "light" ? "dark" : "light";

const currentTheme = (model: Model): Theme =>
  Option.getOrElse(model.maybeTheme, () => "light" as const);

const revalidateMetrics =
  (context: Context) =>
  (model: Model): UpdateReturn =>
    Option.match(AsyncData.revalidate(model.metrics), {
      onNone: () => [model, []],
      onSome: (next) => [
        evo(model, { metrics: () => next }),
        [
          FetchMetrics({
            token: context.token,
            dateRange: model.dateRange,
            maybeEarliestDataMs: model.maybeEarliestDataMs,
          }),
        ],
      ],
    });

const revalidateSpeedtestHistory =
  (context: Context) =>
  (model: Model): UpdateReturn =>
    Option.match(AsyncData.revalidate(model.speedtestHistory), {
      onNone: () => [model, []],
      onSome: (next) => [
        evo(model, { speedtestHistory: () => next }),
        [
          FetchSpeedtestHistory({
            token: context.token,
            dateRange: model.dateRange,
            maybeEarliestDataMs: model.maybeEarliestDataMs,
          }),
        ],
      ],
    });

const revalidateConnectivityStatus =
  (context: Context) =>
  (model: Model): UpdateReturn =>
    Option.match(AsyncData.revalidate(model.connectivityStatus), {
      onNone: () => [model, []],
      onSome: (next) => [
        evo(model, { connectivityStatus: () => next }),
        [
          FetchConnectivityStatus({
            token: context.token,
            dateRange: model.dateRange,
            maybeEarliestDataMs: model.maybeEarliestDataMs,
          }),
        ],
      ],
    });

const revalidateLiveConnectivity =
  (context: Context) =>
  (model: Model): UpdateReturn =>
    Option.match(AsyncData.revalidate(model.liveConnectivity), {
      onNone: () => [model, []],
      onSome: (next) => [
        evo(model, { liveConnectivity: () => next }),
        [FetchLiveConnectivity({ token: context.token })],
      ],
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
  (model: Model): UpdateReturn => [
    evo(model, { metrics: () => forceReload(model.metrics) }),
    [
      FetchMetrics({
        token: context.token,
        dateRange: model.dateRange,
        maybeEarliestDataMs: model.maybeEarliestDataMs,
      }),
    ],
  ];

const reloadSpeedtestHistory =
  (context: Context) =>
  (model: Model): UpdateReturn => [
    evo(model, {
      speedtestHistory: () => forceReload(model.speedtestHistory),
    }),
    [
      FetchSpeedtestHistory({
        token: context.token,
        dateRange: model.dateRange,
        maybeEarliestDataMs: model.maybeEarliestDataMs,
      }),
    ],
  ];

const reloadConnectivityStatus =
  (context: Context) =>
  (model: Model): UpdateReturn => [
    evo(model, {
      connectivityStatus: () => forceReload(model.connectivityStatus),
    }),
    [
      FetchConnectivityStatus({
        token: context.token,
        dateRange: model.dateRange,
        maybeEarliestDataMs: model.maybeEarliestDataMs,
      }),
    ],
  ];

const reloadLiveConnectivity =
  (context: Context) =>
  (model: Model): UpdateReturn => [
    evo(model, {
      liveConnectivity: () => forceReload(model.liveConnectivity),
    }),
    [FetchLiveConnectivity({ token: context.token })],
  ];

// Each chart only needs re-painting when it's actually mounted and there's
// data to show it — otherwise there's nothing to sync yet.
const syncLatencyChart = (
  model: Model
): ReadonlyArray<Command.Command<Message>> =>
  Option.match(
    Option.product(
      model.maybeLatencyChartHostId,
      AsyncData.getData(model.metrics)
    ),
    {
      onNone: () => [],
      onSome: ([hostId, metrics]) => [
        SyncLatencyChart({
          hostId,
          metrics,
          dateRange: model.dateRange,
          maybeEarliestDataMs: model.maybeEarliestDataMs,
          theme: currentTheme(model),
        }),
      ],
    }
  );

const syncPacketLossChart = (
  model: Model
): ReadonlyArray<Command.Command<Message>> =>
  Option.match(
    Option.product(
      model.maybePacketLossChartHostId,
      AsyncData.getData(model.metrics)
    ),
    {
      onNone: () => [],
      onSome: ([hostId, metrics]) => [
        SyncPacketLossChart({
          hostId,
          metrics,
          dateRange: model.dateRange,
          maybeEarliestDataMs: model.maybeEarliestDataMs,
          theme: currentTheme(model),
        }),
      ],
    }
  );

const syncJitterChart = (
  model: Model
): ReadonlyArray<Command.Command<Message>> =>
  Option.match(
    Option.product(
      model.maybeJitterChartHostId,
      AsyncData.getData(model.metrics)
    ),
    {
      onNone: () => [],
      onSome: ([hostId, metrics]) => [
        SyncJitterChart({
          hostId,
          metrics,
          dateRange: model.dateRange,
          maybeEarliestDataMs: model.maybeEarliestDataMs,
          theme: currentTheme(model),
        }),
      ],
    }
  );

const syncSpeedChart = (
  model: Model
): ReadonlyArray<Command.Command<Message>> =>
  Option.match(
    Option.product(
      model.maybeSpeedChartHostId,
      AsyncData.getData(model.speedtestHistory)
    ),
    {
      onNone: () => [],
      onSome: ([hostId, metrics]) => [
        SyncSpeedChart({
          hostId,
          metrics,
          dateRange: model.dateRange,
          maybeEarliestDataMs: model.maybeEarliestDataMs,
          theme: currentTheme(model),
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
          enterTheme,
        ]),

      TickedRefresh: () =>
        Update.combine(model, [
          revalidateMetrics(context),
          revalidateSpeedtestHistory(context),
          revalidateConnectivityStatus(context),
          revalidateLiveConnectivity(context),
        ]),

      GotDateRangePickerMessage: ({ message: pickerMessage }) => {
        const [nextPicker, pickerCommands, maybeOutMessage] =
          DateRangePicker.update(
            model.dateRangePicker,
            pickerMessage,
            model.dateRange,
            context.now(),
            model.maybeEarliestDataMs
          );
        const mappedCommands = Command.mapMessages(pickerCommands, (message) =>
          GotDateRangePickerMessage({ message })
        );
        const withPicker = evo(model, { dateRangePicker: () => nextPicker });

        return Option.match(maybeOutMessage, {
          onNone: () => [withPicker, mappedCommands],
          onSome: (outMessage) =>
            M.value(outMessage).pipe(
              withUpdateReturn,
              M.tag("AppliedRange", ({ selection }) => {
                const withAppliedRange = evo(withPicker, {
                  dateRange: () => selection,
                });
                // `liveConnectivity` is deliberately absent: it answers "is
                // the link up right now", which no range selection can change.
                const [nextModel, reloadCommands] = Update.combine(
                  withAppliedRange,
                  [
                    reloadMetrics(context),
                    reloadSpeedtestHistory(context),
                    reloadConnectivityStatus(context),
                  ]
                );
                return [nextModel, [...mappedCommands, ...reloadCommands]];
              }),
              M.tag("Cancelled", () => [withPicker, mappedCommands]),
              M.exhaustive
            ),
        });
      },

      ClickedRefreshNow: () =>
        Update.combine(model, [
          reloadMetrics(context),
          reloadSpeedtestHistory(context),
          reloadConnectivityStatus(context),
          reloadLiveConnectivity(context),
        ]),

      SucceededFetchMetrics: ({ metrics, nowMs }) => {
        const nextModel = evo(model, {
          metrics: () =>
            AsyncData.settle(model.metrics, Result.succeed(metrics)),
          maybeLastUpdatedMs: () => Option.some(nowMs),
        });
        return [nextModel, syncQualityCharts(nextModel)];
      },
      FailedFetchMetrics: ({ error }) => [
        evo(model, {
          metrics: () => AsyncData.settle(model.metrics, Result.fail(error)),
        }),
        [],
      ],

      SucceededFetchSpeedtestHistory: ({ history }) => {
        const nextModel = evo(model, {
          speedtestHistory: () =>
            AsyncData.settle(model.speedtestHistory, Result.succeed(history)),
        });
        return [nextModel, syncSpeedChart(nextModel)];
      },
      FailedFetchSpeedtestHistory: ({ error }) => [
        evo(model, {
          speedtestHistory: () =>
            AsyncData.settle(model.speedtestHistory, Result.fail(error)),
        }),
        [],
      ],

      SucceededFetchConnectivityStatus: ({
        points,
        maybeUptimePercentage,
        coveragePercentage,
        startTimeMs,
        endTimeMs,
        granularity,
      }) => [
        evo(model, {
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
        [],
      ],
      FailedFetchConnectivityStatus: ({ error }) => [
        evo(model, {
          connectivityStatus: () =>
            AsyncData.settle(model.connectivityStatus, Result.fail(error)),
        }),
        [],
      ],

      SucceededFetchLiveConnectivity: ({ status, maybeLastSampleAtMs }) => [
        evo(model, {
          liveConnectivity: () =>
            AsyncData.settle(
              model.liveConnectivity,
              Result.succeed({ status, maybeLastSampleAtMs })
            ),
        }),
        [],
      ],
      FailedFetchLiveConnectivity: ({ error }) => [
        evo(model, {
          liveConnectivity: () =>
            AsyncData.settle(model.liveConnectivity, Result.fail(error)),
        }),
        [],
      ],

      SucceededFetchEarliestData: ({ earliestMs }) => [
        evo(model, { maybeEarliestDataMs: () => earliestMs }),
        [],
      ],

      ClickedTogglePause: () => [
        evo(model, { isPaused: (paused) => !paused }),
        [],
      ],

      Interacted: () => [evo(model, { isIdle: () => false }), []],
      WentIdle: () => [evo(model, { isIdle: () => true }), []],

      HoveredConnectivitySegment: ({ index }) => [
        evo(model, { hoveredSegmentIndex: () => Option.some(index) }),
        [],
      ],
      UnhoveredConnectivitySegment: () => [
        evo(model, { hoveredSegmentIndex: () => Option.none() }),
        [],
      ],

      LoadedTheme: ({ theme }) => [
        evo(model, { maybeTheme: () => Option.some(theme) }),
        [],
      ],
      ClickedToggleTheme: () => {
        const nextTheme = toggleTheme(currentTheme(model));
        const nextModel = evo(model, {
          maybeTheme: () => Option.some(nextTheme),
        });
        return [
          nextModel,
          [
            SaveTheme({ theme: nextTheme }),
            ...syncQualityCharts(nextModel),
            ...syncSpeedChart(nextModel),
          ],
        ];
      },

      ClickedTriggerSpeedtest: () => [
        evo(model, {
          speedtestTrigger: () => AsyncData.Loading(),
        }),
        [TriggerSpeedtest({ token: context.token })],
      ],
      SucceededTriggerSpeedtest: ({ downloadMbps, uploadMbps, pingMs }) => {
        const [toastModel, toastCommands] = Toast.show(model.toast, {
          variant: "Success",
          payload: {
            title: "Speed test complete",
            description: `Download: ${downloadMbps.toFixed(1)} Mbps, Upload: ${uploadMbps.toFixed(1)} Mbps`,
          },
        });
        return [
          evo(model, {
            speedtestTrigger: () =>
              AsyncData.Success({ data: { downloadMbps, uploadMbps, pingMs } }),
            toast: () => toastModel,
          }),
          [
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
            ...Command.mapMessages(toastCommands, (message) =>
              GotToastMessage({ message })
            ),
          ],
        ];
      },
      FailedTriggerSpeedtest: ({ message, isAlreadyRunning }) => {
        const [toastModel, toastCommands] = Toast.show(model.toast, {
          variant: isAlreadyRunning ? "Warning" : "Error",
          payload: {
            title: isAlreadyRunning
              ? "Speed test in progress"
              : "Speed test failed",
            description: message,
          },
        });
        return [
          evo(model, {
            speedtestTrigger: () => AsyncData.Failure({ error: message }),
            toast: () => toastModel,
          }),
          Command.mapMessages(toastCommands, (message) =>
            GotToastMessage({ message })
          ),
        ];
      },

      SucceededMountLatencyChart: ({ hostId }) => {
        const nextModel = evo(model, {
          maybeLatencyChartHostId: () => Option.some(hostId),
        });
        return [nextModel, syncLatencyChart(nextModel)];
      },
      SucceededMountPacketLossChart: ({ hostId }) => {
        const nextModel = evo(model, {
          maybePacketLossChartHostId: () => Option.some(hostId),
        });
        return [nextModel, syncPacketLossChart(nextModel)];
      },
      SucceededMountJitterChart: ({ hostId }) => {
        const nextModel = evo(model, {
          maybeJitterChartHostId: () => Option.some(hostId),
        });
        return [nextModel, syncJitterChart(nextModel)];
      },
      SucceededMountSpeedChart: ({ hostId }) => {
        const nextModel = evo(model, {
          maybeSpeedChartHostId: () => Option.some(hostId),
        });
        return [nextModel, syncSpeedChart(nextModel)];
      },

      GotToastMessage: ({ message }) => {
        const [nextToast, commands] = Toast.update(model.toast, message);
        return [
          evo(model, { toast: () => nextToast }),
          Command.mapMessages(commands, (message) =>
            GotToastMessage({ message })
          ),
        ];
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
      "CompletedSaveTheme",
      "FailedSaveTheme",
      "FailedFetchEarliestData",
      () => [model, []]
    ),
    M.exhaustive
  );
