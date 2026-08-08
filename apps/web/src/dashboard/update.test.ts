import { Popover, Toast as UiToast } from "@foldkit/ui";
import { Option } from "effect";
import { Story } from "foldkit";
import { describe, expect, test } from "vitest";
import {
  SyncJitterChart,
  SyncLatencyChart,
  SyncPacketLossChart,
  SyncSpeedChart,
} from "@/dashboard/charts/command";
import {
  FetchConnectivityStatus,
  FetchEarliestData,
  FetchMetrics,
  FetchSpeedtestHistory,
  LoadTheme,
  SaveTheme,
  TriggerSpeedtest,
} from "@/dashboard/command";
import { Preset } from "@/dashboard/dateRange";
import { ClickedApply, ClickedPreset } from "@/dashboard/dateRangePicker";
import {
  ClickedRefreshNow,
  ClickedTogglePause,
  ClickedToggleTheme,
  ClickedTriggerSpeedtest,
  CompletedSaveTheme,
  CompletedSyncJitterChart,
  CompletedSyncLatencyChart,
  CompletedSyncPacketLossChart,
  CompletedSyncSpeedChart,
  EnteredDashboard,
  FailedFetchConnectivityStatus,
  FailedFetchEarliestData,
  FailedFetchMetrics,
  FailedFetchSpeedtestHistory,
  FailedMountJitterChart,
  FailedMountLatencyChart,
  FailedMountPacketLossChart,
  FailedMountSpeedChart,
  FailedSyncJitterChart,
  FailedSyncLatencyChart,
  FailedSyncPacketLossChart,
  FailedSyncSpeedChart,
  FailedTriggerSpeedtest,
  GotDateRangePickerMessage,
  GotToastMessage,
  HoveredConnectivitySegment,
  Interacted,
  LoadedTheme,
  SucceededFetchConnectivityStatus,
  SucceededFetchEarliestData,
  SucceededFetchMetrics,
  SucceededFetchSpeedtestHistory,
  SucceededMountJitterChart,
  SucceededMountLatencyChart,
  SucceededMountPacketLossChart,
  SucceededMountSpeedChart,
  SucceededTriggerSpeedtest,
  TickedRefresh,
  UnhoveredConnectivitySegment,
  WentIdle,
} from "@/dashboard/message";
import {
  ConnectivityStatusAsyncData,
  initModel,
  MetricsAsyncData,
  SpeedtestHistoryAsyncData,
  SpeedtestTriggerAsyncData,
} from "@/dashboard/model";
import { Toast, ToastTest } from "@/dashboard/toast";
import { update } from "@/dashboard/update";

const NOW_MS = Date.parse("2026-07-28T12:00:00.000Z");
const DEFAULT_DATE_RANGE = Preset({ preset: "last30d" });

// A fetch resolves its window once and carries the result on its success
// message, so a chart sync is driven by that stored window rather than by
// re-resolving `DEFAULT_DATE_RANGE`.
const METRICS_WINDOW = {
  startTimeMs: NOW_MS - 30 * 24 * 60 * 60 * 1000,
  endTimeMs: NOW_MS,
  granularity: "1h" as const,
};
const SPEEDTEST_WINDOW = {
  startTimeMs: METRICS_WINDOW.startTimeMs,
  endTimeMs: METRICS_WINDOW.endTimeMs,
  maybeGranularity: Option.some("1h" as const),
};

const succeededFetchMetrics = () =>
  SucceededFetchMetrics({ metrics: [], nowMs: 0, ...METRICS_WINDOW });
const succeededFetchSpeedtestHistory = () =>
  SucceededFetchSpeedtestHistory({ history: [], ...SPEEDTEST_WINDOW });

// A model that has already settled a metrics fetch: data plus the window it
// was fetched for, which is what gates a chart sync.
const withLoadedWindows = (model: ReturnType<typeof initModel>) => ({
  ...model,
  maybeMetricsWindow: Option.some(METRICS_WINDOW),
  maybeSpeedtestWindow: Option.some(SPEEDTEST_WINDOW),
});

const context = { token: "abc123", now: () => NOW_MS };
const withContext = (
  model: ReturnType<typeof initModel>,
  message: Parameters<typeof update>[1]
) => update(model, message, context);

const resolveFocusButton = () =>
  Story.Command.resolve(Popover.FocusButton, Popover.CompletedFocusButton());

const resolveLoadTheme = () =>
  Story.Command.resolve(LoadTheme, LoadedTheme({ theme: "light" }));

const resolveFetchEarliestData = () =>
  Story.Command.resolve(
    FetchEarliestData,
    SucceededFetchEarliestData({ earliestMs: Option.none() })
  );

describe("dashboard update — metrics", () => {
  test("entering the dashboard with no cached metrics loads them", () => {
    Story.story(
      withContext,
      Story.with(initModel()),
      Story.message(EnteredDashboard()),
      Story.Command.expectHas(
        FetchMetrics({
          token: "abc123",
          dateRange: DEFAULT_DATE_RANGE,
          maybeEarliestDataMs: Option.none(),
        })
      ),
      Story.model((model) => {
        expect(model.metrics._tag).toBe("Loading");
      }),
      Story.Command.resolveAll(
        [FetchMetrics, succeededFetchMetrics()],
        [FetchSpeedtestHistory, succeededFetchSpeedtestHistory()],
        [
          FetchConnectivityStatus,
          SucceededFetchConnectivityStatus({
            points: [],
            uptimePercentage: 100,
            startTimeMs: 0,
            endTimeMs: 3_600_000,
            granularity: "1m",
          }),
        ]
      ),
      resolveLoadTheme(),
      resolveFetchEarliestData()
    );
  });

  test("entering the dashboard again with everything already loaded does not refetch anything", () => {
    const model = {
      ...initModel(),
      metrics: MetricsAsyncData.Success({ data: [] }),
      speedtestHistory: SpeedtestHistoryAsyncData.Success({ data: [] }),
      connectivityStatus: ConnectivityStatusAsyncData.Success({
        data: {
          points: [],
          uptimePercentage: 100,
          startTimeMs: 0,
          endTimeMs: 3_600_000,
          granularity: "1m",
        },
      }),
      maybeTheme: Option.some("light" as const),
      maybeEarliestDataMs: Option.some(0),
    };

    Story.story(
      withContext,
      Story.with(model),
      Story.message(EnteredDashboard()),
      Story.Command.expectNone()
    );
  });

  test("a refresh tick while metrics are loaded dispatches a revalidating fetch", () => {
    const model = {
      ...initModel(),
      metrics: MetricsAsyncData.Success({ data: [] }),
    };

    Story.story(
      withContext,
      Story.with(model),
      Story.message(TickedRefresh()),
      Story.Command.expectHas(
        FetchMetrics({
          token: "abc123",
          dateRange: DEFAULT_DATE_RANGE,
          maybeEarliestDataMs: Option.none(),
        })
      ),
      Story.model((model) => {
        expect(model.metrics._tag).toBe("Refreshing");
      }),
      Story.Command.resolve(FetchMetrics, succeededFetchMetrics())
    );
  });

  test("a refresh tick revalidates speed test history and connectivity status too when they already hold data", () => {
    const model = {
      ...initModel(),
      speedtestHistory: SpeedtestHistoryAsyncData.Success({ data: [] }),
      connectivityStatus: ConnectivityStatusAsyncData.Success({
        data: {
          points: [],
          uptimePercentage: 100,
          startTimeMs: 0,
          endTimeMs: 3_600_000,
          granularity: "1m",
        },
      }),
    };

    Story.story(
      withContext,
      Story.with(model),
      Story.message(TickedRefresh()),
      Story.Command.expectHas(
        FetchSpeedtestHistory({
          token: "abc123",
          dateRange: DEFAULT_DATE_RANGE,
          maybeEarliestDataMs: Option.none(),
        })
      ),
      Story.Command.expectHas(
        FetchConnectivityStatus({
          token: "abc123",
          dateRange: DEFAULT_DATE_RANGE,
          maybeEarliestDataMs: Option.none(),
        })
      ),
      Story.model((model) => {
        expect(model.speedtestHistory._tag).toBe("Refreshing");
        expect(model.connectivityStatus._tag).toBe("Refreshing");
      }),
      Story.Command.resolveAll(
        [FetchSpeedtestHistory, succeededFetchSpeedtestHistory()],
        [
          FetchConnectivityStatus,
          SucceededFetchConnectivityStatus({
            points: [],
            uptimePercentage: 100,
            startTimeMs: 0,
            endTimeMs: 3_600_000,
            granularity: "1m",
          }),
        ]
      )
    );
  });

  test("a refresh tick while metrics are idle never cold-starts a fetch", () => {
    Story.story(
      withContext,
      Story.with(initModel()),
      Story.message(TickedRefresh()),
      Story.Command.expectNone(),
      Story.model((model) => {
        expect(model.metrics._tag).toBe("Idle");
      })
    );
  });

  test("a refresh tick during an in-flight fetch is deduplicated", () => {
    const model = { ...initModel(), metrics: MetricsAsyncData.Loading() };

    Story.story(
      withContext,
      Story.with(model),
      Story.message(TickedRefresh()),
      Story.Command.expectNone()
    );
  });

  test("a successful fetch settles metrics into Success", () => {
    const model = { ...initModel(), metrics: MetricsAsyncData.Loading() };

    Story.story(
      withContext,
      Story.with(model),
      Story.message(succeededFetchMetrics()),
      Story.model((model) => {
        expect(model.metrics).toEqual(MetricsAsyncData.Success({ data: [] }));
      })
    );
  });

  test("a failed refresh keeps the stale metrics on screen with the error", () => {
    const model = {
      ...initModel(),
      metrics: MetricsAsyncData.Refreshing({ data: [] }),
    };

    Story.story(
      withContext,
      Story.with(model),
      Story.message(FailedFetchMetrics({ error: "network error" })),
      Story.model((model) => {
        expect(model.metrics).toEqual(
          MetricsAsyncData.Stale({ error: "network error", data: [] })
        );
      })
    );
  });

  test("a failed cold fetch becomes a bare Failure", () => {
    const model = { ...initModel(), metrics: MetricsAsyncData.Loading() };

    Story.story(
      withContext,
      Story.with(model),
      Story.message(FailedFetchMetrics({ error: "network error" })),
      Story.model((model) => {
        expect(model.metrics).toEqual(
          MetricsAsyncData.Failure({ error: "network error" })
        );
      })
    );
  });
});

describe("dashboard update — earliest data", () => {
  test("entering the dashboard fetches the earliest datapoint once", () => {
    Story.story(
      withContext,
      Story.with(initModel()),
      Story.message(EnteredDashboard()),
      Story.Command.expectHas(FetchEarliestData({ token: "abc123" })),
      Story.Command.resolveAll(
        [FetchMetrics, succeededFetchMetrics()],
        [FetchSpeedtestHistory, succeededFetchSpeedtestHistory()],
        [
          FetchConnectivityStatus,
          SucceededFetchConnectivityStatus({
            points: [],
            uptimePercentage: 100,
            startTimeMs: 0,
            endTimeMs: 3_600_000,
            granularity: "1m",
          }),
        ],
        [
          FetchEarliestData,
          SucceededFetchEarliestData({
            earliestMs: Option.some(Date.parse("2025-01-01T00:00:00.000Z")),
          }),
        ]
      ),
      resolveLoadTheme(),
      Story.model((model) => {
        expect(model.maybeEarliestDataMs).toEqual(
          Option.some(Date.parse("2025-01-01T00:00:00.000Z"))
        );
      })
    );
  });

  test("entering the dashboard again does not refetch a known earliest datapoint", () => {
    const model = {
      ...initModel(),
      metrics: MetricsAsyncData.Success({ data: [] }),
      speedtestHistory: SpeedtestHistoryAsyncData.Success({ data: [] }),
      connectivityStatus: ConnectivityStatusAsyncData.Success({
        data: {
          points: [],
          uptimePercentage: 100,
          startTimeMs: 0,
          endTimeMs: 3_600_000,
          granularity: "1m",
        },
      }),
      maybeTheme: Option.some("light" as const),
      maybeEarliestDataMs: Option.some(Date.parse("2025-01-01T00:00:00.000Z")),
    };

    Story.story(
      withContext,
      Story.with(model),
      Story.message(EnteredDashboard()),
      Story.Command.expectNone()
    );
  });

  test("a failed fetch is a no-op acknowledgment, leaving the earliest datapoint unknown", () => {
    Story.story(
      withContext,
      Story.with(initModel()),
      Story.message(FailedFetchEarliestData({ error: "network error" })),
      Story.Command.expectNone(),
      Story.model((model) => {
        expect(model.maybeEarliestDataMs).toEqual(Option.none());
      })
    );
  });
});

describe("dashboard update — speedtest history", () => {
  test("entering the dashboard loads speedtest history when missing", () => {
    Story.story(
      withContext,
      Story.with(initModel()),
      Story.message(EnteredDashboard()),
      Story.Command.expectHas(
        FetchSpeedtestHistory({
          token: "abc123",
          dateRange: DEFAULT_DATE_RANGE,
          maybeEarliestDataMs: Option.none(),
        })
      ),
      Story.Command.resolveAll(
        [FetchMetrics, succeededFetchMetrics()],
        [FetchSpeedtestHistory, succeededFetchSpeedtestHistory()],
        [
          FetchConnectivityStatus,
          SucceededFetchConnectivityStatus({
            points: [],
            uptimePercentage: 100,
            startTimeMs: 0,
            endTimeMs: 3_600_000,
            granularity: "1m",
          }),
        ]
      ),
      resolveLoadTheme(),
      resolveFetchEarliestData()
    );
  });

  test("a failed refresh keeps stale speedtest history on screen", () => {
    const model = {
      ...initModel(),
      speedtestHistory: SpeedtestHistoryAsyncData.Refreshing({ data: [] }),
    };

    Story.story(
      withContext,
      Story.with(model),
      Story.message(FailedFetchSpeedtestHistory({ error: "network error" })),
      Story.model((model) => {
        expect(model.speedtestHistory).toEqual(
          SpeedtestHistoryAsyncData.Stale({ error: "network error", data: [] })
        );
      })
    );
  });
});

describe("dashboard update — connectivity status", () => {
  test("a successful fetch settles connectivity status into Success", () => {
    const model = {
      ...initModel(),
      connectivityStatus: ConnectivityStatusAsyncData.Loading(),
    };

    Story.story(
      withContext,
      Story.with(model),
      Story.message(
        SucceededFetchConnectivityStatus({
          points: [],
          uptimePercentage: 99.9,
          startTimeMs: 0,
          endTimeMs: 3_600_000,
          granularity: "1m",
        })
      ),
      Story.model((model) => {
        expect(model.connectivityStatus).toEqual(
          ConnectivityStatusAsyncData.Success({
            data: {
              points: [],
              uptimePercentage: 99.9,
              startTimeMs: 0,
              endTimeMs: 3_600_000,
              granularity: "1m",
            },
          })
        );
      })
    );
  });

  test("a failed cold fetch becomes a bare Failure", () => {
    const model = {
      ...initModel(),
      connectivityStatus: ConnectivityStatusAsyncData.Loading(),
    };

    Story.story(
      withContext,
      Story.with(model),
      Story.message(FailedFetchConnectivityStatus({ error: "network error" })),
      Story.model((model) => {
        expect(model.connectivityStatus).toEqual(
          ConnectivityStatusAsyncData.Failure({ error: "network error" })
        );
      })
    );
  });
});

describe("dashboard update — date range", () => {
  test("applying a new date range forces a fresh load of all three series", () => {
    const model = {
      ...initModel(),
      metrics: MetricsAsyncData.Success({ data: [] }),
      speedtestHistory: SpeedtestHistoryAsyncData.Success({ data: [] }),
      connectivityStatus: ConnectivityStatusAsyncData.Success({
        data: {
          points: [],
          uptimePercentage: 100,
          startTimeMs: 0,
          endTimeMs: 3_600_000,
          granularity: "1m",
        },
      }),
    };
    const appliedRange = Preset({ preset: "last7d" });

    Story.story(
      withContext,
      Story.with(model),
      Story.message(
        GotDateRangePickerMessage({
          message: ClickedPreset({ preset: "last7d" }),
        })
      ),
      Story.message(GotDateRangePickerMessage({ message: ClickedApply() })),
      Story.model((model) => {
        expect(model.dateRange).toEqual(appliedRange);
        expect(model.metrics._tag).toBe("Refreshing");
        expect(model.speedtestHistory._tag).toBe("Refreshing");
        expect(model.connectivityStatus._tag).toBe("Refreshing");
      }),
      Story.Command.expectHas(
        FetchMetrics({
          token: "abc123",
          dateRange: appliedRange,
          maybeEarliestDataMs: Option.none(),
        })
      ),
      Story.Command.expectHas(
        FetchSpeedtestHistory({
          token: "abc123",
          dateRange: appliedRange,
          maybeEarliestDataMs: Option.none(),
        })
      ),
      Story.Command.expectHas(
        FetchConnectivityStatus({
          token: "abc123",
          dateRange: appliedRange,
          maybeEarliestDataMs: Option.none(),
        })
      ),
      Story.Command.resolveAll(
        [FetchMetrics, succeededFetchMetrics()],
        [FetchSpeedtestHistory, succeededFetchSpeedtestHistory()],
        [
          FetchConnectivityStatus,
          SucceededFetchConnectivityStatus({
            points: [],
            uptimePercentage: 100,
            startTimeMs: 0,
            endTimeMs: 3_600_000,
            granularity: "1m",
          }),
        ]
      ),
      resolveFocusButton()
    );
  });
});

describe("dashboard update — date range with no prior data", () => {
  test("fields with no cached data go to Loading rather than Refreshing", () => {
    const appliedRange = Preset({ preset: "last7d" });

    Story.story(
      withContext,
      Story.with(initModel()),
      Story.message(
        GotDateRangePickerMessage({
          message: ClickedPreset({ preset: "last7d" }),
        })
      ),
      Story.message(GotDateRangePickerMessage({ message: ClickedApply() })),
      Story.model((model) => {
        expect(model.dateRange).toEqual(appliedRange);
        expect(model.metrics._tag).toBe("Loading");
        expect(model.speedtestHistory._tag).toBe("Loading");
        expect(model.connectivityStatus._tag).toBe("Loading");
      }),
      Story.Command.resolveAll(
        [
          FetchMetrics({
            token: "abc123",
            dateRange: appliedRange,
            maybeEarliestDataMs: Option.none(),
          }),
          succeededFetchMetrics(),
        ],
        [
          FetchSpeedtestHistory({
            token: "abc123",
            dateRange: appliedRange,
            maybeEarliestDataMs: Option.none(),
          }),
          succeededFetchSpeedtestHistory(),
        ],
        [
          FetchConnectivityStatus({
            token: "abc123",
            dateRange: appliedRange,
            maybeEarliestDataMs: Option.none(),
          }),
          SucceededFetchConnectivityStatus({
            points: [],
            uptimePercentage: 100,
            startTimeMs: 0,
            endTimeMs: 3_600_000,
            granularity: "1m",
          }),
        ]
      ),
      resolveFocusButton()
    );
  });
});

describe("dashboard update — manual refresh", () => {
  test("clicking refresh now force-reloads all three series without changing the date range", () => {
    const currentRange = Preset({ preset: "last7d" });
    const model = {
      ...initModel(),
      dateRange: currentRange,
      metrics: MetricsAsyncData.Success({ data: [] }),
      speedtestHistory: SpeedtestHistoryAsyncData.Success({ data: [] }),
      connectivityStatus: ConnectivityStatusAsyncData.Success({
        data: {
          points: [],
          uptimePercentage: 100,
          startTimeMs: 0,
          endTimeMs: 3_600_000,
          granularity: "1m",
        },
      }),
    };

    Story.story(
      withContext,
      Story.with(model),
      Story.message(ClickedRefreshNow()),
      Story.model((model) => {
        expect(model.dateRange).toEqual(currentRange);
        expect(model.metrics._tag).toBe("Refreshing");
        expect(model.speedtestHistory._tag).toBe("Refreshing");
        expect(model.connectivityStatus._tag).toBe("Refreshing");
      }),
      Story.Command.expectHas(
        FetchMetrics({
          token: "abc123",
          dateRange: currentRange,
          maybeEarliestDataMs: Option.none(),
        })
      ),
      Story.Command.expectHas(
        FetchSpeedtestHistory({
          token: "abc123",
          dateRange: currentRange,
          maybeEarliestDataMs: Option.none(),
        })
      ),
      Story.Command.expectHas(
        FetchConnectivityStatus({
          token: "abc123",
          dateRange: currentRange,
          maybeEarliestDataMs: Option.none(),
        })
      ),
      Story.Command.resolveAll(
        [FetchMetrics, succeededFetchMetrics()],
        [FetchSpeedtestHistory, succeededFetchSpeedtestHistory()],
        [
          FetchConnectivityStatus,
          SucceededFetchConnectivityStatus({
            points: [],
            uptimePercentage: 100,
            startTimeMs: 0,
            endTimeMs: 3_600_000,
            granularity: "1m",
          }),
        ]
      )
    );
  });
});

describe("dashboard update — pause toggle", () => {
  test("toggling pause flips isPaused", () => {
    Story.story(
      withContext,
      Story.with(initModel()),
      Story.message(ClickedTogglePause()),
      Story.model((model) => {
        expect(model.isPaused).toBe(true);
      })
    );
  });
});

describe("dashboard update — idle detection", () => {
  test("going idle sets isIdle without touching isPaused", () => {
    Story.story(
      withContext,
      Story.with(initModel()),
      Story.message(WentIdle()),
      Story.model((model) => {
        expect(model.isIdle).toBe(true);
        expect(model.isPaused).toBe(false);
      })
    );
  });

  test("interacting clears isIdle without touching isPaused", () => {
    Story.story(
      withContext,
      Story.with({ ...initModel(), isIdle: true, isPaused: true }),
      Story.message(Interacted()),
      Story.model((model) => {
        expect(model.isIdle).toBe(false);
        expect(model.isPaused).toBe(true);
      })
    );
  });
});

describe("dashboard update — connectivity segment hover", () => {
  test("hovering a segment records which one is hovered", () => {
    Story.story(
      withContext,
      Story.with(initModel()),
      Story.message(HoveredConnectivitySegment({ index: 3 })),
      Story.Command.expectNone(),
      Story.model((model) => {
        expect(model.hoveredSegmentIndex).toEqual(Option.some(3));
      })
    );
  });

  test("leaving a segment clears the hover", () => {
    Story.story(
      withContext,
      Story.with({ ...initModel(), hoveredSegmentIndex: Option.some(3) }),
      Story.message(UnhoveredConnectivitySegment()),
      Story.Command.expectNone(),
      Story.model((model) => {
        expect(model.hoveredSegmentIndex).toEqual(Option.none());
      })
    );
  });
});

describe("dashboard update — toast messages", () => {
  const modelWithToast = () => {
    const [toast] = Toast.show(initModel().toast, {
      variant: "Info",
      payload: { title: "Speed test complete", description: "all good" },
    });
    return { ...initModel(), toast };
  };

  test("a toast message is delegated to the toast submodel", () => {
    Story.story(
      withContext,
      Story.with(modelWithToast()),
      Story.message(
        GotToastMessage({
          message: UiToast.HoveredEntry({
            entryId: "dashboard-toast-entry-0",
          }),
        })
      ),
      Story.Command.expectNone(),
      Story.model((model) => {
        expect(model.toast.entries[0]?.isHovered).toBe(true);
      })
    );
  });

  test("leaving a hovered entry clears the hover and reschedules its auto-dismiss", () => {
    const hovered = withContext(
      modelWithToast(),
      GotToastMessage({
        message: UiToast.HoveredEntry({ entryId: "dashboard-toast-entry-0" }),
      })
    )[0];

    const [model, commands] = withContext(
      hovered,
      GotToastMessage({
        message: UiToast.LeftEntry({ entryId: "dashboard-toast-entry-0" }),
      })
    );

    expect(model.toast.entries[0]?.isHovered).toBe(false);
    expect(commands.map((command) => command.name)).toEqual(["DismissAfter"]);
  });
});

describe("dashboard update — theme toggle", () => {
  test("toggling theme saves it and re-syncs every mounted chart with the new theme's colors", () => {
    const model = {
      ...withLoadedWindows(initModel()),
      metrics: MetricsAsyncData.Success({ data: [] }),
      speedtestHistory: SpeedtestHistoryAsyncData.Success({ data: [] }),
      maybeLatencyChartHostId: Option.some("latency-chart"),
      maybePacketLossChartHostId: Option.some("packet-loss-chart"),
      maybeJitterChartHostId: Option.some("jitter-chart"),
      maybeSpeedChartHostId: Option.some("speed-chart"),
    };

    Story.story(
      withContext,
      Story.with(model),
      Story.message(ClickedToggleTheme()),
      Story.model((updatedModel) => {
        expect(Option.getOrNull(updatedModel.maybeTheme)).toBe("dark");
      }),
      Story.Command.expectHas(SaveTheme({ theme: "dark" })),
      Story.Command.expectHas(
        SyncLatencyChart({
          hostId: "latency-chart",
          metrics: [],
          ...METRICS_WINDOW,
          theme: "dark",
        })
      ),
      Story.Command.expectHas(
        SyncPacketLossChart({
          hostId: "packet-loss-chart",
          metrics: [],
          ...METRICS_WINDOW,
          theme: "dark",
        })
      ),
      Story.Command.expectHas(
        SyncJitterChart({
          hostId: "jitter-chart",
          metrics: [],
          ...METRICS_WINDOW,
          theme: "dark",
        })
      ),
      Story.Command.expectHas(
        SyncSpeedChart({
          hostId: "speed-chart",
          metrics: [],
          ...SPEEDTEST_WINDOW,
          theme: "dark",
        })
      ),
      Story.Command.resolveAll(
        [SaveTheme, CompletedSaveTheme()],
        [SyncLatencyChart, CompletedSyncLatencyChart()],
        [SyncPacketLossChart, CompletedSyncPacketLossChart()],
        [SyncJitterChart, CompletedSyncJitterChart()],
        [SyncSpeedChart, CompletedSyncSpeedChart()]
      )
    );
  });
});

describe("dashboard update — speedtest trigger", () => {
  test("clicking trigger dispatches TriggerSpeedtest and moves to Loading", () => {
    Story.story(
      withContext,
      Story.with(initModel()),
      Story.message(ClickedTriggerSpeedtest()),
      Story.Command.expectExact(TriggerSpeedtest({ token: "abc123" })),
      Story.model((model) => {
        expect(model.speedtestTrigger._tag).toBe("Loading");
      }),
      Story.Command.resolve(
        TriggerSpeedtest,
        SucceededTriggerSpeedtest({
          downloadMbps: 500,
          uploadMbps: 50,
          pingMs: 8,
        })
      ),
      Story.Command.resolveAll(
        [FetchMetrics, succeededFetchMetrics()],
        [FetchSpeedtestHistory, succeededFetchSpeedtestHistory()]
      ),
      ToastTest.drainEntry({ entryId: "dashboard-toast-entry-0" })
    );
  });

  test("a successful trigger settles speedtestTrigger and refetches metrics + speedtest history", () => {
    const model = {
      ...initModel(),
      speedtestTrigger: SpeedtestTriggerAsyncData.Loading(),
    };

    Story.story(
      withContext,
      Story.with(model),
      Story.message(
        SucceededTriggerSpeedtest({
          downloadMbps: 500,
          uploadMbps: 50,
          pingMs: 8,
        })
      ),
      Story.Command.expectHas(
        FetchMetrics({
          token: "abc123",
          dateRange: DEFAULT_DATE_RANGE,
          maybeEarliestDataMs: Option.none(),
        })
      ),
      Story.Command.expectHas(
        FetchSpeedtestHistory({
          token: "abc123",
          dateRange: DEFAULT_DATE_RANGE,
          maybeEarliestDataMs: Option.none(),
        })
      ),
      Story.model((model) => {
        expect(model.speedtestTrigger).toEqual(
          SpeedtestTriggerAsyncData.Success({
            data: { downloadMbps: 500, uploadMbps: 50, pingMs: 8 },
          })
        );
      }),
      Story.Command.resolveAll(
        [FetchMetrics, succeededFetchMetrics()],
        [FetchSpeedtestHistory, succeededFetchSpeedtestHistory()]
      ),
      ToastTest.drainEntry({ entryId: "dashboard-toast-entry-0" })
    );
  });

  test("a failed trigger settles speedtestTrigger to Failure without refetching", () => {
    const model = {
      ...initModel(),
      speedtestTrigger: SpeedtestTriggerAsyncData.Loading(),
    };

    Story.story(
      withContext,
      Story.with(model),
      Story.message(
        FailedTriggerSpeedtest({
          message: "already running",
          isAlreadyRunning: true,
        })
      ),
      Story.model((model) => {
        expect(model.speedtestTrigger).toEqual(
          SpeedtestTriggerAsyncData.Failure({ error: "already running" })
        );
      }),
      ToastTest.drainEntry({ entryId: "dashboard-toast-entry-0" })
    );
  });
});

describe("dashboard update — latency chart", () => {
  test("mounting with no metrics data yet records the host id but syncs nothing", () => {
    Story.story(
      withContext,
      Story.with(initModel()),
      Story.message(SucceededMountLatencyChart({ hostId: "latency-chart" })),
      Story.Command.expectNone(),
      Story.model((model) => {
        expect(model.maybeLatencyChartHostId).toEqual(
          Option.some("latency-chart")
        );
      })
    );
  });

  test("mounting once metrics are already loaded immediately syncs the chart", () => {
    const model = {
      ...withLoadedWindows(initModel()),
      metrics: MetricsAsyncData.Success({ data: [] }),
    };

    Story.story(
      withContext,
      Story.with(model),
      Story.message(SucceededMountLatencyChart({ hostId: "latency-chart" })),
      Story.Command.expectExact(
        SyncLatencyChart({
          hostId: "latency-chart",
          metrics: [],
          ...METRICS_WINDOW,
          theme: "light",
        })
      ),
      Story.Command.resolve(SyncLatencyChart, CompletedSyncLatencyChart())
    );
  });

  test("a successful metrics fetch syncs the chart when it's already mounted", () => {
    const model = {
      ...initModel(),
      metrics: MetricsAsyncData.Loading(),
      maybeLatencyChartHostId: Option.some("latency-chart"),
    };

    Story.story(
      withContext,
      Story.with(model),
      Story.message(succeededFetchMetrics()),
      Story.Command.expectExact(
        SyncLatencyChart({
          hostId: "latency-chart",
          metrics: [],
          ...METRICS_WINDOW,
          theme: "light",
        })
      ),
      Story.Command.resolve(SyncLatencyChart, CompletedSyncLatencyChart())
    );
  });

  test("a successful metrics fetch dispatches nothing when the chart isn't mounted", () => {
    Story.story(
      withContext,
      Story.with({ ...initModel(), metrics: MetricsAsyncData.Loading() }),
      Story.message(succeededFetchMetrics()),
      Story.Command.expectNone()
    );
  });

  test("a failed mount is a no-op acknowledgment", () => {
    Story.story(
      withContext,
      Story.with(initModel()),
      Story.message(FailedMountLatencyChart({ reason: "no host element" })),
      Story.Command.expectNone()
    );
  });

  test("CompletedSyncLatencyChart and FailedSyncLatencyChart are no-op acknowledgments", () => {
    Story.story(
      withContext,
      Story.with(initModel()),
      Story.message(CompletedSyncLatencyChart()),
      Story.Command.expectNone()
    );
    Story.story(
      withContext,
      Story.with(initModel()),
      Story.message(FailedSyncLatencyChart({ reason: "chart disposed" })),
      Story.Command.expectNone()
    );
  });
});

describe("dashboard update — packet loss chart", () => {
  test("mounting once metrics are already loaded immediately syncs the chart", () => {
    const model = {
      ...withLoadedWindows(initModel()),
      metrics: MetricsAsyncData.Success({ data: [] }),
    };

    Story.story(
      withContext,
      Story.with(model),
      Story.message(
        SucceededMountPacketLossChart({ hostId: "packet-loss-chart" })
      ),
      Story.Command.expectExact(
        SyncPacketLossChart({
          hostId: "packet-loss-chart",
          metrics: [],
          ...METRICS_WINDOW,
          theme: "light",
        })
      ),
      Story.Command.resolve(SyncPacketLossChart, CompletedSyncPacketLossChart())
    );
  });

  test("a successful metrics fetch syncs the chart when it's already mounted", () => {
    const model = {
      ...initModel(),
      metrics: MetricsAsyncData.Loading(),
      maybePacketLossChartHostId: Option.some("packet-loss-chart"),
    };

    Story.story(
      withContext,
      Story.with(model),
      Story.message(succeededFetchMetrics()),
      Story.Command.expectExact(
        SyncPacketLossChart({
          hostId: "packet-loss-chart",
          metrics: [],
          ...METRICS_WINDOW,
          theme: "light",
        })
      ),
      Story.Command.resolve(SyncPacketLossChart, CompletedSyncPacketLossChart())
    );
  });

  test("a failed mount and failed/completed sync are no-op acknowledgments", () => {
    Story.story(
      withContext,
      Story.with(initModel()),
      Story.message(FailedMountPacketLossChart({ reason: "no host element" })),
      Story.Command.expectNone()
    );
    Story.story(
      withContext,
      Story.with(initModel()),
      Story.message(CompletedSyncPacketLossChart()),
      Story.Command.expectNone()
    );
    Story.story(
      withContext,
      Story.with(initModel()),
      Story.message(FailedSyncPacketLossChart({ reason: "chart disposed" })),
      Story.Command.expectNone()
    );
  });
});

describe("dashboard update — jitter chart", () => {
  test("mounting once metrics are already loaded immediately syncs the chart", () => {
    const model = {
      ...withLoadedWindows(initModel()),
      metrics: MetricsAsyncData.Success({ data: [] }),
    };

    Story.story(
      withContext,
      Story.with(model),
      Story.message(SucceededMountJitterChart({ hostId: "jitter-chart" })),
      Story.Command.expectExact(
        SyncJitterChart({
          hostId: "jitter-chart",
          metrics: [],
          ...METRICS_WINDOW,
          theme: "light",
        })
      ),
      Story.Command.resolve(SyncJitterChart, CompletedSyncJitterChart())
    );
  });

  test("a successful metrics fetch syncs the chart when it's already mounted", () => {
    const model = {
      ...initModel(),
      metrics: MetricsAsyncData.Loading(),
      maybeJitterChartHostId: Option.some("jitter-chart"),
    };

    Story.story(
      withContext,
      Story.with(model),
      Story.message(succeededFetchMetrics()),
      Story.Command.expectExact(
        SyncJitterChart({
          hostId: "jitter-chart",
          metrics: [],
          ...METRICS_WINDOW,
          theme: "light",
        })
      ),
      Story.Command.resolve(SyncJitterChart, CompletedSyncJitterChart())
    );
  });

  test("a failed mount and failed/completed sync are no-op acknowledgments", () => {
    Story.story(
      withContext,
      Story.with(initModel()),
      Story.message(FailedMountJitterChart({ reason: "no host element" })),
      Story.Command.expectNone()
    );
    Story.story(
      withContext,
      Story.with(initModel()),
      Story.message(CompletedSyncJitterChart()),
      Story.Command.expectNone()
    );
    Story.story(
      withContext,
      Story.with(initModel()),
      Story.message(FailedSyncJitterChart({ reason: "chart disposed" })),
      Story.Command.expectNone()
    );
  });
});

describe("dashboard update — speed chart", () => {
  test("mounting once speed test history is already loaded immediately syncs the chart", () => {
    const model = {
      ...withLoadedWindows(initModel()),
      speedtestHistory: SpeedtestHistoryAsyncData.Success({ data: [] }),
    };

    Story.story(
      withContext,
      Story.with(model),
      Story.message(SucceededMountSpeedChart({ hostId: "speed-chart" })),
      Story.Command.expectExact(
        SyncSpeedChart({
          hostId: "speed-chart",
          metrics: [],
          ...SPEEDTEST_WINDOW,
          theme: "light",
        })
      ),
      Story.Command.resolve(SyncSpeedChart, CompletedSyncSpeedChart())
    );
  });

  test("a successful speed test history fetch syncs the chart when it's already mounted", () => {
    const model = {
      ...initModel(),
      speedtestHistory: SpeedtestHistoryAsyncData.Loading(),
      maybeSpeedChartHostId: Option.some("speed-chart"),
    };

    Story.story(
      withContext,
      Story.with(model),
      Story.message(succeededFetchSpeedtestHistory()),
      Story.Command.expectExact(
        SyncSpeedChart({
          hostId: "speed-chart",
          metrics: [],
          ...SPEEDTEST_WINDOW,
          theme: "light",
        })
      ),
      Story.Command.resolve(SyncSpeedChart, CompletedSyncSpeedChart())
    );
  });

  test("a successful fetch dispatches nothing when the chart isn't mounted", () => {
    Story.story(
      withContext,
      Story.with({
        ...initModel(),
        speedtestHistory: SpeedtestHistoryAsyncData.Loading(),
      }),
      Story.message(succeededFetchSpeedtestHistory()),
      Story.Command.expectNone()
    );
  });

  test("a failed mount and failed/completed sync are no-op acknowledgments", () => {
    Story.story(
      withContext,
      Story.with(initModel()),
      Story.message(FailedMountSpeedChart({ reason: "no host element" })),
      Story.Command.expectNone()
    );
    Story.story(
      withContext,
      Story.with(initModel()),
      Story.message(CompletedSyncSpeedChart()),
      Story.Command.expectNone()
    );
    Story.story(
      withContext,
      Story.with(initModel()),
      Story.message(FailedSyncSpeedChart({ reason: "chart disposed" })),
      Story.Command.expectNone()
    );
  });
});
