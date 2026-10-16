import { PACKET_LOSS_THRESHOLDS } from "@wan-monitor/shared";
import { Array as Array_, Match as M, Option } from "effect";
import { AsyncData } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import type { IconNode } from "lucide";
import {
  Activity,
  Check,
  EllipsisVertical,
  Gauge,
  Globe,
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
import { openIncidentParts } from "@/dashboard/incidents";
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
  CONNECTION_STATUS,
  type ConnectionState,
  networkInfo,
  percentText,
  rangeTag,
} from "@/dashboard/overview";
import type { ViewInputs } from "@/dashboard/view";
import {
  configuredHosts,
  connectionOf,
  currentConnectivity,
  deltasOf,
  lastSampleOf,
  openIncidentOf,
  summaryOf,
  trailingWindowsOf,
} from "@/dashboard/view/derived";
import { WRAP_CLASS } from "@/dashboard/view/layout";
import { isAwaitingData } from "@/dashboard/view/loading";
import { ribbonCard } from "@/dashboard/view/ribbon";
import { statRail } from "@/dashboard/view/statRail";
import {
  FIELD_ICON_BUTTON_CLASS,
  FIELD_SEGMENTED_GROUP_CLASS,
  segmentStateClass,
} from "@/ui/controls";
import { deltaRow } from "@/ui/deltaRow";
import { icon } from "@/ui/icon";
import { skeleton } from "@/ui/skeleton";
import { type GlyphKind, statusGlyph } from "@/ui/statusGlyph";

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
      h.Class(FIELD_SEGMENTED_GROUP_CLASS),
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
          h.Class(`${QUICK_RANGE_BUTTON_CLASS} ${segmentStateClass(isActive)}`),
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
                  ? "Resume auto-refresh"
                  : model.isIdle
                    ? "Paused after inactivity. Resume auto-refresh"
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

const PILL_CLASSES: Record<ConnectionState, string> = {
  up: "border-up bg-card text-ink",
  degraded: "border-deg bg-deg-bg text-deg-text",
  down: "border-down bg-card text-down",
  noInfo: "border-nodata bg-card text-ink-2",
  checking: "border-nodata bg-card text-ink-2",
};

const PILL_GLYPHS: Record<ConnectionState, GlyphKind> = {
  up: "healthy",
  degraded: "degraded",
  down: "outage",
  noInfo: "noData",
  checking: "noData",
};

const PAUSED_CHIP_CLASS =
  "inline-flex h-[26px] items-center rounded-full border border-field-rule bg-card px-2.5 text-[13px] font-semibold text-ink";

const statusPill = (h: HtmlBuilder<Message>, state: ConnectionState): Html =>
  h.span(
    [
      h.DataAttribute("testid", "connection-status"),
      h.Class(
        `inline-flex h-9 items-center gap-2 rounded-full border-[1.5px] pl-3 pr-3.5 text-[15px] lg:h-[34px] ${PILL_CLASSES[state]}`
      ),
    ],
    [
      statusGlyph(h, PILL_GLYPHS[state]),
      h.span([h.Class("font-bold")], [CONNECTION_STATUS[state].label]),
    ]
  );

const pausedChip = (h: HtmlBuilder<Message>, model: Model): Html =>
  model.isPaused
    ? h.span([h.Class(PAUSED_CHIP_CLASS)], ["Auto-refresh paused"])
    : model.isIdle
      ? h.span([h.Class(PAUSED_CHIP_CLASS)], ["Paused after inactivity"])
      : h.empty;

const openIncidentLine = (
  h: HtmlBuilder<Message>,
  model: Model,
  nowMs: number
): Html =>
  Option.match(openIncidentOf(model), {
    onNone: () => h.empty,
    onSome: (outage) => {
      const { since, details } = openIncidentParts(
        outage,
        configuredHosts(model),
        nowMs
      );
      return h.p(
        [
          h.DataAttribute("testid", "open-incident"),
          h.Class("mt-2.5 text-sm leading-[1.45] text-ink"),
        ],
        [
          h.strong([h.Class("font-semibold")], [since]),
          ...(details.length === 0 ? [] : [` · ${details.join(" · ")}`]),
        ]
      );
    },
  });

const uptimeFigure = (model: Model): Option.Option<number> =>
  Option.orElse(
    Option.flatMap(summaryOf(model), ({ range }) =>
      Option.fromNullishOr(range.uptimePercentage)
    ),
    () =>
      Option.flatMap(
        currentConnectivity(model),
        (status) => status.maybeUptimePercentage
      )
  );

const availabilityFigure = (model: Model): Option.Option<number> =>
  Option.orElse(
    Option.flatMap(summaryOf(model), ({ range }) =>
      Option.fromNullishOr(range.availabilityPercentage)
    ),
    () =>
      Option.flatMap(
        currentConnectivity(model),
        (status) => status.maybeAvailabilityPercentage
      )
  );

// A figure waits for an answer to the selected range; a failed fetch is not
// waited for, since its figures read "-" and the banner says why.
const areFiguresLoading = (model: Model): boolean =>
  Option.isNone(summaryOf(model)) &&
  Option.isNone(currentConnectivity(model)) &&
  !AsyncData.hasError(model.summary) &&
  !AsyncData.hasError(model.connectivityStatus);

const rangeFigures = (h: HtmlBuilder<Message>, model: Model): Html => {
  const deltas = deltasOf(model);
  const tag = rangeTag(model.dateRange);
  const uptime = uptimeFigure(model);

  if (areFiguresLoading(model)) {
    return h.div(
      [
        h.Role("status"),
        h.AriaLabel("Loading status"),
        h.Class("mt-5 flex flex-col gap-3 lg:mt-[22px]"),
      ],
      [
        skeleton(h, "h-14 w-56"),
        skeleton(h, "h-4 w-48"),
        skeleton(h, "h-6 w-52"),
      ]
    );
  }

  return h.div(
    [],
    [
      h.p(
        [
          h.DataAttribute("testid", "uptime-figure"),
          h.Class(
            "mt-[18px] whitespace-nowrap text-[52px] font-semibold leading-none tracking-[-0.03em] lg:mt-[22px] lg:text-[68px]"
          ),
        ],
        [
          percentText(Option.getOrNull(uptime)),
          h.span(
            [
              h.Class(
                "text-xl font-semibold tracking-[-0.01em] text-ink-2 lg:text-[22px]"
              ),
            ],
            [Option.isSome(uptime) ? "% uptime" : " uptime"]
          ),
        ]
      ),
      ...Option.match(
        Option.flatMap(deltas, (d) => d.uptime),
        {
          onNone: () => [],
          onSome: (delta) => [deltaRow(h, delta, "mt-3 text-sm")],
        }
      ),
      h.div(
        [
          h.DataAttribute("testid", "availability-figure"),
          h.Class(
            "mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-field-rule pt-3 text-sm text-ink-2"
          ),
        ],
        [
          h.span(
            [],
            [
              h.strong(
                [h.Class("text-[17px] font-semibold text-ink")],
                [
                  Option.match(availabilityFigure(model), {
                    onNone: () => "-",
                    onSome: (value) => `${percentText(value)}%`,
                  }),
                ]
              ),
              ` available${Option.match(tag, { onNone: () => "", onSome: (t) => ` · ${t}` })}`,
            ]
          ),
          ...Option.match(
            Option.flatMap(deltas, (d) => d.availability),
            {
              onNone: () => [],
              onSome: (delta) => [deltaRow(h, delta, "text-sm")],
            }
          ),
        ]
      ),
      uptimeWindows(h, model),
    ]
  );
};

const UPTIME_NOTE = `Uptime: every host up and loss under ${PACKET_LOSS_THRESHOLDS.degradedFloor}%. Availability: up or degraded.`;

const WINDOWS = [
  ["last24h", "24h"],
  ["last7d", "7d"],
  ["last30d", "30d"],
] as const;

/** Uptime over the fixed trailing windows, with what the figure counts spelled out. */
const uptimeWindows = (h: HtmlBuilder<Message>, model: Model): Html => {
  const windows = trailingWindowsOf(model);
  return h.div(
    [h.Class("mt-3 border-t border-field-rule pt-3")],
    [
      isAwaitingData(model.summary)
        ? h.div(
            [
              h.Role("status"),
              h.AriaLabel("Loading uptime windows"),
              h.Class("grid grid-cols-3 gap-3"),
            ],
            Array_.map(WINDOWS, () => skeleton(h, "h-9 w-full"))
          )
        : h.div(
            [h.Class("grid grid-cols-3")],
            Array_.map(WINDOWS, ([key, label], index) =>
              h.div(
                [
                  h.DataAttribute("testid", `uptime-${key}`),
                  h.Class(
                    index === 0
                      ? "min-w-0"
                      : "min-w-0 border-l border-field-rule pl-3"
                  ),
                ],
                [
                  h.p([h.Class("text-xs font-semibold text-ink-2")], [label]),
                  h.p(
                    [
                      h.Class(
                        "mt-0.5 whitespace-nowrap text-lg font-semibold leading-none tracking-[-0.01em]"
                      ),
                    ],
                    [
                      percentText(
                        Option.match(windows, {
                          onNone: () => null,
                          onSome: (all) => all[key].uptimePercentage,
                        })
                      ),
                      h.span(
                        [h.Class("text-[13px] font-medium text-ink-2")],
                        ["%"]
                      ),
                    ]
                  ),
                ]
              )
            )
          ),
      h.p([h.Class("mt-2 text-[13px] text-ink-2")], [UPTIME_NOTE]),
    ]
  );
};

const networkLine = (h: HtmlBuilder<Message>, model: Model): Html => {
  if (isAwaitingData(model.speedtestHistory)) {
    return h.div([h.Class("mt-3")], [skeleton(h, "h-5 w-44")]);
  }
  const network = networkInfo(
    AsyncData.getOrElse(model.speedtestHistory, () => [])
  );
  return h.p(
    [
      h.DataAttribute("testid", "network-info"),
      h.Class(
        "mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2"
      ),
    ],
    [
      icon(h, Globe, { size: 15, strokeWidth: 1.75 }),
      h.span([], [network.isp]),
      ...Option.match(network.maybeExternalIp, {
        onNone: () => [],
        onSome: (externalIp) => [
          h.span([h.AriaHidden(true)], ["·"]),
          h.span([], [externalIp]),
        ],
      }),
    ]
  );
};

const statusColumn = (
  h: HtmlBuilder<Message>,
  model: Model,
  nowMs: number
): Html => {
  const state = connectionOf(model);
  return h.section(
    [
      h.AriaLabel("Live status and range uptime"),
      h.Class(
        "flex min-w-0 flex-col lg:justify-center xl:row-span-2 xl:justify-start xl:self-stretch"
      ),
    ],
    [
      // One polite region, always mounted, so a change of status or a new
      // incident is announced instead of replacing a node a screen reader
      // is not watching.
      h.div(
        [h.Role("status"), h.DataAttribute("testid", "live-status")],
        [
          h.div(
            [h.Class("flex flex-wrap items-center gap-2")],
            [statusPill(h, state), pausedChip(h, model)]
          ),
          openIncidentLine(h, model, nowMs),
        ]
      ),
      ...Option.match(lastSampleOf(model, nowMs), {
        onNone: () => [],
        onSome: (text) => [
          h.p(
            [
              h.DataAttribute("testid", "last-sample"),
              h.Class("mt-0.5 text-sm leading-[1.45] text-ink-2"),
            ],
            [text]
          ),
        ],
      }),
      rangeFigures(h, model),
      networkLine(h, model),
    ]
  );
};

/** The page banner: the brand and the controls, on the same tint as the status field below it. */
export const pageHeader = (
  h: HtmlBuilder<Message>,
  model: Model,
  viewInputs: ViewInputs
): Html =>
  h.header(
    [h.Class("bg-field")],
    [h.div([h.Class(WRAP_CLASS)], [topBar(h, model, viewInputs)])]
  );

/** The status-tinted field under the top bar: the live status with the range's uptime, the history ribbon, and the stat rail. */
export const statusField = (h: HtmlBuilder<Message>, model: Model): Html => {
  const nowMs = Date.now();
  return h.div(
    [h.Class("border-b border-field-rule bg-field")],
    [
      h.div(
        [
          h.Class(
            `${WRAP_CLASS} grid gap-5 pt-4 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-stretch lg:gap-x-10 lg:pt-2 xl:items-start`
          ),
        ],
        [
          statusColumn(h, model, nowMs),
          ribbonCard(h, model, nowMs),
          statRail(h, model),
        ]
      ),
    ]
  );
};
