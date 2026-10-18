import { Menu, RadioGroup, Toast as UiToast } from "@foldkit/ui";
import { Option } from "effect";
import { AsyncData, Story } from "foldkit";
import { describe, expect, test } from "vitest";
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
  SaveSettings,
  TriggerSpeedtest,
} from "@/dashboard/command";
import { Custom, Preset, type PresetKey } from "@/dashboard/dateRange";
import { ClickedApply, ClickedPreset } from "@/dashboard/dateRangePicker";
import type { LatencyView } from "@/dashboard/latencyView";
import { LATENCY_VIEWS } from "@/dashboard/latencyViewRadioGroup";
import { MENU_ITEMS, type MenuItem } from "@/dashboard/menu";
import {
  BrushedChartRange,
  ChangedSystemTheme,
  ClearedConnectivitySelection,
  ClickedRefreshNow,
  ClickedResetRange,
  ClickedTogglePause,
  ClickedTriggerSpeedtest,
  CompletedApplyTheme,
  CompletedSaveSettings,
  CompletedSyncJitterChart,
  CompletedSyncLatencyChart,
  CompletedSyncPacketLossChart,
  CompletedSyncSpeedChart,
  EnteredDashboard,
  FailedFetchConnectivityStatus,
  FailedFetchEarliestData,
  FailedFetchHostLatency,
  FailedFetchLiveConnectivity,
  FailedFetchMetrics,
  FailedFetchOutages,
  FailedFetchPingHosts,
  FailedFetchSpeedtestHistory,
  FailedFetchSummary,
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
  GotLatencyViewMessage,
  GotMenuMessage,
  GotToastMessage,
  HoveredConnectivitySegment,
  Interacted,
  MeasuredRibbon,
  type Message,
  PressedRibbonKey,
  type RangeRequest,
  RequestedLogout,
  SelectedQuickRange,
  SucceededFetchConnectivityStatus,
  SucceededFetchEarliestData,
  SucceededFetchHostLatency,
  SucceededFetchLiveConnectivity,
  SucceededFetchMetrics,
  SucceededFetchOutages,
  SucceededFetchPingHosts,
  SucceededFetchSpeedtestHistory,
  SucceededFetchSummary,
  SucceededMountJitterChart,
  SucceededMountLatencyChart,
  SucceededMountPacketLossChart,
  SucceededMountSpeedChart,
  SucceededTriggerSpeedtest,
  TickedClock,
  TickedRefresh,
  ToggledConnectivitySegment,
  UnhoveredConnectivitySegment,
  WentIdle,
} from "@/dashboard/message";
import {
  ConnectivityStatusAsyncData,
  HostLatencyAsyncData,
  LiveConnectivityAsyncData,
  MetricsAsyncData,
  type Model,
  OutagesAsyncData,
  PingHostsAsyncData,
  initModel as realInitModel,
  SpeedtestHistoryAsyncData,
  SpeedtestTriggerAsyncData,
  SummaryAsyncData,
} from "@/dashboard/model";
import {
  DEFAULT_REQUEST,
  hostsResponse,
  loadedInsights,
  outagesData,
  outagesResponse,
  summaryData,
  summaryResponse,
} from "@/dashboard/testFixtures";
import { Toast, ToastTest } from "@/dashboard/toast";
import { update } from "@/dashboard/update";
import { connectionOf } from "@/dashboard/view/derived";
import { defaultSettings } from "@/storage";

const NOW_MS = Date.parse("2026-07-28T12:00:00.000Z");
const initModel = (settings: Parameters<typeof realInitModel>[0]) =>
  realInitModel(settings, NOW_MS);

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
};

const succeededFetchMetrics = () =>
  SucceededFetchMetrics({
    metrics: [],
    nowMs: 0,
    ...METRICS_WINDOW,
    request: DEFAULT_REQUEST,
  });
const succeededFetchSpeedtestHistory = () =>
  SucceededFetchSpeedtestHistory({
    history: [],
    ...SPEEDTEST_WINDOW,
    request: DEFAULT_REQUEST,
  });

// A model that has already settled a metrics fetch: data plus the window it
// was fetched for, which is what gates a chart sync.
const withLoadedWindows = (model: ReturnType<typeof initModel>) => ({
  ...model,
  maybeMetricsWindow: Option.some({
    ...METRICS_WINDOW,
    request: DEFAULT_REQUEST,
  }),
  maybeSpeedtestWindow: Option.some({
    ...SPEEDTEST_WINDOW,
    request: DEFAULT_REQUEST,
  }),
});

const context = { token: "abc123", now: () => NOW_MS };
const withContext = (
  model: ReturnType<typeof initModel>,
  message: Parameters<typeof update>[1]
) => update(model, message, context);

const resolveApplyTheme = () =>
  Story.Command.resolve(ApplyTheme, CompletedApplyTheme());

const resolveFetchEarliestData = () =>
  Story.Command.resolve(
    FetchEarliestData,
    SucceededFetchEarliestData({ earliestMs: Option.none() })
  );

const resolveFetchLiveConnectivity = () =>
  Story.Command.resolve(
    FetchLiveConnectivity,
    SucceededFetchLiveConnectivity({
      status: "up",
      maybeLastSampleAtMs: Option.none(),
    })
  );

const resolveEnterInsights = () =>
  Story.Command.resolveAll(
    [
      FetchSummary,
      FailedFetchSummary({ error: "skip", request: DEFAULT_REQUEST }),
    ],
    [
      FetchOutages,
      FailedFetchOutages({ error: "skip", request: DEFAULT_REQUEST }),
    ],
    [FetchPingHosts, FailedFetchPingHosts({ error: "skip" })]
  );

const resolveRangeInsights = () =>
  Story.Command.resolveAll(
    [
      FetchSummary,
      FailedFetchSummary({ error: "skip", request: DEFAULT_REQUEST }),
    ],
    [
      FetchOutages,
      FailedFetchOutages({ error: "skip", request: DEFAULT_REQUEST }),
    ]
  );

const resolveSummaryFetch = () =>
  Story.Command.resolve(
    FetchSummary,
    FailedFetchSummary({ error: "skip", request: DEFAULT_REQUEST })
  );

const loadedLiveConnectivity = () =>
  LiveConnectivityAsyncData.Success({
    data: { status: "up" as const, maybeLastSampleAtMs: Option.none() },
  });

describe("dashboard update — metrics", () => {
  test("entering the dashboard with no cached metrics loads them", () => {
    Story.story(
      withContext,
      Story.given(initModel(defaultSettings())),
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
            request: DEFAULT_REQUEST,
            points: [],
            maybeUptimePercentage: Option.some(100),
            maybeAvailabilityPercentage: Option.some(100),
            coveragePercentage: 100,
            startTimeMs: 0,
            endTimeMs: 3_600_000,
            granularity: "1m",
          }),
        ]
      ),
      resolveApplyTheme(),
      resolveFetchEarliestData(),
      resolveFetchLiveConnectivity(),
      resolveEnterInsights()
    );
  });

  test("entering the dashboard again with everything already loaded does not refetch anything", () => {
    const model = {
      ...initModel(defaultSettings()),
      metrics: MetricsAsyncData.Success({ data: [] }),
      speedtestHistory: SpeedtestHistoryAsyncData.Success({ data: [] }),
      connectivityStatus: ConnectivityStatusAsyncData.Success({
        data: {
          points: [],
          maybeUptimePercentage: Option.some(100),
          maybeAvailabilityPercentage: Option.some(100),
          coveragePercentage: 100,
          startTimeMs: 0,
          endTimeMs: 3_600_000,
          granularity: "1m",
          request: DEFAULT_REQUEST,
        },
      }),
      liveConnectivity: loadedLiveConnectivity(),
      maybeEarliestDataMs: Option.some(0),
    };

    Story.story(
      withContext,
      Story.given({ ...model, ...loadedInsights() }),
      Story.message(EnteredDashboard()),
      // ApplyTheme is the one exception: it re-fires every entry as an
      // idempotent re-assert against `<html>`, regardless of what's loaded.
      Story.Command.expectExact(ApplyTheme({ theme: "system" })),
      resolveApplyTheme()
    );
  });

  test("a refresh tick while metrics are loaded dispatches a revalidating fetch", () => {
    const model = {
      ...initModel(defaultSettings()),
      metrics: MetricsAsyncData.Success({ data: [] }),
    };

    Story.story(
      withContext,
      Story.given(model),
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
      ...initModel(defaultSettings()),
      speedtestHistory: SpeedtestHistoryAsyncData.Success({ data: [] }),
      connectivityStatus: ConnectivityStatusAsyncData.Success({
        data: {
          points: [],
          maybeUptimePercentage: Option.some(100),
          maybeAvailabilityPercentage: Option.some(100),
          coveragePercentage: 100,
          startTimeMs: 0,
          endTimeMs: 3_600_000,
          granularity: "1m",
          request: DEFAULT_REQUEST,
        },
      }),
    };

    Story.story(
      withContext,
      Story.given(model),
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
            request: DEFAULT_REQUEST,
            points: [],
            maybeUptimePercentage: Option.some(100),
            maybeAvailabilityPercentage: Option.some(100),
            coveragePercentage: 100,
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
      Story.given(initModel(defaultSettings())),
      Story.message(TickedRefresh()),
      Story.Command.expectNone(),
      Story.model((model) => {
        expect(model.metrics._tag).toBe("Idle");
      })
    );
  });

  test("a refresh tick during an in-flight fetch is deduplicated", () => {
    const model = {
      ...initModel(defaultSettings()),
      metrics: MetricsAsyncData.Loading(),
    };

    Story.story(
      withContext,
      Story.given(model),
      Story.message(TickedRefresh()),
      Story.Command.expectNone()
    );
  });

  test("a successful fetch settles metrics into Success", () => {
    const model = {
      ...initModel(defaultSettings()),
      metrics: MetricsAsyncData.Loading(),
    };

    Story.story(
      withContext,
      Story.given(model),
      Story.message(succeededFetchMetrics()),
      Story.model((model) => {
        expect(model.metrics).toEqual(MetricsAsyncData.Success({ data: [] }));
      })
    );
  });

  test("a failed refresh keeps the stale metrics on screen with the error", () => {
    const model = {
      ...initModel(defaultSettings()),
      metrics: MetricsAsyncData.Refreshing({ data: [] }),
    };

    Story.story(
      withContext,
      Story.given(model),
      Story.message(
        FailedFetchMetrics({ error: "network error", request: DEFAULT_REQUEST })
      ),
      Story.model((model) => {
        expect(model.metrics).toEqual(
          MetricsAsyncData.Stale({ error: "network error", data: [] })
        );
      })
    );
  });

  test("a failed cold fetch becomes a bare Failure", () => {
    const model = {
      ...initModel(defaultSettings()),
      metrics: MetricsAsyncData.Loading(),
    };

    Story.story(
      withContext,
      Story.given(model),
      Story.message(
        FailedFetchMetrics({ error: "network error", request: DEFAULT_REQUEST })
      ),
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
      Story.given(initModel(defaultSettings())),
      Story.message(EnteredDashboard()),
      Story.Command.expectHas(FetchEarliestData({ token: "abc123" })),
      Story.Command.resolveAll(
        [FetchMetrics, succeededFetchMetrics()],
        [FetchSpeedtestHistory, succeededFetchSpeedtestHistory()],
        [
          FetchConnectivityStatus,
          SucceededFetchConnectivityStatus({
            request: DEFAULT_REQUEST,
            points: [],
            maybeUptimePercentage: Option.some(100),
            maybeAvailabilityPercentage: Option.some(100),
            coveragePercentage: 100,
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
      resolveApplyTheme(),
      resolveFetchLiveConnectivity(),
      resolveEnterInsights(),
      Story.model((model) => {
        expect(model.maybeEarliestDataMs).toEqual(
          Option.some(Date.parse("2025-01-01T00:00:00.000Z"))
        );
      })
    );
  });

  test("entering the dashboard again does not refetch a known earliest datapoint", () => {
    const model = {
      ...initModel(defaultSettings()),
      metrics: MetricsAsyncData.Success({ data: [] }),
      speedtestHistory: SpeedtestHistoryAsyncData.Success({ data: [] }),
      connectivityStatus: ConnectivityStatusAsyncData.Success({
        data: {
          points: [],
          maybeUptimePercentage: Option.some(100),
          maybeAvailabilityPercentage: Option.some(100),
          coveragePercentage: 100,
          startTimeMs: 0,
          endTimeMs: 3_600_000,
          granularity: "1m",
          request: DEFAULT_REQUEST,
        },
      }),
      liveConnectivity: loadedLiveConnectivity(),
      maybeEarliestDataMs: Option.some(Date.parse("2025-01-01T00:00:00.000Z")),
    };

    Story.story(
      withContext,
      Story.given({ ...model, ...loadedInsights() }),
      Story.message(EnteredDashboard()),
      // ApplyTheme is the one exception: it re-fires every entry as an
      // idempotent re-assert against `<html>`, regardless of what's loaded.
      Story.Command.expectExact(ApplyTheme({ theme: "system" })),
      resolveApplyTheme()
    );
  });

  test("a failed fetch leaves the earliest datapoint unknown and marks it settled", () => {
    Story.story(
      withContext,
      Story.given(initModel(defaultSettings())),
      Story.message(FailedFetchEarliestData({ error: "network error" })),
      Story.Command.expectNone(),
      Story.model((model) => {
        expect(model.maybeEarliestDataMs).toEqual(Option.none());
        expect(model.isEarliestDataSettled).toBe(true);
      })
    );
  });

  test("resolving the earliest datapoint for an unresolved 'All time' range reloads all three series", () => {
    // Before this resolves, `getPresetRange` has nothing to start "All time"
    // from but the Unix epoch fallback (see `dateRange.ts`) — so the fetch
    // `EnteredDashboard` already made ran against a 1970-to-now window. Once
    // the real earliest timestamp is known, it has to force a reload rather
    // than just record it, or that epoch-wide window (and its 1-day
    // granularity) would sit there until the next auto-refresh tick — which
    // never comes if `isPaused` was also restored.
    const model = {
      ...initModel(defaultSettings()),
      dateRange: Preset({ preset: "allTime" }),
      maybeEarliestDataMs: Option.none(),
    };
    const earliestMs = Date.parse("2025-01-01T00:00:00.000Z");

    Story.story(
      withContext,
      Story.given(model),
      Story.message(
        SucceededFetchEarliestData({ earliestMs: Option.some(earliestMs) })
      ),
      Story.model((nextModel) => {
        expect(nextModel.maybeEarliestDataMs).toEqual(Option.some(earliestMs));
      }),
      Story.Command.expectHas(
        FetchMetrics({
          token: "abc123",
          dateRange: Preset({ preset: "allTime" }),
          maybeEarliestDataMs: Option.some(earliestMs),
        })
      ),
      Story.Command.expectHas(
        FetchSpeedtestHistory({
          token: "abc123",
          dateRange: Preset({ preset: "allTime" }),
          maybeEarliestDataMs: Option.some(earliestMs),
        })
      ),
      Story.Command.expectHas(
        FetchConnectivityStatus({
          token: "abc123",
          dateRange: Preset({ preset: "allTime" }),
          maybeEarliestDataMs: Option.some(earliestMs),
        })
      ),
      Story.Command.resolveAll(
        [FetchMetrics, succeededFetchMetrics()],
        [FetchSpeedtestHistory, succeededFetchSpeedtestHistory()],
        [
          FetchConnectivityStatus,
          SucceededFetchConnectivityStatus({
            request: DEFAULT_REQUEST,
            points: [],
            maybeUptimePercentage: Option.some(100),
            maybeAvailabilityPercentage: Option.some(100),
            coveragePercentage: 100,
            startTimeMs: 0,
            endTimeMs: 3_600_000,
            granularity: "1m",
          }),
        ]
      ),
      resolveRangeInsights()
    );
  });

  test("does not reload for a non-'All time' range", () => {
    const model = {
      ...initModel(defaultSettings()),
      dateRange: Preset({ preset: "last30d" }),
      maybeEarliestDataMs: Option.none(),
    };

    Story.story(
      withContext,
      Story.given(model),
      Story.message(
        SucceededFetchEarliestData({
          earliestMs: Option.some(Date.parse("2025-01-01T00:00:00.000Z")),
        })
      ),
      Story.Command.expectNone()
    );
  });

  test("does not reload again once the earliest datapoint is already resolved", () => {
    const model = {
      ...initModel(defaultSettings()),
      dateRange: Preset({ preset: "allTime" }),
      maybeEarliestDataMs: Option.some(Date.parse("2025-01-01T00:00:00.000Z")),
    };

    Story.story(
      withContext,
      Story.given(model),
      Story.message(
        SucceededFetchEarliestData({
          earliestMs: Option.some(Date.parse("2024-06-01T00:00:00.000Z")),
        })
      ),
      Story.Command.expectNone()
    );
  });
});

describe("dashboard update: 'All time' while the earliest datapoint is unknown", () => {
  const ALL_TIME = Preset({ preset: "allTime" });
  const EARLIEST_MS = Date.parse("2025-01-01T00:00:00.000Z");
  const RANGE_FETCHES = [
    "FetchMetrics",
    "FetchSpeedtestHistory",
    "FetchConnectivityStatus",
    "FetchSummary",
    "FetchOutages",
  ];
  const onAllTime = (overrides: Partial<Model> = {}): Model => ({
    ...initModel({ ...defaultSettings(), dateRange: ALL_TIME }),
    ...overrides,
  });
  const names = (commands: ReadonlyArray<{ name: string }> = []) =>
    commands.map((command) => command.name);
  const argsOf = (
    commands: ReadonlyArray<{ name: string; args?: unknown }> = [],
    name: string
  ) => commands.find((command) => command.name === name)?.args;

  test("entering the dashboard fetches the earliest datapoint and nothing scoped to the range", () => {
    const { model, commands } = withContext(onAllTime(), EnteredDashboard());

    expect(names(commands)).toContain("FetchEarliestData");
    for (const name of RANGE_FETCHES) {
      expect(names(commands)).not.toContain(name);
    }
    expect(model.metrics._tag).toBe("Loading");
    expect(model.summary._tag).toBe("Loading");
    expect(model.outages._tag).toBe("Loading");
  });

  test("picking it before the earliest datapoint settles starts no range fetch", () => {
    const { model, commands } = withContext(
      initModel(defaultSettings()),
      GotDateRangePickerMessage({
        message: ClickedPreset({ preset: "allTime" }),
      })
    );
    const applied = withContext(
      model,
      GotDateRangePickerMessage({ message: ClickedApply() })
    );

    expect(commands ?? []).toEqual([]);
    expect(applied.model.dateRange).toEqual(ALL_TIME);
    for (const name of RANGE_FETCHES) {
      expect(names(applied.commands)).not.toContain(name);
    }
  });

  test("a settled earliest datapoint of none falls back to the last 30 days and loads the range", () => {
    const { model, commands } = withContext(
      onAllTime(),
      SucceededFetchEarliestData({ earliestMs: Option.none() })
    );

    expect(model.isEarliestDataSettled).toBe(true);
    expect(model.dateRange).toEqual(ALL_TIME);
    expect(names(commands)).toEqual(expect.arrayContaining(RANGE_FETCHES));
    expect(argsOf(commands, "FetchMetrics")).toEqual({
      token: "abc123",
      dateRange: ALL_TIME,
      maybeEarliestDataMs: Option.none(),
    });
  });

  test("a failed earliest fetch loads the range the same way", () => {
    const { model, commands } = withContext(
      onAllTime(),
      FailedFetchEarliestData({ error: "Request failed" })
    );

    expect(model.isEarliestDataSettled).toBe(true);
    expect(names(commands)).toEqual(expect.arrayContaining(RANGE_FETCHES));
  });

  test("a failed earliest fetch keeps the earliest datapoint already known and reloads nothing", () => {
    const known = Option.some(EARLIEST_MS);
    const { model, commands } = withContext(
      onAllTime({ maybeEarliestDataMs: known, isEarliestDataSettled: true }),
      FailedFetchEarliestData({ error: "Request failed" })
    );

    expect(model.maybeEarliestDataMs).toEqual(known);
    expect(commands ?? []).toEqual([]);
  });

  test("a settled earliest datapoint reloads nothing for another range", () => {
    const { commands } = withContext(
      initModel(defaultSettings()),
      SucceededFetchEarliestData({ earliestMs: Option.none() })
    );

    expect(commands ?? []).toEqual([]);
  });

  test("once settled, picking it loads the range at once", () => {
    const settled = onAllTime({
      dateRange: Preset({ preset: "last7d" }),
      isEarliestDataSettled: true,
    });
    const { model } = withContext(
      settled,
      GotDateRangePickerMessage({
        message: ClickedPreset({ preset: "allTime" }),
      })
    );
    const { commands } = withContext(
      model,
      GotDateRangePickerMessage({ message: ClickedApply() })
    );

    expect(names(commands)).toEqual(expect.arrayContaining(RANGE_FETCHES));
  });

  describe("Refresh now and auto-refresh", () => {
    const unknown = onAllTime({ isEarliestDataSettled: true });
    const known = onAllTime({
      isEarliestDataSettled: true,
      maybeEarliestDataMs: Option.some(EARLIEST_MS),
    });

    test("Refresh now fetches the earliest datapoint again while it is unknown", () => {
      expect(
        names(withContext(unknown, ClickedRefreshNow()).commands)
      ).toContain("FetchEarliestData");
    });

    test("Refresh now leaves a known earliest datapoint alone", () => {
      expect(
        names(withContext(known, ClickedRefreshNow()).commands)
      ).not.toContain("FetchEarliestData");
    });

    test("Refresh now before the earliest datapoint settles asks for it again and loads nothing for the range", () => {
      const { commands } = withContext(onAllTime(), ClickedRefreshNow());

      expect(names(commands)).toContain("FetchEarliestData");
      for (const name of RANGE_FETCHES) {
        expect(names(commands)).not.toContain(name);
      }
    });

    test("a tick fetches it again while it is unknown and 'All time' is selected", () => {
      expect(names(withContext(unknown, TickedRefresh()).commands)).toContain(
        "FetchEarliestData"
      );
    });

    test("a tick does not look for it on another range, or once it is known", () => {
      expect(
        names(
          withContext(
            { ...unknown, dateRange: Preset({ preset: "last7d" }) },
            TickedRefresh()
          ).commands
        )
      ).not.toContain("FetchEarliestData");
      expect(names(withContext(known, TickedRefresh()).commands)).not.toContain(
        "FetchEarliestData"
      );
    });

    test("learning the start after a fallback reloads the range from it", () => {
      const { model, commands } = withContext(
        unknown,
        SucceededFetchEarliestData({ earliestMs: Option.some(EARLIEST_MS) })
      );

      expect(model.maybeEarliestDataMs).toEqual(Option.some(EARLIEST_MS));
      expect(argsOf(commands, "FetchSummary")).toEqual({
        token: "abc123",
        dateRange: ALL_TIME,
        maybeEarliestDataMs: Option.some(EARLIEST_MS),
      });
    });
  });
});

describe("dashboard update: retrying a fetch that failed", () => {
  const failed = { error: "Request failed" };
  const afterBootFailures = () => ({
    ...initModel(defaultSettings()),
    summary: SummaryAsyncData.Failure(failed),
    outages: OutagesAsyncData.Failure(failed),
    pingHosts: PingHostsAsyncData.Failure(failed),
    connectivityStatus: ConnectivityStatusAsyncData.Failure(failed),
    metrics: MetricsAsyncData.Failure(failed),
    speedtestHistory: SpeedtestHistoryAsyncData.Failure(failed),
  });
  const tick = () => withContext(afterBootFailures(), TickedRefresh());

  test.each([
    ["summary", "FetchSummary"],
    ["outages", "FetchOutages"],
    ["pingHosts", "FetchPingHosts"],
    ["connectivityStatus", "FetchConnectivityStatus"],
    ["metrics", "FetchMetrics"],
    ["speedtestHistory", "FetchSpeedtestHistory"],
  ] as const)(
    "a tick starts the %s fetch again and keeps the failure on screen",
    (field, command) => {
      const before = afterBootFailures();
      const { model, commands = [] } = tick();

      expect(model[field]).toEqual(before[field]);
      expect(commands.map(({ name }) => name)).toContain(command);
    }
  );

  test("a retried fetch that succeeds settles to Success", () => {
    const { model: retrying } = tick();

    const afterSummary = withContext(
      retrying,
      SucceededFetchSummary({
        summary: summaryResponse(),
        request: DEFAULT_REQUEST,
      })
    ).model;
    const afterOutages = withContext(
      afterSummary,
      SucceededFetchOutages({
        outages: outagesResponse(),
        isClamped: false,
        fetchedAtMs: NOW_MS,
        request: DEFAULT_REQUEST,
      })
    ).model;
    const afterHosts = withContext(
      afterOutages,
      SucceededFetchPingHosts({ hosts: hostsResponse() })
    ).model;

    expect(afterHosts.summary._tag).toBe("Success");
    expect(afterHosts.outages._tag).toBe("Success");
    expect(afterHosts.pingHosts._tag).toBe("Success");
  });

  test("a retried fetch that fails again stays a Failure", () => {
    const { model: retrying } = tick();

    const afterFailures = withContext(
      withContext(
        withContext(
          retrying,
          FailedFetchSummary({ error: "db down", request: DEFAULT_REQUEST })
        ).model,
        FailedFetchOutages({ error: "db down", request: DEFAULT_REQUEST })
      ).model,
      FailedFetchPingHosts({ error: "db down" })
    ).model;

    expect(afterFailures.summary).toEqual(
      SummaryAsyncData.Failure({ error: "db down" })
    );
    expect(afterFailures.outages).toEqual(
      OutagesAsyncData.Failure({ error: "db down" })
    );
    expect(afterFailures.pingHosts).toEqual(
      PingHostsAsyncData.Failure({ error: "db down" })
    );
  });

  test("an answer for a range that was left while a retry was in flight is dropped", () => {
    const { model: retrying } = tick();
    const { model: moved } = withContext(
      retrying,
      SelectedQuickRange({ preset: "last7d" })
    );

    const { model } = withContext(
      moved,
      SucceededFetchSummary({
        summary: summaryResponse(),
        request: DEFAULT_REQUEST,
      })
    );

    expect(model.summary._tag).toBe("Loading");
  });

  test("a tick does not restart a fetch that is already in flight", () => {
    const { commands = [] } = withContext(
      {
        ...afterBootFailures(),
        summary: SummaryAsyncData.Loading(),
        metrics: MetricsAsyncData.Loading(),
        speedtestHistory: SpeedtestHistoryAsyncData.Refreshing({ data: [] }),
      },
      TickedRefresh()
    );

    const names = commands.map(({ name }) => name);
    expect(names).not.toContain("FetchSummary");
    expect(names).not.toContain("FetchMetrics");
    expect(names).not.toContain("FetchSpeedtestHistory");
  });

  test("a tick leaves loaded hosts alone: they are static config", () => {
    const { commands = [] } = withContext(
      { ...initModel(defaultSettings()), ...loadedInsights() },
      TickedRefresh()
    );

    expect(commands.map(({ name }) => name)).not.toContain("FetchPingHosts");
  });
});

describe("dashboard update: the range-scoped reload list", () => {
  const RANGE_FETCHES = [
    "FetchMetrics",
    "FetchSpeedtestHistory",
    "FetchConnectivityStatus",
    "FetchSummary",
    "FetchOutages",
  ];
  const allTimeUnresolved = {
    ...initModel({
      ...defaultSettings(),
      dateRange: Preset({ preset: "allTime" }),
    }),
    ...loadedInsights(),
  };
  const paths: ReadonlyArray<readonly [string, Model, Message]> = [
    [
      "a range change",
      { ...initModel(defaultSettings()), ...loadedInsights() },
      SelectedQuickRange({ preset: "last7d" }),
    ],
    [
      "Refresh now",
      { ...initModel(defaultSettings()), ...loadedInsights() },
      ClickedRefreshNow(),
    ],
    [
      "the earliest datapoint landing",
      allTimeUnresolved,
      SucceededFetchEarliestData({ earliestMs: Option.some(1_000) }),
    ],
  ];

  test.each(paths)(
    "%s reloads every range-scoped resource",
    (_name, model, message) => {
      const { commands = [] } = withContext(model, message);

      expect(commands.map(({ name }) => name)).toEqual(
        expect.arrayContaining(RANGE_FETCHES)
      );
    }
  );
});

describe("dashboard update — speedtest history", () => {
  test("entering the dashboard loads speedtest history when missing", () => {
    Story.story(
      withContext,
      Story.given(initModel(defaultSettings())),
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
            request: DEFAULT_REQUEST,
            points: [],
            maybeUptimePercentage: Option.some(100),
            maybeAvailabilityPercentage: Option.some(100),
            coveragePercentage: 100,
            startTimeMs: 0,
            endTimeMs: 3_600_000,
            granularity: "1m",
          }),
        ]
      ),
      resolveApplyTheme(),
      resolveFetchEarliestData(),
      resolveFetchLiveConnectivity(),
      resolveEnterInsights()
    );
  });

  test("a failed refresh keeps stale speedtest history on screen", () => {
    const model = {
      ...initModel(defaultSettings()),
      speedtestHistory: SpeedtestHistoryAsyncData.Refreshing({ data: [] }),
    };

    Story.story(
      withContext,
      Story.given(model),
      Story.message(
        FailedFetchSpeedtestHistory({
          error: "network error",
          request: DEFAULT_REQUEST,
        })
      ),
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
      ...initModel(defaultSettings()),
      connectivityStatus: ConnectivityStatusAsyncData.Loading(),
    };

    Story.story(
      withContext,
      Story.given(model),
      Story.message(
        SucceededFetchConnectivityStatus({
          request: DEFAULT_REQUEST,
          points: [],
          maybeUptimePercentage: Option.some(99.9),
          maybeAvailabilityPercentage: Option.some(99.9),
          coveragePercentage: 100,
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
              maybeUptimePercentage: Option.some(99.9),
              maybeAvailabilityPercentage: Option.some(99.9),
              coveragePercentage: 100,
              startTimeMs: 0,
              endTimeMs: 3_600_000,
              granularity: "1m",
              request: DEFAULT_REQUEST,
            },
          })
        );
      })
    );
  });

  test("a failed cold fetch becomes a bare Failure", () => {
    const model = {
      ...initModel(defaultSettings()),
      connectivityStatus: ConnectivityStatusAsyncData.Loading(),
    };

    Story.story(
      withContext,
      Story.given(model),
      Story.message(
        FailedFetchConnectivityStatus({
          error: "network error",
          request: DEFAULT_REQUEST,
        })
      ),
      Story.model((model) => {
        expect(model.connectivityStatus).toEqual(
          ConnectivityStatusAsyncData.Failure({ error: "network error" })
        );
      })
    );
  });
});

describe("dashboard update — live connectivity", () => {
  test("entering the dashboard fetches the live status with no date range attached", () => {
    Story.story(
      withContext,
      Story.given(initModel(defaultSettings())),
      Story.message(EnteredDashboard()),
      Story.Command.expectHas(FetchLiveConnectivity({ token: "abc123" })),
      Story.model((model) => {
        expect(model.liveConnectivity._tag).toBe("Loading");
      }),
      Story.Command.resolveAll(
        [FetchMetrics, succeededFetchMetrics()],
        [FetchSpeedtestHistory, succeededFetchSpeedtestHistory()],
        [
          FetchConnectivityStatus,
          SucceededFetchConnectivityStatus({
            request: DEFAULT_REQUEST,
            points: [],
            maybeUptimePercentage: Option.some(100),
            maybeAvailabilityPercentage: Option.some(100),
            coveragePercentage: 100,
            startTimeMs: 0,
            endTimeMs: 3_600_000,
            granularity: "1m",
          }),
        ]
      ),
      resolveApplyTheme(),
      resolveFetchEarliestData(),
      resolveFetchLiveConnectivity(),
      resolveEnterInsights()
    );
  });

  test("a refresh tick revalidates the live status through the existing tick", () => {
    const model = {
      ...initModel(defaultSettings()),
      liveConnectivity: loadedLiveConnectivity(),
    };

    Story.story(
      withContext,
      Story.given(model),
      Story.message(TickedRefresh()),
      Story.Command.expectExact(FetchLiveConnectivity({ token: "abc123" })),
      Story.model((model) => {
        expect(model.liveConnectivity._tag).toBe("Refreshing");
      }),
      resolveFetchLiveConnectivity()
    );
  });

  test("a refresh tick on a status the last fetch could not confirm drops the stale value while it refetches", () => {
    const model = {
      ...initModel(defaultSettings()),
      liveConnectivity: LiveConnectivityAsyncData.Stale({
        error: "network error",
        data: { status: "up" as const, maybeLastSampleAtMs: Option.none() },
      }),
    };

    Story.story(
      withContext,
      Story.given(model),
      Story.message(TickedRefresh()),
      Story.Command.expectExact(FetchLiveConnectivity({ token: "abc123" })),
      Story.model((model) => {
        expect(model.liveConnectivity._tag).toBe("Loading");
        expect(connectionOf(model)).not.toBe("up");
      }),
      resolveFetchLiveConnectivity()
    );
  });

  test("a refresh tick retries a live status whose fetch failed with nothing to show", () => {
    const model = {
      ...initModel(defaultSettings()),
      liveConnectivity: LiveConnectivityAsyncData.Failure({
        error: "network error",
      }),
    };

    Story.story(
      withContext,
      Story.given(model),
      Story.message(TickedRefresh()),
      Story.Command.expectExact(FetchLiveConnectivity({ token: "abc123" })),
      Story.model((model) => {
        expect(model.liveConnectivity).toEqual(
          LiveConnectivityAsyncData.Failure({ error: "network error" })
        );
        expect(connectionOf(model)).toBe("noInfo");
      }),
      resolveFetchLiveConnectivity()
    );
  });

  test("a status that keeps failing reads the same before, during and after each retry", () => {
    const failed = {
      ...initModel(defaultSettings()),
      liveConnectivity: LiveConnectivityAsyncData.Failure({
        error: "network error",
      }),
    };

    const retrying = withContext(failed, TickedRefresh()).model;
    const failedAgain = withContext(
      retrying,
      FailedFetchLiveConnectivity({ error: "network error" })
    ).model;

    expect([failed, retrying, failedAgain].map(connectionOf)).toEqual([
      "noInfo",
      "noInfo",
      "noInfo",
    ]);
    expect(failedAgain.liveConnectivity).toEqual(failed.liveConnectivity);
  });

  test("a refresh tick on a confirmed status keeps showing it while it refetches", () => {
    const model = {
      ...initModel(defaultSettings()),
      liveConnectivity: loadedLiveConnectivity(),
    };

    Story.story(
      withContext,
      Story.given(model),
      Story.message(TickedRefresh()),
      Story.Command.expectExact(FetchLiveConnectivity({ token: "abc123" })),
      Story.model((model) => {
        expect(connectionOf(model)).toBe("up");
      }),
      resolveFetchLiveConnectivity()
    );
  });

  test("refresh now on a status the last fetch could not confirm drops the stale value while it refetches", () => {
    const model = {
      ...initModel(defaultSettings()),
      liveConnectivity: LiveConnectivityAsyncData.Stale({
        error: "network error",
        data: { status: "up" as const, maybeLastSampleAtMs: Option.none() },
      }),
    };

    Story.story(
      withContext,
      Story.given(model),
      Story.message(ClickedRefreshNow()),
      Story.model((model) => {
        expect(model.liveConnectivity._tag).toBe("Loading");
        expect(connectionOf(model)).not.toBe("up");
      }),
      Story.Command.expectHas(FetchLiveConnectivity({ token: "abc123" })),
      Story.Command.resolveAll(
        [FetchMetrics, succeededFetchMetrics()],
        [FetchSpeedtestHistory, succeededFetchSpeedtestHistory()],
        [
          FetchConnectivityStatus,
          SucceededFetchConnectivityStatus({
            request: DEFAULT_REQUEST,
            points: [],
            maybeUptimePercentage: Option.some(100),
            maybeAvailabilityPercentage: Option.some(100),
            coveragePercentage: 100,
            startTimeMs: 0,
            endTimeMs: 3_600_000,
            granularity: "1m",
          }),
        ]
      ),
      resolveFetchLiveConnectivity(),
      resolveFetchEarliestData(),
      resolveEnterInsights()
    );
  });

  test("a successful fetch settles the live status into Success", () => {
    const model = {
      ...initModel(defaultSettings()),
      liveConnectivity: LiveConnectivityAsyncData.Loading(),
    };
    const sampleAtMs = Date.parse("2026-07-28T11:59:30.000Z");

    Story.story(
      withContext,
      Story.given(model),
      Story.message(
        SucceededFetchLiveConnectivity({
          status: "degraded",
          maybeLastSampleAtMs: Option.some(sampleAtMs),
        })
      ),
      Story.model((model) => {
        expect(model.liveConnectivity).toEqual(
          LiveConnectivityAsyncData.Success({
            data: {
              status: "degraded",
              maybeLastSampleAtMs: Option.some(sampleAtMs),
            },
          })
        );
      })
    );
  });

  test("a failed cold fetch becomes a bare Failure", () => {
    const model = {
      ...initModel(defaultSettings()),
      liveConnectivity: LiveConnectivityAsyncData.Loading(),
    };

    Story.story(
      withContext,
      Story.given(model),
      Story.message(FailedFetchLiveConnectivity({ error: "network error" })),
      Story.Command.expectNone(),
      Story.model((model) => {
        expect(model.liveConnectivity).toEqual(
          LiveConnectivityAsyncData.Failure({ error: "network error" })
        );
      })
    );
  });

  // The live indicator answers "right now", so applying a range must leave it
  // completely alone — no refetch, not even a new object identity.
  test("applying a date range neither refetches nor touches the live status", () => {
    const model = {
      ...initModel(defaultSettings()),
      metrics: MetricsAsyncData.Success({ data: [] }),
      speedtestHistory: SpeedtestHistoryAsyncData.Success({ data: [] }),
      connectivityStatus: ConnectivityStatusAsyncData.Success({
        data: {
          points: [],
          maybeUptimePercentage: Option.some(100),
          maybeAvailabilityPercentage: Option.some(100),
          coveragePercentage: 100,
          startTimeMs: 0,
          endTimeMs: 3_600_000,
          granularity: "1m",
          request: DEFAULT_REQUEST,
        },
      }),
      liveConnectivity: loadedLiveConnectivity(),
    };
    const appliedRange = Preset({ preset: "last7d" });

    const { model: afterPreset } = withContext(
      model,
      GotDateRangePickerMessage({
        message: ClickedPreset({ preset: "last7d" }),
      })
    );
    const { model: afterApply, commands = [] } = withContext(
      afterPreset,
      GotDateRangePickerMessage({ message: ClickedApply() })
    );

    expect(afterApply.dateRange).toEqual(appliedRange);
    expect(commands.map((command) => command.name)).not.toContain(
      "FetchLiveConnectivity"
    );
    expect(afterApply.liveConnectivity).toBe(model.liveConnectivity);
  });
});

describe("dashboard update — date range", () => {
  test("applying a new date range forces a fresh load of all three series", () => {
    const model = {
      ...initModel(defaultSettings()),
      metrics: MetricsAsyncData.Success({ data: [] }),
      speedtestHistory: SpeedtestHistoryAsyncData.Success({ data: [] }),
      connectivityStatus: ConnectivityStatusAsyncData.Success({
        data: {
          points: [],
          maybeUptimePercentage: Option.some(100),
          maybeAvailabilityPercentage: Option.some(100),
          coveragePercentage: 100,
          startTimeMs: 0,
          endTimeMs: 3_600_000,
          granularity: "1m",
          request: DEFAULT_REQUEST,
        },
      }),
    };
    const appliedRange = Preset({ preset: "last7d" });

    Story.story(
      withContext,
      Story.given(model),
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
      Story.Command.expectHas(
        SaveSettings({
          settings: {
            theme: "system",
            dateRange: appliedRange,
            isPaused: false,
            latencyView: "all",
          },
        })
      ),
      Story.Command.resolveAll(
        [FetchMetrics, succeededFetchMetrics()],
        [FetchSpeedtestHistory, succeededFetchSpeedtestHistory()],
        [
          FetchConnectivityStatus,
          SucceededFetchConnectivityStatus({
            request: DEFAULT_REQUEST,
            points: [],
            maybeUptimePercentage: Option.some(100),
            maybeAvailabilityPercentage: Option.some(100),
            coveragePercentage: 100,
            startTimeMs: 0,
            endTimeMs: 3_600_000,
            granularity: "1m",
          }),
        ],
        [SaveSettings, CompletedSaveSettings()]
      ),
      resolveRangeInsights()
    );
  });
});

describe("dashboard update — date range with no prior data", () => {
  test("fields with no cached data go to Loading rather than Refreshing", () => {
    const appliedRange = Preset({ preset: "last7d" });

    Story.story(
      withContext,
      Story.given(initModel(defaultSettings())),
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
            request: DEFAULT_REQUEST,
            points: [],
            maybeUptimePercentage: Option.some(100),
            maybeAvailabilityPercentage: Option.some(100),
            coveragePercentage: 100,
            startTimeMs: 0,
            endTimeMs: 3_600_000,
            granularity: "1m",
          }),
        ],
        [SaveSettings, CompletedSaveSettings()]
      ),
      resolveRangeInsights()
    );
  });
});

describe("dashboard update — manual refresh", () => {
  test("clicking refresh now force-reloads every series without changing the date range", () => {
    const currentRange = Preset({ preset: "last7d" });
    const model = {
      ...initModel(defaultSettings()),
      dateRange: currentRange,
      metrics: MetricsAsyncData.Success({ data: [] }),
      speedtestHistory: SpeedtestHistoryAsyncData.Success({ data: [] }),
      connectivityStatus: ConnectivityStatusAsyncData.Success({
        data: {
          points: [],
          maybeUptimePercentage: Option.some(100),
          maybeAvailabilityPercentage: Option.some(100),
          coveragePercentage: 100,
          startTimeMs: 0,
          endTimeMs: 3_600_000,
          granularity: "1m",
          request: DEFAULT_REQUEST,
        },
      }),
      liveConnectivity: loadedLiveConnectivity(),
    };

    Story.story(
      withContext,
      Story.given(model),
      Story.message(ClickedRefreshNow()),
      Story.model((model) => {
        expect(model.dateRange).toEqual(currentRange);
        expect(model.metrics._tag).toBe("Refreshing");
        expect(model.speedtestHistory._tag).toBe("Refreshing");
        expect(model.connectivityStatus._tag).toBe("Refreshing");
        expect(model.liveConnectivity._tag).toBe("Refreshing");
      }),
      Story.Command.expectHas(FetchLiveConnectivity({ token: "abc123" })),
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
            request: DEFAULT_REQUEST,
            points: [],
            maybeUptimePercentage: Option.some(100),
            maybeAvailabilityPercentage: Option.some(100),
            coveragePercentage: 100,
            startTimeMs: 0,
            endTimeMs: 3_600_000,
            granularity: "1m",
          }),
        ]
      ),
      resolveFetchLiveConnectivity(),
      resolveFetchEarliestData(),
      resolveEnterInsights()
    );
  });
});

describe("dashboard update — pause toggle", () => {
  test("toggling pause flips isPaused and persists it", () => {
    Story.story(
      withContext,
      Story.given(initModel(defaultSettings())),
      Story.message(ClickedTogglePause()),
      Story.model((model) => {
        expect(model.isPaused).toBe(true);
      }),
      Story.Command.expectHas(
        SaveSettings({
          settings: {
            theme: "system",
            dateRange: DEFAULT_DATE_RANGE,
            isPaused: true,
            latencyView: "all",
          },
        })
      ),
      Story.Command.resolve(SaveSettings, CompletedSaveSettings())
    );
  });
});

describe("dashboard update — idle detection", () => {
  test("going idle sets isIdle without touching isPaused", () => {
    Story.story(
      withContext,
      Story.given(initModel(defaultSettings())),
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
      Story.given({
        ...initModel(defaultSettings()),
        isIdle: true,
        isPaused: true,
      }),
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
      Story.given(initModel(defaultSettings())),
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
      Story.given({
        ...initModel(defaultSettings()),
        hoveredSegmentIndex: Option.some(3),
      }),
      Story.message(UnhoveredConnectivitySegment()),
      Story.Command.expectNone(),
      Story.model((model) => {
        expect(model.hoveredSegmentIndex).toEqual(Option.none());
      })
    );
  });
});

describe("dashboard update: connectivity segment selection", () => {
  const HOUR_MS = 3_600_000;
  const WINDOW_START_MS = Date.UTC(2026, 9, 11, 10);
  const statusOver = (startTimeMs: number, hours: number) =>
    ConnectivityStatusAsyncData.Success({
      data: {
        points: [],
        maybeUptimePercentage: Option.none(),
        maybeAvailabilityPercentage: Option.none(),
        coveragePercentage: 100,
        startTimeMs,
        endTimeMs: startTimeMs + hours * HOUR_MS,
        granularity: "1h",
        request: DEFAULT_REQUEST,
      },
    });
  const bucket = (index: number) => WINDOW_START_MS + index * HOUR_MS;
  const base = {
    ...initModel(defaultSettings()),
    connectivityStatus: statusOver(WINDOW_START_MS, 10),
  };
  const selected = (index: number) => ({
    ...base,
    maybeSelectedBucketStartMs: Option.some(bucket(index)),
  });
  const pressed = (
    model: ReturnType<typeof initModel>,
    key: string
  ): ReturnType<typeof initModel> =>
    withContext(model, PressedRibbonKey({ key })).model;

  test("toggling a segment pins the bucket it starts", () => {
    const { model } = withContext(
      base,
      ToggledConnectivitySegment({ startMs: bucket(3) })
    );

    expect(model.maybeSelectedBucketStartMs).toEqual(Option.some(bucket(3)));
  });

  test("toggling the pinned segment again unpins it", () => {
    const { model } = withContext(
      selected(3),
      ToggledConnectivitySegment({ startMs: bucket(3) })
    );

    expect(model.maybeSelectedBucketStartMs).toEqual(Option.none());
  });

  test("toggling another segment moves the pin", () => {
    const { model } = withContext(
      selected(3),
      ToggledConnectivitySegment({ startMs: bucket(5) })
    );

    expect(model.maybeSelectedBucketStartMs).toEqual(Option.some(bucket(5)));
  });

  test("clearing the selection drops the pin and leaves the hover alone", () => {
    const { model } = withContext(
      { ...selected(3), hoveredSegmentIndex: Option.some(4) },
      ClearedConnectivitySelection()
    );

    expect(model.maybeSelectedBucketStartMs).toEqual(Option.none());
    expect(model.hoveredSegmentIndex).toEqual(Option.some(4));
  });

  test("the arrow keys move the pin along the cells and Escape drops it", () => {
    const afterRight = pressed(selected(3), "ArrowRight");
    expect(afterRight.maybeSelectedBucketStartMs).toEqual(
      Option.some(bucket(4))
    );

    const afterEnd = pressed(afterRight, "End");
    expect(afterEnd.maybeSelectedBucketStartMs).toEqual(Option.some(bucket(9)));

    const afterEscape = pressed(afterEnd, "Escape");
    expect(afterEscape.maybeSelectedBucketStartMs).toEqual(Option.none());
  });

  test("Home moves the pin to the first cell", () => {
    expect(pressed(selected(5), "Home").maybeSelectedBucketStartMs).toEqual(
      Option.some(bucket(0))
    );
  });

  test("arrow keys do not move through a window fetched for another range", () => {
    const otherRange = {
      ...selected(3),
      dateRange: Preset({ preset: "last24h" }),
    };

    expect(
      pressed(otherRange, "ArrowRight").maybeSelectedBucketStartMs
    ).toEqual(Option.some(bucket(3)));
  });

  test("the first arrow press with nothing pinned starts at the matching end", () => {
    expect(pressed(base, "ArrowRight").maybeSelectedBucketStartMs).toEqual(
      Option.some(bucket(0))
    );
    expect(pressed(base, "ArrowLeft").maybeSelectedBucketStartMs).toEqual(
      Option.some(bucket(9))
    );
  });

  test("a key the ribbon does not use leaves the pin alone", () => {
    expect(pressed(selected(3), "Tab").maybeSelectedBucketStartMs).toEqual(
      Option.some(bucket(3))
    );
  });

  test("arrow keys do nothing before the ribbon's window is known", () => {
    const loading = {
      ...initModel(defaultSettings()),
      maybeSelectedBucketStartMs: Option.some(bucket(3)),
    };

    expect(pressed(loading, "ArrowRight").maybeSelectedBucketStartMs).toEqual(
      Option.some(bucket(3))
    );
  });

  test("a pin stays on its bucket when a refresh slides the window", () => {
    const { model } = withContext(
      selected(3),
      SucceededFetchConnectivityStatus({
        request: DEFAULT_REQUEST,
        points: [],
        maybeUptimePercentage: Option.none(),
        maybeAvailabilityPercentage: Option.none(),
        coveragePercentage: 100,
        startTimeMs: bucket(1),
        endTimeMs: bucket(11),
        granularity: "1h",
      })
    );

    expect(model.maybeSelectedBucketStartMs).toEqual(Option.some(bucket(3)));
    expect(pressed(model, "ArrowRight").maybeSelectedBucketStartMs).toEqual(
      Option.some(bucket(4))
    );
  });

  test("the first arrow press after the pinned bucket slid out of the window starts at the matching end", () => {
    const slidPast = {
      ...selected(0),
      connectivityStatus: statusOver(bucket(2), 10),
    };

    expect(pressed(slidPast, "ArrowRight").maybeSelectedBucketStartMs).toEqual(
      Option.some(bucket(2))
    );
  });

  test("changing the range drops the pin, since its bucket belongs to the old window", () => {
    const { model } = withContext(
      { ...selected(3), hoveredSegmentIndex: Option.some(4) },
      SelectedQuickRange({ preset: "last24h" })
    );

    expect(model.maybeSelectedBucketStartMs).toEqual(Option.none());
    expect(model.hoveredSegmentIndex).toEqual(Option.none());
  });
});

describe("dashboard update: ribbon width", () => {
  test("starts unmeasured", () => {
    expect(initModel(defaultSettings()).maybeRibbonWidthPx).toEqual(
      Option.none()
    );
  });

  test("keeps the width the ribbon reports", () => {
    const { model, commands } = withContext(
      initModel(defaultSettings()),
      MeasuredRibbon({ widthPx: 560 })
    );

    expect(model.maybeRibbonWidthPx).toEqual(Option.some(560));
    expect(commands).toBeUndefined();
  });

  test("replaces an earlier width when the ribbon is resized", () => {
    const { model } = withContext(
      {
        ...initModel(defaultSettings()),
        maybeRibbonWidthPx: Option.some(560),
      },
      MeasuredRibbon({ widthPx: 800 })
    );

    expect(model.maybeRibbonWidthPx).toEqual(Option.some(800));
  });
});

describe("dashboard update — toast messages", () => {
  const modelWithToast = () => {
    const { model: toast } = Toast.show(initModel(defaultSettings()).toast, {
      variant: "Info",
      payload: { title: "Speed test complete", description: "all good" },
    });
    return { ...initModel(defaultSettings()), toast };
  };

  test("a toast message is delegated to the toast submodel", () => {
    Story.story(
      withContext,
      Story.given(modelWithToast()),
      Story.message(
        GotToastMessage({
          message: UiToast.Message.HoveredEntry({
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
        message: UiToast.Message.HoveredEntry({
          entryId: "dashboard-toast-entry-0",
        }),
      })
    ).model;

    const { model, commands = [] } = withContext(
      hovered,
      GotToastMessage({
        message: UiToast.Message.LeftEntry({
          entryId: "dashboard-toast-entry-0",
        }),
      })
    );

    expect(model.toast.entries[0]?.isHovered).toBe(false);
    expect(commands.map((command) => command.name)).toEqual([
      "WaitBeforeDismissal",
    ]);
  });
});

const mountedChartsModel = () => ({
  ...withLoadedWindows(initModel(defaultSettings())),
  metrics: MetricsAsyncData.Success({ data: [] }),
  speedtestHistory: SpeedtestHistoryAsyncData.Success({ data: [] }),
  maybeLatencyChartHostId: Option.some("latency-chart"),
  maybePacketLossChartHostId: Option.some("packet-loss-chart"),
  maybeJitterChartHostId: Option.some("jitter-chart"),
  maybeSpeedChartHostId: Option.some("speed-chart"),
});

const expectEveryChartResynced = () => [
  Story.Command.expectHas(
    SyncLatencyChart({
      hostId: "latency-chart",
      metrics: [],
      ...METRICS_WINDOW,
      hostSeries: [],
      incidents: [],
    })
  ),
  Story.Command.expectHas(
    SyncPacketLossChart({
      hostId: "packet-loss-chart",
      metrics: [],
      ...METRICS_WINDOW,
      incidents: [],
    })
  ),
  Story.Command.expectHas(
    SyncJitterChart({
      hostId: "jitter-chart",
      metrics: [],
      ...METRICS_WINDOW,
      incidents: [],
    })
  ),
  Story.Command.expectHas(
    SyncSpeedChart({
      hostId: "speed-chart",
      metrics: [],
      ...SPEEDTEST_WINDOW,
    })
  ),
];

const selectLatencyView = (view: LatencyView) =>
  GotLatencyViewMessage({
    message: RadioGroup.Message.SelectedOption({
      index: LATENCY_VIEWS.indexOf(view),
      value: view,
    }),
  });

const selectMenuItem = (item: MenuItem) =>
  GotMenuMessage({
    message: Menu.Message.SelectedItem({
      index: MENU_ITEMS.indexOf(item),
      item,
    }),
  });

describe("dashboard update: theme preference", () => {
  test.each([
    ["ThemeDark", "dark"],
    ["ThemeLight", "light"],
    ["ThemeSystem", "system"],
  ] as const)(
    "choosing %s from the menu applies and saves %s, then re-syncs every mounted chart",
    (item, preference) => {
      const model = {
        ...mountedChartsModel(),
        theme: preference === "light" ? ("dark" as const) : ("light" as const),
      };

      Story.story(
        withContext,
        Story.given(model),
        Story.message(selectMenuItem(item)),
        Story.model((updatedModel) => {
          expect(updatedModel.theme).toBe(preference);
          expect(updatedModel.menu.isOpen).toBe(false);
        }),
        Story.Command.expectHas(ApplyTheme({ theme: preference })),
        Story.Command.expectHas(
          SaveSettings({
            settings: {
              theme: preference,
              dateRange: DEFAULT_DATE_RANGE,
              isPaused: false,
              latencyView: "all",
            },
          })
        ),
        ...expectEveryChartResynced(),
        Story.Command.resolveAll(
          [ApplyTheme, CompletedApplyTheme()],
          [SaveSettings, CompletedSaveSettings()],
          [SyncLatencyChart, CompletedSyncLatencyChart()],
          [SyncPacketLossChart, CompletedSyncPacketLossChart()],
          [SyncJitterChart, CompletedSyncJitterChart()],
          [SyncSpeedChart, CompletedSyncSpeedChart()]
        ),
        Story.expectNoOutMessage()
      );
    }
  );

  test("an OS theme change on the system preference re-applies the theme and re-syncs the charts, without saving", () => {
    Story.story(
      withContext,
      Story.given({ ...mountedChartsModel(), theme: "system" as const }),
      Story.message(ChangedSystemTheme()),
      Story.Command.expectHas(ApplyTheme({ theme: "system" })),
      ...expectEveryChartResynced(),
      Story.Command.resolveAll(
        [ApplyTheme, CompletedApplyTheme()],
        [SyncLatencyChart, CompletedSyncLatencyChart()],
        [SyncPacketLossChart, CompletedSyncPacketLossChart()],
        [SyncJitterChart, CompletedSyncJitterChart()],
        [SyncSpeedChart, CompletedSyncSpeedChart()]
      )
    );
  });

  test.each(["light", "dark"] as const)(
    "an OS theme change is ignored under an explicit %s choice",
    (theme) => {
      Story.story(
        withContext,
        Story.given({ ...mountedChartsModel(), theme }),
        Story.message(ChangedSystemTheme()),
        Story.Command.expectNone(),
        Story.model((updatedModel) => {
          expect(updatedModel.theme).toBe(theme);
        })
      );
    }
  );

  test("entering the dashboard re-asserts the stored preference onto <html>", () => {
    const { commands = [] } = withContext(
      { ...initModel(defaultSettings()), theme: "system" },
      EnteredDashboard()
    );

    expect(commands.map((command) => command.name)).toContain("ApplyTheme");
    expect(commands).toContainEqual(
      expect.objectContaining({ name: "ApplyTheme", args: { theme: "system" } })
    );
  });
});

describe("dashboard update: overflow menu", () => {
  test("choosing Run speed test starts the speed test like the card button does", () => {
    Story.story(
      withContext,
      Story.given(initModel(defaultSettings())),
      Story.message(selectMenuItem("RunSpeedTest")),
      Story.model((updatedModel) => {
        expect(AsyncData.isLoading(updatedModel.speedtestTrigger)).toBe(true);
        expect(updatedModel.menu.isOpen).toBe(false);
      }),
      Story.Command.expectHas(TriggerSpeedtest({ token: "abc123" })),
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
      ToastTest.drainEntry({ entryId: "dashboard-toast-entry-0" }),
      resolveSummaryFetch()
    );
  });

  test("choosing Log out asks the parent to log out, leaving the dashboard model as it was", () => {
    const model = initModel(defaultSettings());

    Story.story(
      withContext,
      Story.given(model),
      Story.message(selectMenuItem("Logout")),
      Story.expectOutMessage(RequestedLogout()),
      Story.model((updatedModel) => {
        expect(updatedModel.theme).toBe(model.theme);
        expect(updatedModel.dateRange).toEqual(model.dateRange);
      })
    );
  });

  test("opening the menu emits no OutMessage", () => {
    const { model: opened, outMessage } = withContext(
      initModel(defaultSettings()),
      GotMenuMessage({
        message: Menu.Message.Opened({ maybeActiveItemIndex: Option.none() }),
      })
    );

    expect(opened.menu.isOpen).toBe(true);
    expect(outMessage).toBeUndefined();
  });
});

describe("dashboard update: quick range", () => {
  test("picking a quick range applies it, reloads the range-bound data and saves it", () => {
    Story.story(
      withContext,
      Story.given({
        ...initModel(defaultSettings()),
        maybeEarliestDataMs: Option.some(0),
      }),
      Story.message(SelectedQuickRange({ preset: "last24h" })),
      Story.model((updatedModel) => {
        expect(updatedModel.dateRange).toEqual(Preset({ preset: "last24h" }));
      }),
      Story.Command.expectHas(
        FetchMetrics({
          token: "abc123",
          dateRange: Preset({ preset: "last24h" }),
          maybeEarliestDataMs: Option.some(0),
        })
      ),
      Story.Command.expectHas(
        FetchSpeedtestHistory({
          token: "abc123",
          dateRange: Preset({ preset: "last24h" }),
          maybeEarliestDataMs: Option.some(0),
        })
      ),
      Story.Command.expectHas(
        FetchConnectivityStatus({
          token: "abc123",
          dateRange: Preset({ preset: "last24h" }),
          maybeEarliestDataMs: Option.some(0),
        })
      ),
      Story.Command.expectHas(
        SaveSettings({
          settings: {
            theme: "system",
            dateRange: Preset({ preset: "last24h" }),
            isPaused: false,
            latencyView: "all",
          },
        })
      ),
      Story.Command.resolveAll(
        [FetchMetrics, succeededFetchMetrics()],
        [FetchSpeedtestHistory, succeededFetchSpeedtestHistory()],
        [
          FetchConnectivityStatus,
          FailedFetchConnectivityStatus({
            error: "skip",
            request: DEFAULT_REQUEST,
          }),
        ],
        [SaveSettings, CompletedSaveSettings()]
      ),
      resolveRangeInsights()
    );
  });

  test("never reloads the live indicator, which no range can change", () => {
    const { commands = [] } = withContext(
      initModel(defaultSettings()),
      SelectedQuickRange({ preset: "last1h" })
    );

    expect(commands.map((command) => command.name)).not.toContain(
      "FetchLiveConnectivity"
    );
  });
});

describe("dashboard update — speedtest trigger", () => {
  test("clicking trigger dispatches TriggerSpeedtest and moves to Loading", () => {
    Story.story(
      withContext,
      Story.given(initModel(defaultSettings())),
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
      ToastTest.drainEntry({ entryId: "dashboard-toast-entry-0" }),
      resolveSummaryFetch()
    );
  });

  test("a successful trigger settles speedtestTrigger and refetches metrics + speedtest history", () => {
    const model = {
      ...initModel(defaultSettings()),
      speedtestTrigger: SpeedtestTriggerAsyncData.Loading(),
    };

    Story.story(
      withContext,
      Story.given(model),
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
      Story.Command.expectHas(
        FetchSummary({
          token: "abc123",
          dateRange: DEFAULT_DATE_RANGE,
          maybeEarliestDataMs: Option.none(),
        })
      ),
      Story.Command.resolveAll(
        [FetchMetrics, succeededFetchMetrics()],
        [FetchSpeedtestHistory, succeededFetchSpeedtestHistory()]
      ),
      resolveSummaryFetch(),
      ToastTest.drainEntry({ entryId: "dashboard-toast-entry-0" })
    );
  });

  test("a successful trigger moves loaded cards to Refreshing so they show a refetch is running", () => {
    const { model } = withContext(
      {
        ...initModel(defaultSettings()),
        ...loadedInsights(),
        metrics: MetricsAsyncData.Success({ data: [] }),
        speedtestHistory: SpeedtestHistoryAsyncData.Success({ data: [] }),
      },
      SucceededTriggerSpeedtest({
        downloadMbps: 500,
        uploadMbps: 50,
        pingMs: 8,
      })
    );

    expect(model.metrics._tag).toBe("Refreshing");
    expect(model.speedtestHistory._tag).toBe("Refreshing");
    expect(model.summary._tag).toBe("Refreshing");
  });

  test("a successful trigger reloads cards whose last load failed", () => {
    const failed = { error: "Request failed" };
    const { model, commands = [] } = withContext(
      {
        ...initModel(defaultSettings()),
        metrics: MetricsAsyncData.Failure(failed),
        speedtestHistory: SpeedtestHistoryAsyncData.Failure(failed),
      },
      SucceededTriggerSpeedtest({
        downloadMbps: 500,
        uploadMbps: 50,
        pingMs: 8,
      })
    );

    expect(model.metrics._tag).toBe("Loading");
    expect(model.speedtestHistory._tag).toBe("Loading");
    expect(commands.map(({ name }) => name)).toEqual(
      expect.arrayContaining(["FetchMetrics", "FetchSpeedtestHistory"])
    );
  });

  test("a successful trigger that took no upload reading says so rather than reporting 0 Mbps", () => {
    const model = {
      ...initModel(defaultSettings()),
      speedtestTrigger: SpeedtestTriggerAsyncData.Loading(),
    };

    Story.story(
      withContext,
      Story.given(model),
      Story.message(SucceededTriggerSpeedtest({ downloadMbps: 500 })),
      Story.model((model) => {
        expect(model.toast.entries[0]?.payload.description).toBe(
          "500 Mbps down, no upload reading"
        );
      }),
      Story.Command.resolveAll(
        [FetchMetrics, succeededFetchMetrics()],
        [FetchSpeedtestHistory, succeededFetchSpeedtestHistory()]
      ),
      resolveSummaryFetch(),
      ToastTest.drainEntry({ entryId: "dashboard-toast-entry-0" })
    );
  });

  test("a successful trigger toasts its speeds the way the last-test label states them", () => {
    const model = {
      ...initModel(defaultSettings()),
      speedtestTrigger: SpeedtestTriggerAsyncData.Loading(),
    };

    Story.story(
      withContext,
      Story.given(model),
      Story.message(
        SucceededTriggerSpeedtest({ downloadMbps: 512.4, uploadMbps: 42.5 })
      ),
      Story.model((model) => {
        expect(model.toast.entries[0]?.payload.description).toBe(
          "512 Mbps down, 42.5 Mbps up"
        );
      }),
      Story.Command.resolveAll(
        [FetchMetrics, succeededFetchMetrics()],
        [FetchSpeedtestHistory, succeededFetchSpeedtestHistory()]
      ),
      resolveSummaryFetch(),
      ToastTest.drainEntry({ entryId: "dashboard-toast-entry-0" })
    );
  });

  test("a failed trigger settles speedtestTrigger to Failure without refetching", () => {
    const model = {
      ...initModel(defaultSettings()),
      speedtestTrigger: SpeedtestTriggerAsyncData.Loading(),
    };

    Story.story(
      withContext,
      Story.given(model),
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
      Story.given(initModel(defaultSettings())),
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
      ...withLoadedWindows(initModel(defaultSettings())),
      metrics: MetricsAsyncData.Success({ data: [] }),
    };

    Story.story(
      withContext,
      Story.given(model),
      Story.message(SucceededMountLatencyChart({ hostId: "latency-chart" })),
      Story.Command.expectExact(
        SyncLatencyChart({
          hostId: "latency-chart",
          metrics: [],
          ...METRICS_WINDOW,
          hostSeries: [],
          incidents: [],
        })
      ),
      Story.Command.resolve(SyncLatencyChart, CompletedSyncLatencyChart())
    );
  });

  test("a successful metrics fetch syncs the chart when it's already mounted", () => {
    const model = {
      ...initModel(defaultSettings()),
      metrics: MetricsAsyncData.Loading(),
      maybeLatencyChartHostId: Option.some("latency-chart"),
    };

    Story.story(
      withContext,
      Story.given(model),
      Story.message(succeededFetchMetrics()),
      Story.Command.expectExact(
        SyncLatencyChart({
          hostId: "latency-chart",
          metrics: [],
          ...METRICS_WINDOW,
          hostSeries: [],
          incidents: [],
        })
      ),
      Story.Command.resolve(SyncLatencyChart, CompletedSyncLatencyChart())
    );
  });

  test("a successful metrics fetch dispatches nothing when the chart isn't mounted", () => {
    Story.story(
      withContext,
      Story.given({
        ...initModel(defaultSettings()),
        metrics: MetricsAsyncData.Loading(),
      }),
      Story.message(succeededFetchMetrics()),
      Story.Command.expectNone()
    );
  });

  test("a failed mount is a no-op acknowledgment", () => {
    Story.story(
      withContext,
      Story.given(initModel(defaultSettings())),
      Story.message(FailedMountLatencyChart({ reason: "no host element" })),
      Story.Command.expectNone()
    );
  });

  test("CompletedSyncLatencyChart and FailedSyncLatencyChart are no-op acknowledgments", () => {
    Story.story(
      withContext,
      Story.given(initModel(defaultSettings())),
      Story.message(CompletedSyncLatencyChart()),
      Story.Command.expectNone()
    );
    Story.story(
      withContext,
      Story.given(initModel(defaultSettings())),
      Story.message(FailedSyncLatencyChart({ reason: "chart disposed" })),
      Story.Command.expectNone()
    );
  });
});

describe("dashboard update — packet loss chart", () => {
  test("mounting once metrics are already loaded immediately syncs the chart", () => {
    const model = {
      ...withLoadedWindows(initModel(defaultSettings())),
      metrics: MetricsAsyncData.Success({ data: [] }),
    };

    Story.story(
      withContext,
      Story.given(model),
      Story.message(
        SucceededMountPacketLossChart({ hostId: "packet-loss-chart" })
      ),
      Story.Command.expectExact(
        SyncPacketLossChart({
          hostId: "packet-loss-chart",
          metrics: [],
          ...METRICS_WINDOW,
          incidents: [],
        })
      ),
      Story.Command.resolve(SyncPacketLossChart, CompletedSyncPacketLossChart())
    );
  });

  test("a successful metrics fetch syncs the chart when it's already mounted", () => {
    const model = {
      ...initModel(defaultSettings()),
      metrics: MetricsAsyncData.Loading(),
      maybePacketLossChartHostId: Option.some("packet-loss-chart"),
    };

    Story.story(
      withContext,
      Story.given(model),
      Story.message(succeededFetchMetrics()),
      Story.Command.expectExact(
        SyncPacketLossChart({
          hostId: "packet-loss-chart",
          metrics: [],
          ...METRICS_WINDOW,
          incidents: [],
        })
      ),
      Story.Command.resolve(SyncPacketLossChart, CompletedSyncPacketLossChart())
    );
  });

  test("a failed mount and failed/completed sync are no-op acknowledgments", () => {
    Story.story(
      withContext,
      Story.given(initModel(defaultSettings())),
      Story.message(FailedMountPacketLossChart({ reason: "no host element" })),
      Story.Command.expectNone()
    );
    Story.story(
      withContext,
      Story.given(initModel(defaultSettings())),
      Story.message(CompletedSyncPacketLossChart()),
      Story.Command.expectNone()
    );
    Story.story(
      withContext,
      Story.given(initModel(defaultSettings())),
      Story.message(FailedSyncPacketLossChart({ reason: "chart disposed" })),
      Story.Command.expectNone()
    );
  });
});

describe("dashboard update — jitter chart", () => {
  test("mounting once metrics are already loaded immediately syncs the chart", () => {
    const model = {
      ...withLoadedWindows(initModel(defaultSettings())),
      metrics: MetricsAsyncData.Success({ data: [] }),
    };

    Story.story(
      withContext,
      Story.given(model),
      Story.message(SucceededMountJitterChart({ hostId: "jitter-chart" })),
      Story.Command.expectExact(
        SyncJitterChart({
          hostId: "jitter-chart",
          metrics: [],
          ...METRICS_WINDOW,
          incidents: [],
        })
      ),
      Story.Command.resolve(SyncJitterChart, CompletedSyncJitterChart())
    );
  });

  test("a successful metrics fetch syncs the chart when it's already mounted", () => {
    const model = {
      ...initModel(defaultSettings()),
      metrics: MetricsAsyncData.Loading(),
      maybeJitterChartHostId: Option.some("jitter-chart"),
    };

    Story.story(
      withContext,
      Story.given(model),
      Story.message(succeededFetchMetrics()),
      Story.Command.expectExact(
        SyncJitterChart({
          hostId: "jitter-chart",
          metrics: [],
          ...METRICS_WINDOW,
          incidents: [],
        })
      ),
      Story.Command.resolve(SyncJitterChart, CompletedSyncJitterChart())
    );
  });

  test("a failed mount and failed/completed sync are no-op acknowledgments", () => {
    Story.story(
      withContext,
      Story.given(initModel(defaultSettings())),
      Story.message(FailedMountJitterChart({ reason: "no host element" })),
      Story.Command.expectNone()
    );
    Story.story(
      withContext,
      Story.given(initModel(defaultSettings())),
      Story.message(CompletedSyncJitterChart()),
      Story.Command.expectNone()
    );
    Story.story(
      withContext,
      Story.given(initModel(defaultSettings())),
      Story.message(FailedSyncJitterChart({ reason: "chart disposed" })),
      Story.Command.expectNone()
    );
  });
});

describe("dashboard update — speed chart", () => {
  test("mounting once speed test history is already loaded immediately syncs the chart", () => {
    const model = {
      ...withLoadedWindows(initModel(defaultSettings())),
      speedtestHistory: SpeedtestHistoryAsyncData.Success({ data: [] }),
    };

    Story.story(
      withContext,
      Story.given(model),
      Story.message(SucceededMountSpeedChart({ hostId: "speed-chart" })),
      Story.Command.expectExact(
        SyncSpeedChart({
          hostId: "speed-chart",
          metrics: [],
          ...SPEEDTEST_WINDOW,
        })
      ),
      Story.Command.resolve(SyncSpeedChart, CompletedSyncSpeedChart())
    );
  });

  test("a successful speed test history fetch syncs the chart when it's already mounted", () => {
    const model = {
      ...initModel(defaultSettings()),
      speedtestHistory: SpeedtestHistoryAsyncData.Loading(),
      maybeSpeedChartHostId: Option.some("speed-chart"),
    };

    Story.story(
      withContext,
      Story.given(model),
      Story.message(succeededFetchSpeedtestHistory()),
      Story.Command.expectExact(
        SyncSpeedChart({
          hostId: "speed-chart",
          metrics: [],
          ...SPEEDTEST_WINDOW,
        })
      ),
      Story.Command.resolve(SyncSpeedChart, CompletedSyncSpeedChart())
    );
  });

  test("a successful fetch keeps the range the stored window answers", () => {
    const { model } = withContext(
      {
        ...initModel(defaultSettings()),
        speedtestHistory: SpeedtestHistoryAsyncData.Loading(),
      },
      succeededFetchSpeedtestHistory()
    );

    expect(model.maybeSpeedtestWindow).toEqual(
      Option.some({ ...SPEEDTEST_WINDOW, request: DEFAULT_REQUEST })
    );
  });

  test("a successful fetch dispatches nothing when the chart isn't mounted", () => {
    Story.story(
      withContext,
      Story.given({
        ...initModel(defaultSettings()),
        speedtestHistory: SpeedtestHistoryAsyncData.Loading(),
      }),
      Story.message(succeededFetchSpeedtestHistory()),
      Story.Command.expectNone()
    );
  });

  test("a failed mount and failed/completed sync are no-op acknowledgments", () => {
    Story.story(
      withContext,
      Story.given(initModel(defaultSettings())),
      Story.message(FailedMountSpeedChart({ reason: "no host element" })),
      Story.Command.expectNone()
    );
    Story.story(
      withContext,
      Story.given(initModel(defaultSettings())),
      Story.message(CompletedSyncSpeedChart()),
      Story.Command.expectNone()
    );
    Story.story(
      withContext,
      Story.given(initModel(defaultSettings())),
      Story.message(FailedSyncSpeedChart({ reason: "chart disposed" })),
      Story.Command.expectNone()
    );
  });
});

describe("dashboard update: responses for a replaced range", () => {
  const HOUR_MS = 60 * 60 * 1000;
  const EARLIEST_MS = Date.parse("2025-01-01T00:00:00.000Z");

  const requestFor = (
    preset: PresetKey,
    maybeEarliestDataMs = Option.none<number>()
  ): RangeRequest => ({ dateRange: Preset({ preset }), maybeEarliestDataMs });

  const metricsAnswering = (
    request: RangeRequest,
    startTimeMs: number
  ): Message =>
    SucceededFetchMetrics({
      request,
      metrics: [],
      nowMs: NOW_MS,
      startTimeMs,
      endTimeMs: NOW_MS,
      granularity: "1m",
    });
  const speedtestsAnswering = (
    request: RangeRequest,
    startTimeMs: number
  ): Message =>
    SucceededFetchSpeedtestHistory({
      request,
      history: [],
      startTimeMs,
      endTimeMs: NOW_MS,
    });
  const connectivityAnswering = (
    request: RangeRequest,
    startTimeMs: number
  ): Message =>
    SucceededFetchConnectivityStatus({
      request,
      points: [],
      maybeUptimePercentage: Option.some(100),
      maybeAvailabilityPercentage: Option.some(100),
      coveragePercentage: 100,
      startTimeMs,
      endTimeMs: NOW_MS,
      granularity: "1m",
    });

  const send = (model: Model, ...messages: ReadonlyArray<Message>): Model =>
    messages.reduce(
      (current, message) => update(current, message, context).model,
      model
    );

  const LAST_24H = requestFor("last24h");
  const LAST_1H = requestFor("last1h");
  const START_24H = NOW_MS - 24 * HOUR_MS;
  const START_1H = NOW_MS - HOUR_MS;

  const clickedBothRanges = () =>
    send(
      initModel(defaultSettings()),
      SelectedQuickRange({ preset: "last24h" }),
      SelectedQuickRange({ preset: "last1h" })
    );

  const answersFor = (request: RangeRequest, startTimeMs: number) => [
    metricsAnswering(request, startTimeMs),
    speedtestsAnswering(request, startTimeMs),
    connectivityAnswering(request, startTimeMs),
  ];

  const startsOf = (model: Model) => ({
    metrics: Option.map(model.maybeMetricsWindow, (w) => w.startTimeMs),
    speedtests: Option.map(model.maybeSpeedtestWindow, (w) => w.startTimeMs),
    connectivity: Option.map(
      AsyncData.getData(model.connectivityStatus),
      (status) => status.startTimeMs
    ),
  });

  test("a slow response for the previous range does not overwrite the current range's data", () => {
    const model = send(
      clickedBothRanges(),
      ...answersFor(LAST_1H, START_1H),
      ...answersFor(LAST_24H, START_24H)
    );

    expect(startsOf(model)).toEqual({
      metrics: Option.some(START_1H),
      speedtests: Option.some(START_1H),
      connectivity: Option.some(START_1H),
    });
  });

  test("a response for the previous range is dropped even when it arrives first", () => {
    const afterStale = send(
      clickedBothRanges(),
      ...answersFor(LAST_24H, START_24H)
    );

    expect(startsOf(afterStale)).toEqual({
      metrics: Option.none(),
      speedtests: Option.none(),
      connectivity: Option.none(),
    });
    expect(afterStale.metrics._tag).toBe("Loading");

    expect(
      startsOf(send(afterStale, ...answersFor(LAST_1H, START_1H)))
    ).toEqual({
      metrics: Option.some(START_1H),
      speedtests: Option.some(START_1H),
      connectivity: Option.some(START_1H),
    });
  });

  test("a failure for the previous range leaves the current range loading without an error", () => {
    const model = send(
      clickedBothRanges(),
      FailedFetchMetrics({ request: LAST_24H, error: "timeout" }),
      FailedFetchSpeedtestHistory({ request: LAST_24H, error: "timeout" }),
      FailedFetchConnectivityStatus({ request: LAST_24H, error: "timeout" })
    );

    expect(model.metrics._tag).toBe("Loading");
    expect(model.speedtestHistory._tag).toBe("Loading");
    expect(model.connectivityStatus._tag).toBe("Loading");
  });

  test("a failure answering the current range still settles the data", () => {
    const model = send(
      clickedBothRanges(),
      FailedFetchMetrics({ request: LAST_1H, error: "timeout" })
    );

    expect(model.metrics).toEqual(
      MetricsAsyncData.Failure({ error: "timeout" })
    );
  });

  test("an 'All time' response issued before the earliest datapoint was known is dropped", () => {
    const loadingAllTime = {
      ...initModel(defaultSettings()),
      dateRange: Preset({ preset: "allTime" }),
      maybeEarliestDataMs: Option.some(EARLIEST_MS),
      metrics: MetricsAsyncData.Refreshing({ data: [] }),
    };
    const epochWide = requestFor("allTime");
    const sinceEarliest = requestFor("allTime", Option.some(EARLIEST_MS));

    const afterEpochWide = send(loadingAllTime, metricsAnswering(epochWide, 0));
    expect(afterEpochWide.metrics._tag).toBe("Refreshing");
    expect(afterEpochWide.maybeMetricsWindow).toEqual(Option.none());

    const afterSinceEarliest = send(
      afterEpochWide,
      metricsAnswering(sinceEarliest, EARLIEST_MS)
    );
    expect(afterSinceEarliest.metrics._tag).toBe("Success");
    expect(afterSinceEarliest.maybeMetricsWindow).toEqual(
      Option.some({
        startTimeMs: EARLIEST_MS,
        endTimeMs: NOW_MS,
        granularity: "1m",
        request: sinceEarliest,
      })
    );
  });

  test("a rolling preset keeps accepting responses after the earliest datapoint resolves", () => {
    const model = send(
      {
        ...initModel(defaultSettings()),
        maybeEarliestDataMs: Option.some(EARLIEST_MS),
        metrics: MetricsAsyncData.Loading(),
      },
      succeededFetchMetrics()
    );

    expect(model.metrics._tag).toBe("Success");
  });
});

describe("dashboard update: insight fetches", () => {
  test("entering the dashboard starts all three insight fetches", () => {
    Story.story(
      withContext,
      Story.given(initModel(defaultSettings())),
      Story.message(EnteredDashboard()),
      Story.Command.expectHas(
        FetchSummary({
          token: "abc123",
          dateRange: DEFAULT_DATE_RANGE,
          maybeEarliestDataMs: Option.none(),
        })
      ),
      Story.Command.expectHas(
        FetchOutages({
          token: "abc123",
          dateRange: DEFAULT_DATE_RANGE,
          maybeEarliestDataMs: Option.none(),
        })
      ),
      Story.Command.expectHas(FetchPingHosts({ token: "abc123" })),
      Story.model((model) => {
        expect(model.summary._tag).toBe("Loading");
        expect(model.outages._tag).toBe("Loading");
        expect(model.pingHosts._tag).toBe("Loading");
      }),
      Story.Command.resolveAll(
        [FetchMetrics, succeededFetchMetrics()],
        [FetchSpeedtestHistory, succeededFetchSpeedtestHistory()],
        [
          FetchConnectivityStatus,
          FailedFetchConnectivityStatus({
            request: DEFAULT_REQUEST,
            error: "skip",
          }),
        ]
      ),
      resolveApplyTheme(),
      resolveFetchEarliestData(),
      resolveFetchLiveConnectivity(),
      resolveEnterInsights()
    );
  });

  test("a refresh tick revalidates the summary and outage data", () => {
    Story.story(
      withContext,
      Story.given({ ...initModel(defaultSettings()), ...loadedInsights() }),
      Story.message(TickedRefresh()),
      Story.model((model) => {
        expect(model.summary._tag).toBe("Refreshing");
        expect(model.outages._tag).toBe("Refreshing");
      }),
      Story.Command.resolveAll(
        [
          FetchSummary,
          FailedFetchSummary({ error: "skip", request: DEFAULT_REQUEST }),
        ],
        [
          FetchOutages,
          FailedFetchOutages({ error: "skip", request: DEFAULT_REQUEST }),
        ]
      )
    );
  });

  test("a refresh tick leaves the host list alone: it is static config", () => {
    const { model, commands = [] } = withContext(
      { ...initModel(defaultSettings()), ...loadedInsights() },
      TickedRefresh()
    );

    expect(model.pingHosts._tag).toBe("Success");
    expect(commands.map((command) => command.name)).not.toContain(
      "FetchPingHosts"
    );
  });

  test("a range change reloads the summary and outages but not hosts", () => {
    const { commands = [] } = withContext(
      { ...initModel(defaultSettings()), ...loadedInsights() },
      SelectedQuickRange({ preset: "last7d" })
    );
    const names = commands.map((command) => command.name);

    expect(names).toContain("FetchSummary");
    expect(names).toContain("FetchOutages");
    expect(names).not.toContain("FetchPingHosts");
  });

  test("refresh now reloads all three insight fetches", () => {
    const { commands = [] } = withContext(
      { ...initModel(defaultSettings()), ...loadedInsights() },
      ClickedRefreshNow()
    );

    expect(commands.map((command) => command.name)).toEqual(
      expect.arrayContaining(["FetchSummary", "FetchOutages", "FetchPingHosts"])
    );
  });

  test("settles each fetch into its own field, success or failure", () => {
    const model = {
      ...initModel(defaultSettings()),
      summary: SummaryAsyncData.Loading(),
      pingHosts: PingHostsAsyncData.Loading(),
    };

    const afterSummary = withContext(
      model,
      SucceededFetchSummary({
        summary: summaryResponse(),
        request: DEFAULT_REQUEST,
      })
    ).model;
    const afterHosts = withContext(
      afterSummary,
      SucceededFetchPingHosts({ hosts: hostsResponse() })
    ).model;

    expect(afterHosts.summary._tag).toBe("Success");
    expect(afterHosts.pingHosts._tag).toBe("Success");
    expect(
      withContext(
        model,
        FailedFetchSummary({ error: "db down", request: DEFAULT_REQUEST })
      ).model.summary
    ).toEqual(SummaryAsyncData.Failure({ error: "db down" }));
    expect(
      withContext(model, FailedFetchPingHosts({ error: "db down" })).model
        .pingHosts
    ).toEqual(PingHostsAsyncData.Failure({ error: "db down" }));
  });

  describe("outages", () => {
    const outage = {
      start: "2026-07-27T02:00:00.000Z",
      end: "2026-07-27T02:06:00.000Z",
      durationSeconds: 360,
      status: "down" as const,
      affectedHosts: ["1.1.1.1"],
      maxPacketLoss: 100,
      peakLatency: null,
    };
    const mounted = {
      ...withLoadedWindows(initModel(defaultSettings())),
      metrics: MetricsAsyncData.Success({ data: [] }),
      outages: OutagesAsyncData.Loading(),
      maybeLatencyChartHostId: Option.some("latency-chart"),
      maybePacketLossChartHostId: Option.some("packet-loss-chart"),
      maybeJitterChartHostId: Option.some("jitter-chart"),
    };

    test("settling the log keeps the clamp flag and repaints the quality charts with the incidents", () => {
      const incidents = [
        {
          ref: "A",
          startMs: Date.parse(outage.start),
          endMs: Date.parse(outage.end),
          status: "down" as const,
        },
      ];

      Story.story(
        withContext,
        Story.given(mounted),
        Story.message(
          SucceededFetchOutages({
            outages: outagesResponse([outage]),
            isClamped: true,
            fetchedAtMs: NOW_MS,
            request: DEFAULT_REQUEST,
          })
        ),
        Story.model((model) => {
          expect(model.outages).toEqual(
            OutagesAsyncData.Success({
              data: {
                log: outagesResponse([outage]),
                isClamped: true,
                fetchedAtMs: NOW_MS,
                request: DEFAULT_REQUEST,
              },
            })
          );
        }),
        Story.Command.expectHas(
          SyncLatencyChart({
            hostId: "latency-chart",
            metrics: [],
            ...METRICS_WINDOW,
            hostSeries: [],
            incidents,
          })
        ),
        Story.Command.expectHas(
          SyncPacketLossChart({
            hostId: "packet-loss-chart",
            metrics: [],
            ...METRICS_WINDOW,
            incidents,
          })
        ),
        Story.Command.expectHas(
          SyncJitterChart({
            hostId: "jitter-chart",
            metrics: [],
            ...METRICS_WINDOW,
            incidents,
          })
        ),
        Story.Command.resolveAll(
          [SyncLatencyChart, CompletedSyncLatencyChart()],
          [SyncPacketLossChart, CompletedSyncPacketLossChart()],
          [SyncJitterChart, CompletedSyncJitterChart()]
        )
      );
    });

    describe("while a refresh for a new range is in flight", () => {
      const previousRange = {
        dateRange: Preset({ preset: "last7d" }),
        maybeEarliestDataMs: Option.none<number>(),
      };
      const oldLog = (request: typeof previousRange) =>
        OutagesAsyncData.Refreshing({
          data: {
            log: outagesResponse([outage]),
            isClamped: false,
            fetchedAtMs: NOW_MS,
            request,
          },
        });
      const latencyIncidents = (
        commands: ReturnType<typeof withContext>["commands"]
      ) =>
        commands
          ?.filter((command) => command.name === "SyncLatencyChart")
          .map((command) => command.args);

      test("marks no incidents on the charts from the log of the previous range", () => {
        const { commands } = withContext(
          { ...mounted, outages: oldLog(previousRange) },
          succeededFetchMetrics()
        );

        expect(latencyIncidents(commands)).toEqual([
          expect.objectContaining({ incidents: [] }),
        ]);
      });

      test("keeps marking the incidents of a log that answers the selected range", () => {
        const { commands } = withContext(
          { ...mounted, outages: oldLog(DEFAULT_REQUEST) },
          succeededFetchMetrics()
        );

        expect(latencyIncidents(commands)).toEqual([
          expect.objectContaining({
            incidents: [expect.objectContaining({ ref: "A" })],
          }),
        ]);
      });
    });

    test("a failed fetch leaves the charts as they were", () => {
      const { model, commands } = withContext(
        mounted,
        FailedFetchOutages({ error: "db down", request: DEFAULT_REQUEST })
      );

      expect(model.outages).toEqual(
        OutagesAsyncData.Failure({ error: "db down" })
      );
      expect(commands).toBeUndefined();
    });
  });

  describe("results for a range the viewer has left", () => {
    const stale = {
      dateRange: Preset({ preset: "last30d" }),
      maybeEarliestDataMs: Option.none<number>(),
    };
    const current = {
      dateRange: Preset({ preset: "last1h" }),
      maybeEarliestDataMs: Option.none<number>(),
    };
    const onLastHour = {
      ...withLoadedWindows(initModel(defaultSettings())),
      dateRange: Preset({ preset: "last1h" }),
      metrics: MetricsAsyncData.Success({ data: [] }),
      summary: SummaryAsyncData.Loading(),
      outages: OutagesAsyncData.Loading(),
      maybeLatencyChartHostId: Option.some("latency-chart"),
    };

    test("a slow summary for the old range does not land under the new one", () => {
      const { model } = withContext(
        onLastHour,
        SucceededFetchSummary({ summary: summaryResponse(), request: stale })
      );

      expect(model.summary).toEqual(SummaryAsyncData.Loading());
    });

    test("the summary for the current range is accepted", () => {
      const { model } = withContext(
        onLastHour,
        SucceededFetchSummary({ summary: summaryResponse(), request: current })
      );

      expect(model.summary._tag).toBe("Success");
    });

    test("a slow failure for the old range does not mark the new one failed", () => {
      const { model } = withContext(
        onLastHour,
        FailedFetchSummary({ error: "timeout", request: stale })
      );

      expect(model.summary).toEqual(SummaryAsyncData.Loading());
    });

    test("a slow outage log for the old range is dropped, and the charts are not repainted with it", () => {
      const { model, commands } = withContext(
        onLastHour,
        SucceededFetchOutages({
          outages: outagesResponse([
            {
              start: "2026-07-27T02:00:00.000Z",
              end: "2026-07-27T02:06:00.000Z",
              durationSeconds: 360,
              status: "down",
              affectedHosts: ["1.1.1.1"],
              maxPacketLoss: 100,
              peakLatency: null,
            },
          ]),
          isClamped: true,
          fetchedAtMs: NOW_MS,
          request: stale,
        })
      );

      expect(model.outages).toEqual(OutagesAsyncData.Loading());
      expect(commands).toBeUndefined();
    });

    test("a slow outage failure for the old range is dropped too", () => {
      const { model } = withContext(
        onLastHour,
        FailedFetchOutages({ error: "timeout", request: stale })
      );

      expect(model.outages).toEqual(OutagesAsyncData.Loading());
    });

    test("an All time result from before the earliest datapoint was known is dropped", () => {
      const allTime = Preset({ preset: "allTime" });
      const afterEarliestKnown = {
        ...onLastHour,
        dateRange: allTime,
        maybeEarliestDataMs: Option.some(1_000),
      };
      const { model } = withContext(
        afterEarliestKnown,
        SucceededFetchSummary({
          summary: summaryResponse(),
          request: { dateRange: allTime, maybeEarliestDataMs: Option.none() },
        })
      );

      expect(model.summary).toEqual(SummaryAsyncData.Loading());
    });

    test("a preset result requested before the earliest datapoint was known still lands", () => {
      const { model } = withContext(
        { ...onLastHour, maybeEarliestDataMs: Option.some(1_000) },
        SucceededFetchSummary({
          summary: summaryResponse(),
          request: {
            dateRange: onLastHour.dateRange,
            maybeEarliestDataMs: Option.none(),
          },
        })
      );

      expect(model.summary._tag).toBe("Success");
    });

    test("an outage log requested before the earliest datapoint was known still lands", () => {
      const { model } = withContext(
        { ...onLastHour, maybeEarliestDataMs: Option.some(1_000) },
        SucceededFetchOutages({
          outages: outagesResponse([]),
          isClamped: false,
          fetchedAtMs: NOW_MS,
          request: {
            dateRange: onLastHour.dateRange,
            maybeEarliestDataMs: Option.none(),
          },
        })
      );

      expect(model.outages._tag).toBe("Success");
    });

    test("a custom range matches only itself", () => {
      const custom = Custom({
        startTime: "2026-07-01T00:00:00.000Z",
        endTime: "2026-07-08T00:00:00.000Z",
      });
      const onCustom = { ...onLastHour, dateRange: custom };

      expect(
        withContext(
          onCustom,
          SucceededFetchSummary({
            summary: summaryResponse(),
            request: {
              dateRange: Custom({
                startTime: "2026-07-01T00:00:00.000Z",
                endTime: "2026-07-09T00:00:00.000Z",
              }),
              maybeEarliestDataMs: Option.none(),
            },
          })
        ).model.summary
      ).toEqual(SummaryAsyncData.Loading());
      expect(
        withContext(
          onCustom,
          SucceededFetchSummary({
            summary: summaryResponse(),
            request: { dateRange: custom, maybeEarliestDataMs: Option.none() },
          })
        ).model.summary._tag
      ).toBe("Success");
    });
  });
});

// A Command carries a closure, which never equals another's, so Commands are
// compared by name and arguments.
const summarize = (command: { name: string; args?: unknown }) => ({
  name: command.name,
  args: command.args,
});
const summarized = (
  commands: ReadonlyArray<{ name: string; args?: unknown }> | undefined
) => (commands ?? []).map(summarize);

describe("dashboard update: per-host latency", () => {
  const HOSTS = ["8.8.8.8", "1.1.1.1"];
  const perHost = {
    ...mountedChartsModel(),
    latencyView: "perHost" as const,
    pingHosts: PingHostsAsyncData.Success({ data: hostsResponse(HOSTS) }),
  };
  const hostWindow = {
    startTimeMs: METRICS_WINDOW.startTimeMs,
    endTimeMs: METRICS_WINDOW.endTimeMs,
    granularity: METRICS_WINDOW.granularity,
  };
  const answeredWindow = { ...hostWindow, request: DEFAULT_REQUEST };
  const hostMetric = {
    timestamp: "2026-07-28T11:00:00.000Z",
    source: "ping" as const,
    latency: 12,
  };
  const names = (commands: ReadonlyArray<{ name: string }> | undefined) =>
    (commands ?? []).map((command) => command.name);

  test("choosing the per-host view saves it, fetches every host's series and keeps the chart as it is until they arrive", () => {
    const model = {
      ...mountedChartsModel(),
      pingHosts: PingHostsAsyncData.Success({ data: hostsResponse(HOSTS) }),
    };
    const { model: next, commands } = withContext(
      model,
      selectLatencyView("perHost")
    );

    expect(next.latencyView).toBe("perHost");
    expect(next.hostLatency._tag).toBe("Loading");
    expect(summarized(commands)).toContainEqual(
      summarize(
        FetchHostLatency({
          token: "abc123",
          dateRange: DEFAULT_DATE_RANGE,
          maybeEarliestDataMs: Option.none(),
          hosts: HOSTS,
        })
      )
    );
    expect(names(commands)).toContain("SaveSettings");
  });

  test("choosing the view already showing changes nothing and refetches nothing", () => {
    const loaded = {
      ...perHost,
      hostLatency: HostLatencyAsyncData.Success({
        data: { series: [], window: answeredWindow },
      }),
    };

    const { model, commands } = withContext(
      loaded,
      selectLatencyView("perHost")
    );

    expect(model.hostLatency).toEqual(loaded.hostLatency);
    expect(names(commands)).not.toContain("SaveSettings");
    expect(names(commands)).not.toContain("FetchHostLatency");
  });

  test("choosing the per-host view before the hosts are known fetches nothing yet", () => {
    const { model, commands } = withContext(
      mountedChartsModel(),
      selectLatencyView("perHost")
    );

    expect(model.latencyView).toBe("perHost");
    expect(names(commands)).not.toContain("FetchHostLatency");
  });

  test("the hosts arriving while the per-host view is open start the fetch", () => {
    const { model, commands } = withContext(
      {
        ...mountedChartsModel(),
        latencyView: "perHost" as const,
        pingHosts: PingHostsAsyncData.Loading(),
      },
      SucceededFetchPingHosts({ hosts: hostsResponse(HOSTS) })
    );

    expect(model.hostLatency._tag).toBe("Loading");
    expect(names(commands)).toContain("FetchHostLatency");
  });

  test("the hosts arriving while the all-hosts view is open fetch no series", () => {
    const { commands } = withContext(
      { ...mountedChartsModel(), pingHosts: PingHostsAsyncData.Loading() },
      SucceededFetchPingHosts({ hosts: hostsResponse(HOSTS) })
    );

    expect(names(commands)).not.toContain("FetchHostLatency");
  });

  test("going back to all hosts drops the per-host data and repaints the single line", () => {
    const { model, commands } = withContext(
      {
        ...perHost,
        hostLatency: HostLatencyAsyncData.Success({
          data: {
            series: [{ host: "8.8.8.8", metrics: [hostMetric] }],
            window: answeredWindow,
          },
        }),
      },
      selectLatencyView("all")
    );

    expect(model.latencyView).toBe("all");
    expect(model.hostLatency._tag).toBe("Idle");
    expect(summarized(commands)).toContainEqual(
      summarize(
        SyncLatencyChart({
          hostId: "latency-chart",
          metrics: [],
          hostSeries: [],
          ...METRICS_WINDOW,
          incidents: [],
        })
      )
    );
    expect(names(commands)).toContain("SaveSettings");
  });

  test("the series landing for the current range are stored and painted, one line per host", () => {
    const { model, commands } = withContext(
      { ...perHost, hostLatency: HostLatencyAsyncData.Loading() },
      SucceededFetchHostLatency({
        series: [
          { host: "8.8.8.8", metrics: [hostMetric] },
          { host: "1.1.1.1", metrics: [] },
        ],
        ...hostWindow,
        request: DEFAULT_REQUEST,
      })
    );

    expect(model.hostLatency._tag).toBe("Success");
    expect(summarized(commands)).toContainEqual(
      summarize(
        SyncLatencyChart({
          hostId: "latency-chart",
          metrics: [],
          hostSeries: [
            { host: "8.8.8.8", metrics: [hostMetric] },
            { host: "1.1.1.1", metrics: [] },
          ],
          ...hostWindow,
          incidents: [],
        })
      )
    );
  });

  describe("when the all-hosts metrics have not answered", () => {
    const hostData = HostLatencyAsyncData.Success({
      data: {
        series: [{ host: "8.8.8.8", metrics: [hostMetric] }],
        window: answeredWindow,
      },
    });
    const withoutAllHosts = (metrics: Model["metrics"]) => ({
      ...perHost,
      metrics,
      maybeMetricsWindow: Option.none(),
    });
    const hostLinesPainted = {
      name: "SyncLatencyChart",
      args: expect.objectContaining({
        hostId: "latency-chart",
        metrics: [],
        hostSeries: [{ host: "8.8.8.8", metrics: [hostMetric] }],
        ...hostWindow,
      }),
    };

    test("the series landing while the all-hosts metrics are loading are painted", () => {
      const { commands } = withContext(
        {
          ...withoutAllHosts(MetricsAsyncData.Loading()),
          hostLatency: HostLatencyAsyncData.Loading(),
        },
        SucceededFetchHostLatency({
          series: [{ host: "8.8.8.8", metrics: [hostMetric] }],
          ...hostWindow,
          request: DEFAULT_REQUEST,
        })
      );

      expect(summarized(commands)).toContainEqual(hostLinesPainted);
    });

    test("the series are painted when the all-hosts metrics failed", () => {
      const { commands } = withContext(
        {
          ...withoutAllHosts(MetricsAsyncData.Failure({ error: "timeout" })),
          hostLatency: HostLatencyAsyncData.Loading(),
        },
        SucceededFetchHostLatency({
          series: [{ host: "8.8.8.8", metrics: [hostMetric] }],
          ...hostWindow,
          request: DEFAULT_REQUEST,
        })
      );

      expect(summarized(commands)).toContainEqual(hostLinesPainted);
    });

    test("a theme change repaints the series without the all-hosts metrics", () => {
      const { commands } = withContext(
        {
          ...withoutAllHosts(MetricsAsyncData.Loading()),
          hostLatency: hostData,
        },
        ChangedSystemTheme()
      );

      expect(summarized(commands)).toContainEqual(hostLinesPainted);
    });

    test("mounting the chart paints the series without the all-hosts metrics", () => {
      const { commands } = withContext(
        {
          ...withoutAllHosts(MetricsAsyncData.Failure({ error: "timeout" })),
          maybeLatencyChartHostId: Option.none(),
          hostLatency: hostData,
        },
        SucceededMountLatencyChart({ hostId: "latency-chart" })
      );

      expect(summarized(commands)).toContainEqual(hostLinesPainted);
    });

    test("the all-hosts view still waits for its metrics and their window", () => {
      const { commands } = withContext(
        {
          ...withoutAllHosts(MetricsAsyncData.Loading()),
          latencyView: "all" as const,
          maybeLatencyChartHostId: Option.none(),
        },
        SucceededMountLatencyChart({ hostId: "latency-chart" })
      );

      expect(names(commands)).not.toContain("SyncLatencyChart");
    });
  });

  test("series for a range the viewer has left are dropped", () => {
    const { model, commands } = withContext(
      { ...perHost, hostLatency: HostLatencyAsyncData.Loading() },
      SucceededFetchHostLatency({
        series: [],
        ...hostWindow,
        request: {
          dateRange: Preset({ preset: "last1h" }),
          maybeEarliestDataMs: Option.none(),
        },
      })
    );

    expect(model.hostLatency._tag).toBe("Loading");
    expect(commands).toBeUndefined();
  });

  test("a failed fetch settles as a failure the banner can name, and a stale one is ignored", () => {
    const loading = { ...perHost, hostLatency: HostLatencyAsyncData.Loading() };

    expect(
      withContext(
        loading,
        FailedFetchHostLatency({ error: "db down", request: DEFAULT_REQUEST })
      ).model.hostLatency
    ).toEqual(HostLatencyAsyncData.Failure({ error: "db down" }));
    expect(
      withContext(
        loading,
        FailedFetchHostLatency({
          error: "db down",
          request: {
            dateRange: Preset({ preset: "last1h" }),
            maybeEarliestDataMs: Option.none(),
          },
        })
      ).model.hostLatency._tag
    ).toBe("Loading");
  });

  test("series and failures landing after the viewer is back on all hosts are dropped", () => {
    const backOnAll = { ...mountedChartsModel(), latencyView: "all" as const };

    const succeeded = withContext(
      backOnAll,
      SucceededFetchHostLatency({
        series: [{ host: "8.8.8.8", metrics: [hostMetric] }],
        ...hostWindow,
        request: DEFAULT_REQUEST,
      })
    );
    const failed = withContext(
      backOnAll,
      FailedFetchHostLatency({ error: "db down", request: DEFAULT_REQUEST })
    );

    expect(succeeded.model.hostLatency._tag).toBe("Idle");
    expect(succeeded.commands).toBeUndefined();
    expect(failed.model.hostLatency._tag).toBe("Idle");
    expect(failed.commands).toBeUndefined();
  });

  test("a range change reloads the series in the per-host view only", () => {
    const changed = withContext(
      perHost,
      SelectedQuickRange({ preset: "last7d" })
    );
    const all = withContext(
      { ...perHost, latencyView: "all" as const },
      SelectedQuickRange({ preset: "last7d" })
    );

    expect(names(changed.commands)).toContain("FetchHostLatency");
    expect(names(all.commands)).not.toContain("FetchHostLatency");
  });

  test("a refresh tick and a manual refresh reload the series in the per-host view only", () => {
    const loaded = {
      ...perHost,
      hostLatency: HostLatencyAsyncData.Success({
        data: { series: [], window: answeredWindow },
      }),
    };

    expect(names(withContext(loaded, TickedRefresh()).commands)).toContain(
      "FetchHostLatency"
    );
    expect(names(withContext(loaded, ClickedRefreshNow()).commands)).toContain(
      "FetchHostLatency"
    );
    expect(
      names(
        withContext({ ...loaded, latencyView: "all" as const }, TickedRefresh())
          .commands
      )
    ).not.toContain("FetchHostLatency");
  });

  const loadedSeries = {
    ...perHost,
    hostLatency: HostLatencyAsyncData.Success({
      data: {
        series: [{ host: "8.8.8.8", metrics: [hostMetric] }],
        window: answeredWindow,
      },
    }),
  };

  test("the landed series keep the range they answer", () => {
    const { model } = withContext(
      { ...perHost, hostLatency: HostLatencyAsyncData.Loading() },
      SucceededFetchHostLatency({
        series: [],
        ...hostWindow,
        request: DEFAULT_REQUEST,
      })
    );

    expect(
      Option.map(
        AsyncData.getData(model.hostLatency),
        ({ window }) => window.request
      )
    ).toEqual(Option.some(DEFAULT_REQUEST));
  });

  test("a refresh tick asks again after a failed fetch and keeps the failure until the retry answers", () => {
    const retried = withContext(
      {
        ...perHost,
        hostLatency: HostLatencyAsyncData.Failure({ error: "db down" }),
      },
      TickedRefresh()
    );

    expect(retried.model.hostLatency._tag).toBe("Failure");
    expect(names(retried.commands)).toContain("FetchHostLatency");

    const answered = withContext(
      retried.model,
      SucceededFetchHostLatency({
        series: [{ host: "8.8.8.8", metrics: [hostMetric] }],
        ...answeredWindow,
      })
    );

    expect(answered.model.hostLatency._tag).toBe("Success");
  });

  test("a range change shows the per-host chart loading, and a repaint then draws no old series", () => {
    const changed = withContext(
      loadedSeries,
      SelectedQuickRange({ preset: "last7d" })
    );
    const repaint = withContext(changed.model, ChangedSystemTheme());

    expect(changed.model.hostLatency._tag).toBe("Loading");
    expect(
      summarized(repaint.commands).find(
        ({ name }) => name === "SyncLatencyChart"
      )?.args
    ).toEqual(expect.objectContaining({ hostSeries: [] }));
  });

  test("the hosts arriving after the series have loaded fetch nothing again", () => {
    const { model, commands } = withContext(
      loadedSeries,
      SucceededFetchPingHosts({ hosts: hostsResponse(HOSTS) })
    );

    expect(model.hostLatency._tag).toBe("Success");
    expect(names(commands)).not.toContain("FetchHostLatency");
  });

  describe("on an 'All time' range whose start is not known yet", () => {
    const EARLIEST_MS = Date.parse("2025-01-01T00:00:00.000Z");
    const epochRequest: RangeRequest = {
      dateRange: Preset({ preset: "allTime" }),
      maybeEarliestDataMs: Option.none(),
    };
    const resolvedRequest: RangeRequest = {
      dateRange: Preset({ preset: "allTime" }),
      maybeEarliestDataMs: Option.some(EARLIEST_MS),
    };
    const allTimePerHost = {
      ...perHost,
      dateRange: Preset({ preset: "allTime" }),
      maybeEarliestDataMs: Option.none(),
    };
    const hostFetches = (
      commands: ReadonlyArray<{ name: string; args?: unknown }> | undefined
    ) => summarized(commands).filter(({ name }) => name === "FetchHostLatency");
    const hostFetchFor = (request: RangeRequest) =>
      summarize(
        FetchHostLatency({ token: "abc123", ...request, hosts: HOSTS })
      );
    const landed = (request: RangeRequest) =>
      SucceededFetchHostLatency({
        series: [{ host: "8.8.8.8", metrics: [hostMetric] }],
        ...hostWindow,
        request,
      });

    test("holds the host series back until the earliest datapoint lands, then asks on the resolved window", () => {
      const asked = withContext(
        { ...allTimePerHost, pingHosts: PingHostsAsyncData.Loading() },
        SucceededFetchPingHosts({ hosts: hostsResponse(HOSTS) })
      );
      expect(hostFetches(asked.commands)).toEqual([]);

      const resolved = withContext(
        asked.model,
        SucceededFetchEarliestData({ earliestMs: Option.some(EARLIEST_MS) })
      );

      expect(hostFetches(resolved.commands)).toEqual([
        hostFetchFor(resolvedRequest),
      ]);
      expect(resolved.model.hostLatency._tag).toBe("Loading");
    });

    test("the series fetched on the epoch window are dropped, and the resolved ones settle the chart", () => {
      const asked = withContext(
        allTimePerHost,
        SucceededFetchEarliestData({ earliestMs: Option.some(EARLIEST_MS) })
      );

      const stale = withContext(asked.model, landed(epochRequest));
      const fresh = withContext(stale.model, landed(resolvedRequest));

      expect(stale.model.hostLatency._tag).toBe("Loading");
      expect(stale.commands).toBeUndefined();
      expect(fresh.model.hostLatency._tag).toBe("Success");
    });

    test("a refresh tick retrying a failed fetch waits for the start too", () => {
      const { commands } = withContext(
        {
          ...allTimePerHost,
          hostLatency: HostLatencyAsyncData.Failure({ error: "db down" }),
        },
        TickedRefresh()
      );

      expect(hostFetches(commands)).toEqual([]);
    });

    test("the all-hosts view asks for no host series when the start is learned", () => {
      const resolved = withContext(
        { ...allTimePerHost, latencyView: "all" as const },
        SucceededFetchEarliestData({ earliestMs: Option.some(EARLIEST_MS) })
      );

      expect(hostFetches(resolved.commands)).toEqual([]);
      expect(resolved.model.hostLatency._tag).toBe("Idle");
    });
  });

  test("a repaint in the per-host view draws the host lines on the host window", () => {
    const { commands } = withContext(
      {
        ...perHost,
        hostLatency: HostLatencyAsyncData.Success({
          data: {
            series: [{ host: "8.8.8.8", metrics: [hostMetric] }],
            window: {
              ...answeredWindow,
              endTimeMs: hostWindow.endTimeMs + 60_000,
            },
          },
        }),
      },
      ChangedSystemTheme()
    );

    expect(summarized(commands)).toContainEqual(
      summarize(
        SyncLatencyChart({
          hostId: "latency-chart",
          metrics: [],
          hostSeries: [{ host: "8.8.8.8", metrics: [hostMetric] }],
          ...hostWindow,
          endTimeMs: hostWindow.endTimeMs + 60_000,
          incidents: [],
        })
      )
    );
  });
});

describe("dashboard update: brushing a range", () => {
  const HOUR_MS = 3_600_000;
  const T0 = Date.parse("2026-07-28T06:00:00.000Z");
  const brushed = Custom({
    startTime: "2026-07-28T06:00:00.000Z",
    endTime: "2026-07-28T08:00:00.000Z",
  });
  const names = (commands: ReadonlyArray<{ name: string }> | undefined) =>
    (commands ?? []).map((command) => command.name);

  test("a committed brush becomes the custom range for the whole page, and reloads and saves it", () => {
    const { model, commands } = withContext(
      initModel(defaultSettings()),
      BrushedChartRange({ startMs: T0, endMs: T0 + 2 * HOUR_MS })
    );

    expect(model.dateRange).toEqual(brushed);
    expect(names(commands)).toEqual(
      expect.arrayContaining([
        "FetchMetrics",
        "FetchSpeedtestHistory",
        "FetchConnectivityStatus",
        "FetchSummary",
        "FetchOutages",
        "SaveSettings",
      ])
    );
  });

  test("saves the range it narrowed, so a reload does not open on the brushed span", () => {
    const { commands } = withContext(
      initModel(defaultSettings()),
      BrushedChartRange({ startMs: T0, endMs: T0 + 2 * HOUR_MS })
    );

    expect(summarized(commands)).toContainEqual(
      summarize(
        SaveSettings({
          settings: { ...defaultSettings(), dateRange: DEFAULT_DATE_RANGE },
        })
      )
    );
  });

  test("remembers the range it narrowed, so it can be restored", () => {
    const { model } = withContext(
      initModel(defaultSettings()),
      BrushedChartRange({ startMs: T0, endMs: T0 + 2 * HOUR_MS })
    );

    expect(model.maybeRangeBeforeBrush).toEqual(
      Option.some(DEFAULT_DATE_RANGE)
    );
  });

  test("brushing again keeps the range the first brush narrowed, not the previous brush", () => {
    const first = withContext(
      initModel(defaultSettings()),
      BrushedChartRange({ startMs: T0, endMs: T0 + 2 * HOUR_MS })
    ).model;
    const second = withContext(
      first,
      BrushedChartRange({ startMs: T0 + HOUR_MS, endMs: T0 + 2 * HOUR_MS })
    ).model;

    expect(second.maybeRangeBeforeBrush).toEqual(
      Option.some(DEFAULT_DATE_RANGE)
    );
    expect(second.dateRange).toEqual(
      Custom({
        startTime: "2026-07-28T07:00:00.000Z",
        endTime: "2026-07-28T08:00:00.000Z",
      })
    );
  });

  test("a brush too short to chart changes nothing", () => {
    const { model, commands } = withContext(
      initModel(defaultSettings()),
      BrushedChartRange({ startMs: T0, endMs: T0 + 5_000 })
    );

    expect(model.dateRange).toEqual(DEFAULT_DATE_RANGE);
    expect(model.maybeRangeBeforeBrush).toEqual(Option.none());
    expect(commands).toBeUndefined();
  });

  test("resetting restores the range before the brush and forgets it", () => {
    const narrowed = withContext(
      initModel(defaultSettings()),
      BrushedChartRange({ startMs: T0, endMs: T0 + 2 * HOUR_MS })
    ).model;
    const { model, commands } = withContext(narrowed, ClickedResetRange());

    expect(model.dateRange).toEqual(DEFAULT_DATE_RANGE);
    expect(model.maybeRangeBeforeBrush).toEqual(Option.none());
    expect(names(commands)).toEqual(
      expect.arrayContaining(["FetchMetrics", "SaveSettings"])
    );
  });

  test("resetting with nothing narrowed does nothing", () => {
    const { model, commands } = withContext(
      initModel(defaultSettings()),
      ClickedResetRange()
    );

    expect(model.dateRange).toEqual(DEFAULT_DATE_RANGE);
    expect(commands).toBeUndefined();
  });

  test("choosing a range yourself ends the narrowing, whether from the buttons or the picker", () => {
    const narrowed = withContext(
      initModel(defaultSettings()),
      BrushedChartRange({ startMs: T0, endMs: T0 + 2 * HOUR_MS })
    ).model;

    expect(
      withContext(narrowed, SelectedQuickRange({ preset: "last7d" })).model
        .maybeRangeBeforeBrush
    ).toEqual(Option.none());
  });
});

describe("dashboard update: each resource's fetch lifecycle", () => {
  const STATES = [
    "Idle",
    "Loading",
    "Refreshing",
    "Success",
    "Failure",
    "Stale",
  ] as const;
  type StateName = (typeof STATES)[number];

  type Builders<A> = Readonly<{
    Idle: () => AsyncData.AsyncData<A, string>;
    Loading: () => AsyncData.AsyncData<A, string>;
    Refreshing: (
      payload: Readonly<{ data: A }>
    ) => AsyncData.AsyncData<A, string>;
    Failure: (
      payload: Readonly<{ error: string }>
    ) => AsyncData.AsyncData<A, string>;
    Stale: (
      payload: Readonly<{ error: string; data: A }>
    ) => AsyncData.AsyncData<A, string>;
    Success: (payload: Readonly<{ data: A }>) => AsyncData.AsyncData<A, string>;
  }>;

  type ResourceName =
    | "metrics"
    | "speed history"
    | "connectivity status"
    | "live connectivity"
    | "summary"
    | "outages"
    | "ping hosts"
    | "host latency";
  type Outcome = readonly [state: StateName, fetches: boolean];
  type Outcomes = Readonly<Record<StateName, Outcome>>;

  const lifecycleCase = <A>(spec: {
    readonly resource: ResourceName;
    readonly fetchName: string;
    readonly scope: "range" | "global";
    readonly builders: Builders<A>;
    readonly data: A;
    readonly read: (model: Model) => AsyncData.AsyncData<A, string>;
    readonly write: (
      model: Model,
      next: AsyncData.AsyncData<A, string>
    ) => Model;
  }) => {
    const states: Readonly<Record<StateName, AsyncData.AsyncData<A, string>>> =
      {
        Idle: spec.builders.Idle(),
        Loading: spec.builders.Loading(),
        Refreshing: spec.builders.Refreshing({ data: spec.data }),
        Failure: spec.builders.Failure({ error: "boom" }),
        Stale: spec.builders.Stale({ error: "boom", data: spec.data }),
        Success: spec.builders.Success({ data: spec.data }),
      };
    return {
      resource: spec.resource,
      fetchName: spec.fetchName,
      scope: spec.scope,
      given: (base: Model, state: StateName): Model =>
        spec.write(base, states[state]),
      expectState: (model: Model, state: StateName) =>
        expect(spec.read(model)).toEqual(states[state]),
    };
  };

  // Per-host latency is only fetched in the per-host view once hosts are
  // known, so every case runs against a model where that holds.
  const base = (): Model => ({
    ...initModel(defaultSettings()),
    latencyView: "perHost",
    pingHosts: PingHostsAsyncData.Success({ data: hostsResponse() }),
  });

  const hostLatencyCase = lifecycleCase({
    resource: "host latency",
    fetchName: "FetchHostLatency",
    scope: "range",
    builders: HostLatencyAsyncData,
    data: {
      series: [],
      window: { ...METRICS_WINDOW, request: DEFAULT_REQUEST },
    },
    read: (model) => model.hostLatency,
    write: (model, hostLatency) => ({ ...model, hostLatency }),
  });

  const CASES = [
    lifecycleCase({
      resource: "metrics",
      fetchName: "FetchMetrics",
      scope: "range",
      builders: MetricsAsyncData,
      data: [],
      read: (model) => model.metrics,
      write: (model, metrics) => ({ ...model, metrics }),
    }),
    lifecycleCase({
      resource: "speed history",
      fetchName: "FetchSpeedtestHistory",
      scope: "range",
      builders: SpeedtestHistoryAsyncData,
      data: [],
      read: (model) => model.speedtestHistory,
      write: (model, speedtestHistory) => ({ ...model, speedtestHistory }),
    }),
    lifecycleCase({
      resource: "connectivity status",
      fetchName: "FetchConnectivityStatus",
      scope: "range",
      builders: ConnectivityStatusAsyncData,
      data: {
        request: DEFAULT_REQUEST,
        points: [],
        maybeUptimePercentage: Option.some(100),
        maybeAvailabilityPercentage: Option.some(100),
        coveragePercentage: 100,
        startTimeMs: 0,
        endTimeMs: 3_600_000,
        granularity: "1m" as const,
      },
      read: (model) => model.connectivityStatus,
      write: (model, connectivityStatus) => ({ ...model, connectivityStatus }),
    }),
    lifecycleCase({
      resource: "live connectivity",
      fetchName: "FetchLiveConnectivity",
      scope: "global",
      builders: LiveConnectivityAsyncData,
      data: { status: "up" as const, maybeLastSampleAtMs: Option.none() },
      read: (model) => model.liveConnectivity,
      write: (model, liveConnectivity) => ({ ...model, liveConnectivity }),
    }),
    lifecycleCase({
      resource: "summary",
      fetchName: "FetchSummary",
      scope: "range",
      builders: SummaryAsyncData,
      data: summaryData(),
      read: (model) => model.summary,
      write: (model, summary) => ({ ...model, summary }),
    }),
    lifecycleCase({
      resource: "outages",
      fetchName: "FetchOutages",
      scope: "range",
      builders: OutagesAsyncData,
      data: outagesData(),
      read: (model) => model.outages,
      write: (model, outages) => ({ ...model, outages }),
    }),
    lifecycleCase({
      resource: "ping hosts",
      fetchName: "FetchPingHosts",
      scope: "global",
      builders: PingHostsAsyncData,
      data: hostsResponse(),
      read: (model) => model.pingHosts,
      write: (model, pingHosts) => ({ ...model, pingHosts }),
    }),
    hostLatencyCase,
  ];

  const nameList = (commands: ReadonlyArray<{ name: string }> = []) =>
    commands.map(({ name }) => name);

  const retries: Outcomes = {
    Idle: ["Idle", false],
    Loading: ["Loading", false],
    Refreshing: ["Refreshing", false],
    Success: ["Refreshing", true],
    Failure: ["Failure", true],
    Stale: ["Refreshing", true],
  };
  const liveRetries: Outcomes = { ...retries, Stale: ["Loading", true] };
  const failuresOnly: Outcomes = {
    Idle: ["Idle", false],
    Loading: ["Loading", false],
    Refreshing: ["Refreshing", false],
    Success: ["Success", false],
    Failure: ["Failure", true],
    Stale: ["Stale", false],
  };
  const TICK: Readonly<Record<ResourceName, Outcomes>> = {
    metrics: retries,
    "speed history": retries,
    "connectivity status": retries,
    "live connectivity": liveRetries,
    summary: retries,
    outages: retries,
    "ping hosts": failuresOnly,
    "host latency": retries,
  };

  const loadsOnce: Outcomes = {
    Idle: ["Loading", true],
    Loading: ["Loading", false],
    Refreshing: ["Refreshing", false],
    Success: ["Success", false],
    Failure: ["Loading", true],
    Stale: ["Stale", false],
  };
  const neverOnEnter: Outcomes = {
    Idle: ["Idle", false],
    Loading: ["Loading", false],
    Refreshing: ["Refreshing", false],
    Success: ["Success", false],
    Failure: ["Failure", false],
    Stale: ["Stale", false],
  };
  const ENTER: Readonly<Record<ResourceName, Outcomes>> = {
    metrics: loadsOnce,
    "speed history": loadsOnce,
    "connectivity status": loadsOnce,
    "live connectivity": loadsOnce,
    summary: loadsOnce,
    outages: loadsOnce,
    "ping hosts": loadsOnce,
    "host latency": neverOnEnter,
  };

  const always: Outcomes = {
    Idle: ["Loading", true],
    Loading: ["Loading", true],
    Refreshing: ["Refreshing", true],
    Success: ["Refreshing", true],
    Failure: ["Loading", true],
    Stale: ["Refreshing", true],
  };
  const liveAlways: Outcomes = { ...always, Stale: ["Loading", true] };
  const RELOAD: Readonly<Record<ResourceName, Outcomes>> = {
    metrics: always,
    "speed history": always,
    "connectivity status": always,
    "live connectivity": liveAlways,
    summary: always,
    outages: always,
    "ping hosts": always,
    "host latency": always,
  };

  const rows = (outcomes: Readonly<Record<ResourceName, Outcomes>>) =>
    CASES.flatMap((resourceCase) =>
      STATES.map((state) => ({
        resourceCase,
        state,
        expected: outcomes[resourceCase.resource][state],
      }))
    );

  describe("a refresh tick", () => {
    test.each(rows(TICK))(
      "$resourceCase.resource in $state",
      ({ resourceCase, state, expected: [nextState, fetches] }) => {
        const { model, commands } = withContext(
          resourceCase.given(base(), state),
          TickedRefresh()
        );

        resourceCase.expectState(model, nextState);
        expect(nameList(commands)).toEqual(
          fetches ? [resourceCase.fetchName] : []
        );
      }
    );

    test("a tick that only retries failures keeps the same model", () => {
      const failed = CASES.reduce(
        (model, resourceCase) => resourceCase.given(model, "Failure"),
        base()
      );
      const result = withContext(failed, TickedRefresh());

      expect(result.model).toBe(failed);
      expect(nameList(result.commands).length).toBeGreaterThan(0);
    });

    test("a tick leaves a resource that is already in flight alone", () => {
      const pending = CASES.reduce(
        (model, resourceCase) => resourceCase.given(model, "Refreshing"),
        base()
      );

      expect(nameList(withContext(pending, TickedRefresh()).commands)).toEqual(
        []
      );
    });
  });

  describe("entering the dashboard", () => {
    test.each(rows(ENTER))(
      "$resourceCase.resource in $state",
      ({ resourceCase, state, expected: [nextState, fetches] }) => {
        const { model, commands } = withContext(
          resourceCase.given(base(), state),
          EnteredDashboard()
        );

        resourceCase.expectState(model, nextState);
        expect(
          nameList(commands).filter((name) => name === resourceCase.fetchName)
        ).toEqual(fetches ? [resourceCase.fetchName] : []);
      }
    );
  });

  describe("Refresh now", () => {
    test.each(rows(RELOAD))(
      "$resourceCase.resource in $state",
      ({ resourceCase, state, expected: [nextState, fetches] }) => {
        const { model, commands } = withContext(
          resourceCase.given(base(), state),
          ClickedRefreshNow()
        );

        resourceCase.expectState(model, nextState);
        expect(
          nameList(commands).filter((name) => name === resourceCase.fetchName)
        ).toEqual(fetches ? [resourceCase.fetchName] : []);
      }
    );
  });

  describe("while 'All time' waits for the earliest datapoint", () => {
    const awaiting = (): Model => ({
      ...base(),
      dateRange: Preset({ preset: "allTime" }),
    });
    // Range-scoped resources move to their next state but hold their fetch;
    // the unknown start is asked for again, whatever else is on screen.
    const AWAITING: Readonly<
      Record<ResourceName, readonly [StateName, ReadonlyArray<string>]>
    > = {
      metrics: ["Refreshing", []],
      "speed history": ["Refreshing", []],
      "connectivity status": ["Refreshing", []],
      "live connectivity": ["Refreshing", ["FetchLiveConnectivity"]],
      summary: ["Refreshing", []],
      outages: ["Refreshing", []],
      "ping hosts": ["Success", []],
      "host latency": ["Refreshing", []],
    };

    test.each(CASES)("a tick on $resource", (resourceCase) => {
      const [nextState, fetches] = AWAITING[resourceCase.resource];
      const { model, commands } = withContext(
        resourceCase.given(awaiting(), "Success"),
        TickedRefresh()
      );

      resourceCase.expectState(model, nextState);
      expect([...nameList(commands)].sort()).toEqual(
        ["FetchEarliestData", ...fetches].sort()
      );
    });
  });

  describe("per-host latency", () => {
    test.each([
      ["the latency chart shows all hosts", { latencyView: "all" as const }],
      ["no host is configured", { pingHosts: PingHostsAsyncData.Idle() }],
    ])("is left alone on a tick or a reload when %s", (_, overrides) => {
      const model: Model = {
        ...hostLatencyCase.given(base(), "Failure"),
        ...overrides,
      };

      for (const message of [TickedRefresh(), ClickedRefreshNow()]) {
        const result = withContext(model, message);
        expect(nameList(result.commands)).not.toContain("FetchHostLatency");
        expect(result.model.hostLatency).toEqual(model.hostLatency);
      }
    });
  });
});

describe("dashboard update: activity that changes nothing", () => {
  test("interacting while already active keeps the same model and starts nothing", () => {
    const model = initModel(defaultSettings());
    const result = withContext(model, Interacted());

    expect(result.model).toBe(model);
    expect(result.commands).toBeUndefined();
  });

  test("going idle while already idle keeps the same model", () => {
    const model = { ...initModel(defaultSettings()), isIdle: true };

    expect(withContext(model, WentIdle()).model).toBe(model);
  });
});

describe("dashboard update: the clock", () => {
  test("a model is born holding the time it was given", () => {
    expect(initModel(defaultSettings()).nowMs).toBe(NOW_MS);
  });

  test("a clock tick stores the time and starts nothing", () => {
    const result = withContext(
      initModel(defaultSettings()),
      TickedClock({ nowMs: NOW_MS + 1000 })
    );

    expect(result.model.nowMs).toBe(NOW_MS + 1000);
    expect(result.commands).toBeUndefined();
  });

  test("a tick that carries the time already held keeps the same model", () => {
    const model = initModel(defaultSettings());

    expect(withContext(model, TickedClock({ nowMs: NOW_MS })).model).toBe(
      model
    );
  });
});
