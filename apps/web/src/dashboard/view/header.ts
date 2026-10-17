import { Array as Array_, Match as M, Option } from "effect";
import { AsyncData } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import type { IconNode } from "lucide";
import {
  Activity,
  Check,
  EllipsisVertical,
  Gauge,
  LogOut,
  Monitor,
  Moon,
  Pause,
  Play,
  RefreshCw,
  Sun,
} from "lucide";
import type { PresetKey } from "@/dashboard/dateRange";
import * as DateRangePicker from "@/dashboard/dateRangePicker";
import {
  DashboardMenu,
  isThemeItem,
  MENU_ITEMS,
  type MenuItem,
  THEME_ITEMS,
} from "@/dashboard/menu";
import {
  ClickedRefreshNow,
  ClickedTogglePause,
  GotDateRangePickerMessage,
  GotMenuMessage,
  Interacted,
  type Message,
  SelectedQuickRange,
} from "@/dashboard/message";
import type { Model } from "@/dashboard/model";
import {
  availabilityFigure,
  CONNECTION_SUMMARIES,
  type ConnectionState,
  describeRange,
  type Figure,
  lastSampleText,
  latencyFigure,
  networkInfo,
  speedFigure,
  uptimeSummary,
} from "@/dashboard/overview";
import type { ViewInputs } from "@/dashboard/view";
import { WRAP_CLASS } from "@/dashboard/view/layout";
import { isAwaitingData } from "@/dashboard/view/loading";
import { FIELD_ICON_BUTTON_CLASS } from "@/ui/controls";
import { figureTile } from "@/ui/figureTile";
import { icon } from "@/ui/icon";
import { skeleton } from "@/ui/skeleton";
import { statusBadge } from "@/ui/statusBadge";

const QUICK_RANGES: ReadonlyArray<readonly [PresetKey, string]> = [
  ["last1h", "1h"],
  ["last24h", "24h"],
  ["last7d", "7d"],
  ["last30d", "30d"],
];

const QUICK_RANGE_BUTTON_CLASS =
  "h-11 min-w-14 cursor-pointer rounded-[9px] px-3.5 text-sm font-semibold transition-colors lg:h-[34px] lg:min-w-[46px]";

const MENU_ITEM_CLASS =
  "flex h-11 cursor-pointer items-center rounded-lg px-3 text-[15px] text-ink data-[active]:bg-field data-[active]:ring-2 data-[active]:ring-inset data-[active]:ring-accent data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50";

const MENU_ITEM_ICONS: Record<MenuItem, IconNode> = {
  ThemeLight: Sun,
  ThemeDark: Moon,
  ThemeSystem: Monitor,
  RunSpeedTest: Gauge,
  Logout: LogOut,
};

const brand = (h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class("flex items-center gap-2.5")],
    [
      h.span(
        [
          h.Class(
            "inline-flex size-[30px] items-center justify-center rounded-[9px] bg-accent text-on-accent"
          ),
        ],
        [icon(h, Activity, { size: 18 })]
      ),
      h.h1(
        [
          h.Class(
            "whitespace-nowrap text-[17px] font-bold tracking-[-0.01em] lg:text-lg"
          ),
        ],
        ["WAN Monitor"]
      ),
    ]
  );

const quickRange = (h: HtmlBuilder<Message>, model: Model): Html =>
  h.div(
    [
      h.Role("group"),
      h.AriaLabel("Quick range"),
      h.Class(
        "inline-flex items-center gap-0.5 rounded-xl border border-field-rule bg-card p-[3px]"
      ),
    ],
    Array_.map(QUICK_RANGES, ([preset, label]) => {
      const isActive = M.value(model.dateRange).pipe(
        M.tag("Preset", (range) => range.preset === preset),
        M.orElse(() => false)
      );
      return h.button(
        [
          h.Type("button"),
          h.OnClick(SelectedQuickRange({ preset })),
          h.AriaPressed(String(isActive)),
          h.Class(
            `${QUICK_RANGE_BUTTON_CLASS} ${
              isActive
                ? "bg-accent text-on-accent"
                : "text-ink-2 hover:bg-field hover:text-ink"
            }`
          ),
        ],
        [label]
      );
    })
  );

const overflowMenu = (
  h: HtmlBuilder<Message>,
  model: Model,
  viewInputs: ViewInputs
): Html => {
  const isRunningSpeedtest = AsyncData.isPending(model.speedtestTrigger);
  const itemLabel = (item: MenuItem): string =>
    M.value(item).pipe(
      M.withReturnType<string>(),
      M.when(isThemeItem, (themeItem) => THEME_ITEMS[themeItem].label),
      M.when("RunSpeedTest", () =>
        isRunningSpeedtest ? "Running speed test…" : "Run speed test"
      ),
      M.when("Logout", () =>
        Option.match(viewInputs.maybeUsername, {
          onNone: () => "Log out",
          onSome: (username) => `Log out (${username})`,
        })
      ),
      M.exhaustive
    );

  return h.submodel({
    slotId: "dashboard-menu",
    model: model.menu,
    view: DashboardMenu.view,
    viewInputs: {
      items: MENU_ITEMS,
      ariaLabel: "Menu",
      itemToSearchText: itemLabel,
      isItemDisabled: (item) => item === "RunSpeedTest" && isRunningSpeedtest,
      itemGroupKey: (item) => (isThemeItem(item) ? "theme" : "actions"),
      groupToHeading: (key) =>
        key === "theme"
          ? {
              content: h.span([], ["Theme"]),
              className:
                "px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-ink-2",
            }
          : undefined,
      separatorClassName: "my-1.5 h-px bg-rule",
      itemToConfig: (item) => {
        const isCheckedTheme =
          isThemeItem(item) && model.theme === THEME_ITEMS[item].preference;
        return {
          className: MENU_ITEM_CLASS,
          content: h.div(
            [h.Class("flex w-full items-center gap-2.5")],
            [
              icon(h, MENU_ITEM_ICONS[item], { size: 18, strokeWidth: 1.75 }),
              h.span([h.Class("flex-1")], [itemLabel(item)]),
              isCheckedTheme
                ? h.span(
                    [],
                    [
                      icon(h, Check, { size: 16 }),
                      h.span([h.Class("sr-only")], [" (selected)"]),
                    ]
                  )
                : h.empty,
            ]
          ),
        };
      },
      buttonContent: icon(h, EllipsisVertical, { size: 18 }),
      buttonClassName: FIELD_ICON_BUTTON_CLASS,
      itemsClassName:
        "z-30 w-56 rounded-xl border border-rule bg-card p-1.5 shadow-lg focus:outline-none dark:shadow-none",
      anchor: { placement: "bottom-end", gap: 8 },
    },
    toParentMessage: (message) => GotMenuMessage({ message }),
  });
};

const topBar = (
  h: HtmlBuilder<Message>,
  model: Model,
  viewInputs: ViewInputs
): Html =>
  h.div(
    [
      h.Class(
        "flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-3 lg:h-[76px] lg:flex-nowrap lg:py-0"
      ),
    ],
    [
      brand(h),
      h.div(
        [
          h.Class(
            "order-last flex w-full flex-wrap items-center gap-2 lg:order-none lg:ml-auto lg:w-auto lg:flex-nowrap"
          ),
        ],
        [
          quickRange(h, model),
          h.submodel({
            slotId: "date-range-picker",
            model: model.dateRangePicker,
            view: DateRangePicker.view,
            viewInputs: {
              appliedSelection: model.dateRange,
              nowMs: Date.now(),
              maybeEarliestDataMs: model.maybeEarliestDataMs,
            },
            toParentMessage: (message) =>
              GotDateRangePickerMessage({ message }),
          }),
        ]
      ),
      h.div(
        [h.Class("flex items-center gap-1.5 lg:gap-2")],
        [
          h.button(
            [
              h.Type("button"),
              h.OnClick(ClickedRefreshNow()),
              h.Disabled(AsyncData.isPending(model.metrics)),
              h.AriaLabel("Refresh now"),
              h.Title("Refresh now"),
              h.Class(FIELD_ICON_BUTTON_CLASS),
            ],
            [icon(h, RefreshCw, { size: 18, strokeWidth: 1.75 })]
          ),
          h.button(
            [
              h.Type("button"),
              h.OnClick(model.isIdle ? Interacted() : ClickedTogglePause()),
              h.AriaLabel(
                model.isPaused
                  ? "Resume"
                  : model.isIdle
                    ? "Resume (paused, inactive)"
                    : "Pause"
              ),
              h.Title(
                model.isPaused
                  ? "Resume auto-refresh"
                  : model.isIdle
                    ? "Auto-refresh paused after inactivity. Click to resume"
                    : "Pause auto-refresh"
              ),
              h.Class(FIELD_ICON_BUTTON_CLASS),
            ],
            [
              icon(h, model.isPaused || model.isIdle ? Play : Pause, {
                size: 18,
                strokeWidth: 1.75,
              }),
            ]
          ),
          overflowMenu(h, model, viewInputs),
        ]
      ),
    ]
  );

const connectionState = (
  model: Model
): Readonly<{
  state: ConnectionState;
  maybeLastSampleAtMs: Option.Option<number>;
}> =>
  // A failed fetch says nothing about the WAN, so it reads as the same grey
  // "No Data" the server reports for a silent monitor, never as an outage.
  AsyncData.matchData(model.liveConnectivity, {
    onEmpty: () => ({ state: "checking", maybeLastSampleAtMs: Option.none() }),
    onFailure: () => ({ state: "noInfo", maybeLastSampleAtMs: Option.none() }),
    onData: (live) => ({
      state: live.status,
      maybeLastSampleAtMs: live.maybeLastSampleAtMs,
    }),
  });

const dotSeparated = (
  h: HtmlBuilder<Message>,
  parts: ReadonlyArray<Html>
): ReadonlyArray<Html> =>
  Array_.flatMap(parts, (part, index) =>
    index === 0
      ? [part]
      : [h.span([h.Class("text-ink-2"), h.AriaHidden(true)], ["·"]), part]
  );

const statusBlockText = (
  h: HtmlBuilder<Message>,
  model: Model,
  nowMs: number
): Html => {
  const { state, maybeLastSampleAtMs } = connectionState(model);
  const summary = CONNECTION_SUMMARIES[state];
  const network = networkInfo(
    AsyncData.getOrElse(model.speedtestHistory, () => [])
  );
  const sampleText = lastSampleText(state, maybeLastSampleAtMs, nowMs);

  return h.div(
    [h.Class("min-w-0")],
    [
      h.h2(
        [
          h.Class(
            "text-[44px] font-semibold leading-[1.02] tracking-[-0.025em] lg:text-[68px]"
          ),
        ],
        [summary.headline]
      ),
      h.div(
        [
          h.Class(
            "mt-[18px] flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[15px] text-ink-2 lg:text-[17px]"
          ),
        ],
        [
          ...dotSeparated(h, [
            statusBadge(h, { tone: summary.tone, label: summary.label }),
            ...Option.match(sampleText, {
              onNone: () => [],
              onSome: (text) => [h.span([], [text])],
            }),
            h.span([], [network.isp]),
            ...Option.match(network.maybeExternalIp, {
              onNone: () => [],
              onSome: (externalIp) => [h.span([], [externalIp])],
            }),
          ]),
          model.isPaused
            ? h.span(
                [
                  h.Class(
                    "inline-flex h-6 items-center rounded-full border border-field-rule bg-card px-2.5 text-[13px] font-semibold text-ink"
                  ),
                ],
                ["Live updates paused"]
              )
            : h.empty,
        ]
      ),
      isAwaitingData(model.connectivityStatus)
        ? h.div([h.Class("mt-3")], [skeleton(h, "h-6 w-72 max-w-full")])
        : h.p(
            [
              h.Class(
                "mt-3 max-w-[36ch] text-[17px] leading-[1.4] text-ink lg:text-xl"
              ),
            ],
            [
              uptimeSummary(
                Option.flatMap(
                  AsyncData.getData(model.connectivityStatus),
                  (status) => status.maybeUptimePercentage
                ),
                describeRange(model.dateRange)
              ),
            ]
          ),
    ]
  );
};

const heroFigures = (
  model: Model,
  nowMs: number
): ReadonlyArray<
  Readonly<{
    figure: Figure;
    isLoading: boolean;
    testId: string;
    className?: string;
  }>
> => {
  const metrics = AsyncData.getOrElse(model.metrics, () => []);
  const connectivity = AsyncData.getData(model.connectivityStatus);
  const speedtests = AsyncData.getOrElse(model.speedtestHistory, () => []);
  return [
    {
      figure: availabilityFigure(
        Option.flatMap(
          connectivity,
          (status) => status.maybeAvailabilityPercentage
        ),
        Option.match(connectivity, {
          onNone: () => [],
          onSome: (status) => status.points,
        })
      ),
      isLoading: isAwaitingData(model.connectivityStatus),
      testId: "hero-availability",
    },
    {
      figure: latencyFigure(metrics),
      isLoading: isAwaitingData(model.metrics),
      testId: "hero-latency",
    },
    {
      figure: speedFigure(speedtests, nowMs),
      isLoading: isAwaitingData(model.speedtestHistory),
      testId: "hero-speed",
      className: "col-span-2 sm:col-span-1",
    },
  ];
};

/**
 * The status-tinted field that opens the page: top bar, a plain-sentence
 * answer to "is my connection OK?", and the three hero figures.
 */
export const statusField = (
  h: HtmlBuilder<Message>,
  model: Model,
  viewInputs: ViewInputs
): Html => {
  const nowMs = Date.now();
  return h.header(
    [h.Class("border-b border-field-rule bg-field")],
    [
      h.div(
        [h.Class(WRAP_CLASS)],
        [
          topBar(h, model, viewInputs),
          h.div(
            [
              h.Class(
                "pb-6 pt-5 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-10 lg:pb-10 lg:pt-6"
              ),
            ],
            [
              statusBlockText(h, model, nowMs),
              h.div(
                [
                  h.Class(
                    "mt-6 grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_1.3fr] sm:gap-4 lg:mt-0 lg:grid-cols-[228px_228px_272px]"
                  ),
                ],
                Array_.map(heroFigures(model, nowMs), (hero) =>
                  figureTile(h, { ...hero, variant: "hero" })
                )
              ),
            ]
          ),
        ]
      ),
    ]
  );
};
