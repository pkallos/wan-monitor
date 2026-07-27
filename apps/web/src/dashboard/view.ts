import { Array as Array_, Option } from "effect";
import { AsyncData, Submodel } from "foldkit";
import type { Html } from "foldkit/html";
import { html } from "foldkit/html";
import {
  JITTER_CHART_HOST_ID,
  LATENCY_CHART_HOST_ID,
  MountJitterChart,
  MountLatencyChart,
  MountPacketLossChart,
  MountSpeedChart,
  PACKET_LOSS_CHART_HOST_ID,
  SPEED_CHART_HOST_ID,
} from "@/dashboard/charts/command";
import { calculateSpeedStats } from "@/dashboard/charts/stats";
import {
  buildSegments,
  CONNECTIVITY_COLORS,
  formatSegmentLabel,
  mergeSegments,
} from "@/dashboard/connectivity";
import type { Message } from "@/dashboard/message";
import {
  ChangedTimeRange,
  ClickedRefreshNow,
  ClickedTogglePause,
  ClickedToggleTheme,
  ClickedTriggerSpeedtest,
  GotToastMessage,
  HoveredConnectivitySegment,
  UnhoveredConnectivitySegment,
} from "@/dashboard/message";
import type { Model } from "@/dashboard/model";
import {
  type CardStatus,
  connectivityCard,
  downloadSpeedCard,
  formatDurationAgo,
  networkInfo,
  type SummaryCard,
  uploadSpeedCard,
} from "@/dashboard/summaryCards";
import { TIME_RANGE_LABELS, type TimeRange } from "@/dashboard/timeRange";
import { Toast } from "@/dashboard/toast";

const TIME_RANGES: ReadonlyArray<TimeRange> = ["1h", "24h", "7d", "30d"];

const GHOST_ICON_BUTTON_CLASS =
  "cursor-pointer rounded-md p-2 text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-700";

const CARD_CLASS =
  "rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800";

const SECTION_HEADING_CLASS = "mb-4 text-xl font-bold";

const CHART_LABEL_CLASS =
  "mb-2 text-sm font-semibold text-gray-500 dark:text-gray-400";

const warningIcon = (): Html => {
  const h = html<Message>();
  return h.svg(
    [
      h.Attribute("viewBox", "0 0 20 20"),
      h.Attribute("fill", "none"),
      h.Class("h-4 w-4 flex-shrink-0"),
    ],
    [
      h.polygon(
        [
          h.Attribute("points", "10,2 18,17 2,17"),
          h.Attribute("stroke", "currentColor"),
          h.Attribute("stroke-width", "1.5"),
          h.Attribute("stroke-linejoin", "round"),
        ],
        []
      ),
      h.line(
        [
          h.Attribute("x1", "10"),
          h.Attribute("y1", "8"),
          h.Attribute("x2", "10"),
          h.Attribute("y2", "12"),
          h.Attribute("stroke", "currentColor"),
          h.Attribute("stroke-width", "1.5"),
          h.Attribute("stroke-linecap", "round"),
        ],
        []
      ),
      h.circle(
        [
          h.Attribute("cx", "10"),
          h.Attribute("cy", "14.5"),
          h.Attribute("r", "0.75"),
          h.Attribute("fill", "currentColor"),
        ],
        []
      ),
    ]
  );
};

const iconSvg = (
  children: (h: ReturnType<typeof html<Message>>) => ReadonlyArray<Html>
): Html => {
  const h = html<Message>();
  return h.svg(
    [
      h.Attribute("viewBox", "0 0 24 24"),
      h.Attribute("fill", "none"),
      h.Class("h-5 w-5"),
    ],
    children(h)
  );
};

const refreshIcon = (): Html =>
  iconSvg((h) => [
    h.circle(
      [
        h.Attribute("cx", "12"),
        h.Attribute("cy", "12"),
        h.Attribute("r", "7"),
        h.Attribute("stroke", "currentColor"),
        h.Attribute("stroke-width", "2.5"),
        h.Attribute("stroke-dasharray", "30 14"),
        h.Attribute("stroke-linecap", "round"),
      ],
      []
    ),
    h.polygon(
      [
        h.Attribute("points", "17.5,4.5 19.5,8.5 15,8"),
        h.Attribute("fill", "currentColor"),
      ],
      []
    ),
  ]);

const pauseIcon = (): Html =>
  iconSvg((h) => [
    h.rect(
      [
        h.Attribute("x", "8"),
        h.Attribute("y", "5"),
        h.Attribute("width", "3"),
        h.Attribute("height", "14"),
        h.Attribute("rx", "1"),
        h.Attribute("fill", "currentColor"),
      ],
      []
    ),
    h.rect(
      [
        h.Attribute("x", "13"),
        h.Attribute("y", "5"),
        h.Attribute("width", "3"),
        h.Attribute("height", "14"),
        h.Attribute("rx", "1"),
        h.Attribute("fill", "currentColor"),
      ],
      []
    ),
  ]);

const playIcon = (): Html =>
  iconSvg((h) => [
    h.polygon(
      [
        h.Attribute("points", "8,5 8,19 19,12"),
        h.Attribute("fill", "currentColor"),
      ],
      []
    ),
  ]);

const sunIcon = (): Html =>
  iconSvg((h) => [
    h.circle(
      [
        h.Attribute("cx", "12"),
        h.Attribute("cy", "12"),
        h.Attribute("r", "4.5"),
        h.Attribute("stroke", "currentColor"),
        h.Attribute("stroke-width", "2.5"),
      ],
      []
    ),
    ...[
      ["12", "1", "12", "4"],
      ["12", "20", "12", "23"],
      ["1", "12", "4", "12"],
      ["20", "12", "23", "12"],
      ["4.2", "4.2", "6.3", "6.3"],
      ["17.7", "17.7", "19.8", "19.8"],
      ["4.2", "19.8", "6.3", "17.7"],
      ["17.7", "6.3", "19.8", "4.2"],
    ].map(([x1, y1, x2, y2]) =>
      h.line(
        [
          h.Attribute("x1", x1),
          h.Attribute("y1", y1),
          h.Attribute("x2", x2),
          h.Attribute("y2", y2),
          h.Attribute("stroke", "currentColor"),
          h.Attribute("stroke-width", "2.5"),
          h.Attribute("stroke-linecap", "round"),
        ],
        []
      )
    ),
  ]);

// A true crescent (not a plain filled dot): masks a second, offset circle
// out of the main disc rather than approximating with a path.
const moonIcon = (): Html =>
  iconSvg((h) => [
    h.defs(
      [],
      [
        h.mask(
          [h.Attribute("id", "moon-icon-mask")],
          [
            h.rect(
              [
                h.Attribute("x", "0"),
                h.Attribute("y", "0"),
                h.Attribute("width", "24"),
                h.Attribute("height", "24"),
                h.Attribute("fill", "white"),
              ],
              []
            ),
            h.circle(
              [
                h.Attribute("cx", "15.5"),
                h.Attribute("cy", "9"),
                h.Attribute("r", "6.5"),
                h.Attribute("fill", "black"),
              ],
              []
            ),
          ]
        ),
      ]
    ),
    h.circle(
      [
        h.Attribute("cx", "12"),
        h.Attribute("cy", "12"),
        h.Attribute("r", "8"),
        h.Attribute("fill", "currentColor"),
        h.Attribute("mask", "url(#moon-icon-mask)"),
      ],
      []
    ),
  ]);

export type ViewInputs = Readonly<{ renderLogoutButton: () => Html }>;

export const view = Submodel.defineView<Model, Message, ViewInputs>(
  (model, viewInputs) => {
    const h = html<Message>();

    const chartHost = (
      label: string,
      mountAction: Parameters<typeof h.OnMount>[0],
      heightClass: string
    ): Html =>
      h.div(
        [
          h.Class(`${heightClass} w-full`),
          h.AriaLabel(label),
          h.OnMount(mountAction),
        ],
        []
      );

    const STATUS_CLASSES: Record<CardStatus, string> = {
      good: "text-green-600 dark:text-green-400",
      warning: "text-amber-600 dark:text-amber-400",
      error: "text-red-600 dark:text-red-400",
    };

    const metricCard = (card: SummaryCard): Html =>
      h.div(
        [h.Class(`${CARD_CLASS} transition-shadow hover:shadow-md`)],
        [
          h.h3(
            [
              h.Class(
                "mb-3 text-sm font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400"
              ),
            ],
            [card.title]
          ),
          h.p(
            [
              h.Class(
                `text-3xl font-bold ${Option.match(card.status, {
                  onNone: () => "",
                  onSome: (status) => STATUS_CLASSES[status],
                })}`
              ),
            ],
            [
              card.value,
              ...Option.match(card.subtitle, {
                onNone: () => [],
                onSome: (subtitle) => [
                  h.span(
                    [
                      h.Class(
                        "ml-2 text-xs font-normal text-gray-500 dark:text-gray-400"
                      ),
                    ],
                    [subtitle]
                  ),
                ],
              }),
            ]
          ),
        ]
      );

    const rangeButton = (range: TimeRange, index: number) => {
      const isActive = model.timeRange === range;
      const roundingClass =
        index === 0
          ? "rounded-l-md"
          : index === TIME_RANGES.length - 1
            ? "rounded-r-md"
            : "";
      return h.button(
        [
          h.Type("button"),
          h.OnClick(ChangedTimeRange({ timeRange: range })),
          h.AriaPressed(String(isActive)),
          h.Class(
            `-ml-px cursor-pointer border px-3 py-2 text-sm font-semibold first:ml-0 ${roundingClass} ${
              isActive
                ? "border-blue-600 bg-blue-600 text-white hover:bg-blue-700"
                : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            }`
          ),
        ],
        [TIME_RANGE_LABELS[range]]
      );
    };

    const lastUpdatedIndicator = h.div(
      [
        h.Class(
          "flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400"
        ),
      ],
      [
        AsyncData.isRefreshing(model.metrics)
          ? h.span(
              [
                h.Role("status"),
                h.AriaLabel("Refreshing"),
                h.Class(
                  "h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600 dark:border-gray-600 dark:border-t-blue-400"
                ),
              ],
              []
            )
          : h.empty,
        Option.match(model.maybeLastUpdatedMs, {
          onNone: () => h.empty,
          onSome: (lastUpdatedMs) =>
            h.span(
              [h.DataAttribute("testid", "last-updated")],
              [`Updated ${formatDurationAgo(Date.now() - lastUpdatedMs)}`]
            ),
        }),
      ]
    );

    // Uses `getError` (spans Failure and Stale) rather than matchData's
    // onFailure (Failure only) so a refresh that fails after data already
    // loaded still surfaces the error, alongside the stale data matchData
    // keeps showing via onData.
    const errorAlert = (
      maybeError: Option.Option<string>,
      prefix: string
    ): Html =>
      Option.match(maybeError, {
        onNone: () => h.empty,
        onSome: (error) =>
          h.p(
            [
              h.Role("alert"),
              h.Class(
                "mb-4 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200"
              ),
            ],
            [warningIcon(), `${prefix}: ${error}`]
          ),
      });

    const metricsSummary = AsyncData.matchData(model.metrics, {
      onEmpty: () => h.p([], ["Loading metrics…"]),
      onFailure: () => h.empty,
      onData: () => h.empty,
    });
    const metricsError = errorAlert(
      AsyncData.getError(model.metrics),
      "Metrics error"
    );

    const speedStats = calculateSpeedStats(
      AsyncData.getOrElse(model.speedtestHistory, () => [])
    );

    const speedStatItem = (label: string, value: string): Html =>
      h.div(
        [],
        [
          h.p([h.Class("text-sm text-gray-500 dark:text-gray-400")], [label]),
          h.p([h.Class("text-lg font-bold")], [`${value} Mbps`]),
        ]
      );

    const speedStatsRow = h.div(
      [h.Class("mb-4 flex gap-6")],
      [
        speedStatItem("Avg Download", speedStats.avgDownload),
        speedStatItem("Avg Upload", speedStats.avgUpload),
        speedStatItem("Max Download", speedStats.maxDownload),
        speedStatItem("Max Upload", speedStats.maxUpload),
      ]
    );

    const speedtestHistorySummary = AsyncData.matchData(
      model.speedtestHistory,
      {
        onEmpty: () => h.p([], ["Loading speed test history…"]),
        onFailure: () => h.empty,
        onData: () => h.empty,
      }
    );
    const speedtestHistoryError = errorAlert(
      AsyncData.getError(model.speedtestHistory),
      "Speed test history error"
    );

    const connectivityStatusError = errorAlert(
      AsyncData.getError(model.connectivityStatus),
      "Connectivity status error"
    );

    const connectivityStatusSummary = AsyncData.matchData(
      model.connectivityStatus,
      {
        onEmpty: () => h.p([], ["Loading connectivity status…"]),
        onFailure: () => h.empty,
        onData: (status) => {
          const segments = mergeSegments(
            buildSegments(
              status.points,
              status.startTimeMs,
              status.endTimeMs,
              status.granularity
            )
          );

          const tooltip = Option.match(
            Option.flatMap(model.hoveredSegmentIndex, (index) =>
              Array_.get(segments, index)
            ),
            {
              onNone: () => h.empty,
              onSome: (segment) =>
                h.p(
                  [
                    h.Role("tooltip"),
                    h.Class("mt-2 text-xs text-gray-500 dark:text-gray-400"),
                  ],
                  [formatSegmentLabel(segment, status.granularity)]
                ),
            }
          );

          return h.div(
            [],
            [
              h.p(
                [h.Class("mb-4 text-sm text-gray-500 dark:text-gray-400")],
                [`Uptime: ${status.uptimePercentage.toFixed(1)}%`]
              ),
              h.div(
                [
                  h.Role("img"),
                  h.AriaLabel("Connectivity status timeline"),
                  h.Class(
                    "flex h-6 overflow-hidden rounded-md ring-1 ring-gray-200 dark:ring-gray-700"
                  ),
                ],
                Array_.map(segments, (segment, index) =>
                  h.div(
                    [
                      h.DataAttribute(
                        "testid",
                        `connectivity-segment-${index}`
                      ),
                      h.Style({
                        flex: `${segment.count} 1 0%`,
                        backgroundColor: CONNECTIVITY_COLORS[segment.status],
                      }),
                      h.OnMouseEnter(HoveredConnectivitySegment({ index })),
                      h.OnMouseLeave(UnhoveredConnectivitySegment()),
                    ],
                    []
                  )
                )
              ),
              tooltip,
            ]
          );
        },
      }
    );

    const network = networkInfo(
      AsyncData.getOrElse(model.speedtestHistory, () => [])
    );

    const isDark =
      Option.getOrElse(model.maybeTheme, () => "light" as const) === "dark";

    return h.div(
      [
        h.Class(
          `min-h-screen bg-gray-50 dark:bg-gray-900 dark:text-gray-100${isDark ? " dark" : ""}`
        ),
        h.DataAttribute("testid", "dashboard-root"),
      ],
      [
        h.div(
          [h.Class("mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8")],
          [
            h.div(
              [
                h.Class(
                  "mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between"
                ),
              ],
              [
                h.div(
                  [h.Class("flex-shrink-0")],
                  [
                    h.h2(
                      [h.Class("whitespace-nowrap text-3xl font-bold")],
                      ["WAN Monitor"]
                    ),
                    h.p(
                      [h.Class("text-sm text-gray-500 dark:text-gray-400")],
                      [
                        network.isp,
                        ...Option.match(network.maybeExternalIp, {
                          onNone: () => [],
                          onSome: (externalIp) => [` • ${externalIp}`],
                        }),
                      ]
                    ),
                  ]
                ),
                h.div(
                  [
                    h.Class(
                      "flex flex-wrap items-center justify-between gap-4 md:justify-end"
                    ),
                  ],
                  [
                    lastUpdatedIndicator,
                    h.button(
                      [
                        h.Type("button"),
                        h.OnClick(ClickedRefreshNow()),
                        h.Disabled(AsyncData.isPending(model.metrics)),
                        h.AriaLabel("Refresh now"),
                        h.Title("Refresh now"),
                        h.Class(GHOST_ICON_BUTTON_CLASS),
                      ],
                      [refreshIcon()]
                    ),
                    h.button(
                      [
                        h.Type("button"),
                        h.OnClick(ClickedTogglePause()),
                        h.AriaLabel(model.isPaused ? "Resume" : "Pause"),
                        h.Title(
                          model.isPaused
                            ? "Resume auto-refresh"
                            : "Pause auto-refresh"
                        ),
                        h.Class(GHOST_ICON_BUTTON_CLASS),
                      ],
                      [model.isPaused ? playIcon() : pauseIcon()]
                    ),
                    h.div(
                      [h.Class("inline-flex")],
                      Array_.map(TIME_RANGES, (range, index) =>
                        rangeButton(range, index)
                      )
                    ),
                    h.button(
                      [
                        h.Type("button"),
                        h.OnClick(ClickedToggleTheme()),
                        h.AriaLabel(isDark ? "Light mode" : "Dark mode"),
                        h.Title(
                          isDark
                            ? "Switch to light mode"
                            : "Switch to dark mode"
                        ),
                        h.Class(GHOST_ICON_BUTTON_CLASS),
                      ],
                      [isDark ? sunIcon() : moonIcon()]
                    ),
                    viewInputs.renderLogoutButton(),
                  ]
                ),
              ]
            ),
            h.div(
              [h.Class("mb-6 grid grid-cols-1 gap-4 md:grid-cols-3")],
              [
                metricCard(
                  connectivityCard(AsyncData.getOrElse(model.metrics, () => []))
                ),
                metricCard(
                  downloadSpeedCard(
                    AsyncData.getOrElse(model.speedtestHistory, () => [])
                  )
                ),
                metricCard(
                  uploadSpeedCard(
                    AsyncData.getOrElse(model.speedtestHistory, () => [])
                  )
                ),
              ]
            ),
            h.section(
              [h.Class(`${CARD_CLASS} mb-6`)],
              [
                h.h3([h.Class(SECTION_HEADING_CLASS)], ["Connectivity Status"]),
                connectivityStatusSummary,
                connectivityStatusError,
              ]
            ),
            h.section(
              [h.Class(`${CARD_CLASS} mb-6`)],
              [
                h.h3([h.Class(SECTION_HEADING_CLASS)], ["Network Quality"]),
                metricsSummary,
                metricsError,
                h.div(
                  [h.Class("flex flex-col gap-6")],
                  [
                    h.div(
                      [],
                      [
                        h.p([h.Class(CHART_LABEL_CLASS)], ["Latency (ms)"]),
                        chartHost(
                          "Latency chart",
                          MountLatencyChart({ hostId: LATENCY_CHART_HOST_ID }),
                          "h-[180px]"
                        ),
                      ]
                    ),
                    h.div(
                      [],
                      [
                        h.p([h.Class(CHART_LABEL_CLASS)], ["Packet Loss (%)"]),
                        chartHost(
                          "Packet loss chart",
                          MountPacketLossChart({
                            hostId: PACKET_LOSS_CHART_HOST_ID,
                          }),
                          "h-[180px]"
                        ),
                      ]
                    ),
                    h.div(
                      [],
                      [
                        h.p([h.Class(CHART_LABEL_CLASS)], ["Jitter (ms)"]),
                        chartHost(
                          "Jitter chart",
                          MountJitterChart({ hostId: JITTER_CHART_HOST_ID }),
                          "h-[180px]"
                        ),
                      ]
                    ),
                  ]
                ),
              ]
            ),
            h.section(
              [h.Class(CARD_CLASS)],
              [
                h.div(
                  [h.Class("mb-4 flex items-center justify-between")],
                  [
                    h.h3(
                      [h.Class("text-xl font-bold")],
                      ["Speed Test History"]
                    ),
                    h.button(
                      [
                        h.Type("button"),
                        h.OnClick(ClickedTriggerSpeedtest()),
                        h.Disabled(AsyncData.isPending(model.speedtestTrigger)),
                        h.Class(
                          "cursor-pointer rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                        ),
                      ],
                      [
                        AsyncData.isPending(model.speedtestTrigger)
                          ? "Running…"
                          : "Run Speed Test",
                      ]
                    ),
                  ]
                ),
                speedtestHistorySummary,
                speedtestHistoryError,
                speedStatsRow,
                chartHost(
                  "Speed chart",
                  MountSpeedChart({ hostId: SPEED_CHART_HOST_ID }),
                  "h-[250px]"
                ),
              ]
            ),
            h.submodel({
              slotId: "dashboard-toast",
              model: model.toast,
              view: Toast.view,
              viewInputs: {
                position: "BottomRight",
                entryClassName: "w-80",
                entryToView: (entry, handlers) => {
                  const variantClass =
                    entry.variant === "Success"
                      ? "border-l-4 border-l-green-500"
                      : entry.variant === "Warning"
                        ? "border-l-4 border-l-amber-500"
                        : entry.variant === "Error"
                          ? "border-l-4 border-l-red-500"
                          : "border-l-4 border-l-blue-500";
                  return h.div(
                    [
                      h.Class(
                        `rounded-lg border border-gray-200 bg-white p-4 shadow-lg dark:border-gray-700 dark:bg-gray-800 ${variantClass}`
                      ),
                    ],
                    [
                      h.div(
                        [h.Class("flex items-start justify-between gap-2")],
                        [
                          h.div(
                            [],
                            [
                              h.p(
                                [h.Class("text-sm font-semibold")],
                                [entry.payload.title]
                              ),
                              h.p(
                                [
                                  h.Class(
                                    "mt-1 text-sm text-gray-500 dark:text-gray-400"
                                  ),
                                ],
                                [entry.payload.description]
                              ),
                            ]
                          ),
                          h.button(
                            [
                              ...handlers.dismiss,
                              h.Class(
                                "cursor-pointer text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                              ),
                            ],
                            ["Close"]
                          ),
                        ]
                      ),
                    ]
                  );
                },
              },
              toParentMessage: (message) => GotToastMessage({ message }),
            }),
          ]
        ),
      ]
    );
  }
);
