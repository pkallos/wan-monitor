import { Array as Array_, Option } from "effect";
import { AsyncData, Submodel } from "foldkit";
import type { Html } from "foldkit/html";
import { Moon, Pause, Play, RefreshCw, Sun, TriangleAlert } from "lucide";
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
  CONNECTIVITY_SEGMENT_CLASSES,
  formatSegmentLabel,
  formatUptimeSummary,
  mergeSegments,
} from "@/dashboard/connectivity";
import * as DateRangePicker from "@/dashboard/dateRangePicker";
import type { Message } from "@/dashboard/message";
import {
  ClickedRefreshNow,
  ClickedTogglePause,
  ClickedToggleTheme,
  ClickedTriggerSpeedtest,
  GotDateRangePickerMessage,
  GotToastMessage,
  HoveredConnectivitySegment,
  Interacted,
  UnhoveredConnectivitySegment,
} from "@/dashboard/message";
import type { Model } from "@/dashboard/model";
import {
  CHECKING_CONNECTIVITY_CARD,
  downloadSpeedCard,
  formatDurationAgo,
  liveConnectivityCard,
  networkInfo,
  type SummaryCard,
  uploadSpeedCard,
} from "@/dashboard/summaryCards";
import { Toast } from "@/dashboard/toast";
import { card } from "@/ui/card";
import { GHOST_ICON_BUTTON_CLASS, PRIMARY_BUTTON_CLASS } from "@/ui/controls";
import { icon } from "@/ui/icon";
import { sectionHeader } from "@/ui/sectionHeader";
import { skeleton } from "@/ui/skeleton";
import { statusBadge } from "@/ui/statusBadge";

const CHART_LABEL_CLASS = "mb-2 text-sm font-semibold text-ink-2";

const LOADING_TEXT_CLASS = "text-sm text-ink-2";

const CONNECTIVITY_VALUE_ICON_SIZE_PX = 28;

export type ViewInputs = Readonly<{ renderLogoutButton: () => Html }>;

export const view = Submodel.defineView<Model, Message, ViewInputs>(
  (model, viewInputs, h) => {
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

    // Only the connectivity card reports a status; the speed cards' "good"
    // just means a reading exists, so they stay in plain ink.
    const metricCard = (
      summaryCard: SummaryCard,
      { showStatus }: { showStatus: boolean }
    ): Html =>
      card(h, {}, [
        h.h3(
          [
            h.Class(
              "mb-3 text-xs font-semibold uppercase tracking-wide text-ink-2"
            ),
          ],
          [summaryCard.title]
        ),
        h.p(
          [h.Class("text-3xl font-semibold tracking-tight")],
          [
            Option.match(showStatus ? summaryCard.status : Option.none(), {
              onNone: () => summaryCard.value,
              onSome: (tone) =>
                statusBadge(h, {
                  tone,
                  label: summaryCard.value,
                  iconSize: CONNECTIVITY_VALUE_ICON_SIZE_PX,
                }),
            }),
            ...Option.match(summaryCard.subtitle, {
              onNone: () => [],
              onSome: (subtitle) => [
                h.span(
                  [h.Class("ml-2 text-xs font-normal text-ink-2")],
                  [subtitle]
                ),
              ],
            }),
          ]
        ),
      ]);

    const lastUpdatedIndicator = h.div(
      [h.Class("flex items-center gap-2 text-xs text-ink-2")],
      [
        AsyncData.isRefreshing(model.metrics)
          ? h.span(
              [
                h.Role("status"),
                h.AriaLabel("Refreshing"),
                h.Class(
                  "h-3 w-3 rounded-full border-2 border-rule border-t-accent motion-safe:animate-spin"
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
                "mb-4 flex items-center gap-2 rounded-xl border border-deg bg-deg-bg px-3 py-2 text-sm text-deg-text"
              ),
            ],
            [icon(h, TriangleAlert, { size: 16 }), `${prefix}: ${error}`]
          ),
      });

    const metricsSummary = AsyncData.matchData(model.metrics, {
      onEmpty: () => h.p([h.Class(LOADING_TEXT_CLASS)], ["Loading metrics…"]),
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
          h.p([h.Class("text-sm text-ink-2")], [label]),
          h.p([h.Class("text-lg font-semibold")], [`${value} Mbps`]),
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
        onEmpty: () =>
          h.p([h.Class(LOADING_TEXT_CLASS)], ["Loading speed test history…"]),
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
        onEmpty: () =>
          h.div(
            [],
            [
              h.p(
                [h.Class(`mb-2 ${LOADING_TEXT_CLASS}`)],
                ["Loading connectivity status…"]
              ),
              skeleton(h, "h-6 w-full"),
            ]
          ),
        onFailure: () => h.empty,
        onData: (status) => {
          const segments = mergeSegments(
            buildSegments(
              status.points,
              status.startTimeMs,
              status.endTimeMs,
              status.granularity,
              model.maybeEarliestDataMs
            )
          );

          const totalCount = Array_.reduce(
            segments,
            0,
            (sum, segment) => sum + segment.count
          );

          // Positioned as a percentage of the bar's width rather than tied to
          // the hovered segment's own DOM node, so it can float above the
          // bar's `overflow-hidden` (needed for the bar's rounded corners)
          // instead of being clipped by it.
          const tooltip = Option.match(
            Option.flatMap(model.hoveredSegmentIndex, (index) =>
              Option.map(Array_.get(segments, index), (segment) => {
                const before = Array_.reduce(
                  Array_.take(segments, index),
                  0,
                  (sum, s) => sum + s.count
                );
                const centerPercent =
                  ((before + segment.count / 2) / totalCount) * 100;
                return { segment, centerPercent };
              })
            ),
            {
              onNone: () => h.empty,
              onSome: ({ segment, centerPercent }) =>
                h.div(
                  [
                    h.Role("tooltip"),
                    h.Style({ left: `${centerPercent}%` }),
                    h.Class(
                      "pointer-events-none absolute bottom-full z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink px-2 py-1 text-xs text-bg"
                    ),
                  ],
                  [formatSegmentLabel(segment, status.granularity)]
                ),
            }
          );

          return h.div(
            [],
            [
              h.p(
                [h.Class("mb-4 text-sm text-ink-2")],
                [formatUptimeSummary(status)]
              ),
              h.div(
                [h.Class("relative")],
                [
                  h.div(
                    [
                      h.Role("img"),
                      h.AriaLabel("Connectivity status timeline"),
                      h.Class(
                        "flex h-6 overflow-hidden rounded-lg ring-1 ring-rule"
                      ),
                    ],
                    Array_.map(segments, (segment, index) => {
                      const isShowingThisSegment = Option.contains(
                        model.hoveredSegmentIndex,
                        index
                      );
                      return h.div(
                        [
                          h.DataAttribute(
                            "testid",
                            `connectivity-segment-${index}`
                          ),
                          h.Class(CONNECTIVITY_SEGMENT_CLASSES[segment.status]),
                          h.Style({ flex: `${segment.count} 1 0%` }),
                          h.OnMouseEnter(HoveredConnectivitySegment({ index })),
                          h.OnMouseLeave(UnhoveredConnectivitySegment()),
                          // Hover has no equivalent on touch devices, so a tap
                          // toggles the same tooltip state directly: shows it
                          // on first tap, dismisses it on a second tap of the
                          // same segment.
                          h.OnClick(
                            isShowingThisSegment
                              ? UnhoveredConnectivitySegment()
                              : HoveredConnectivitySegment({ index })
                          ),
                        ],
                        []
                      );
                    })
                  ),
                  tooltip,
                ]
              ),
            ]
          );
        },
      }
    );

    // A failed fetch says nothing about the WAN, so it renders as the same
    // grey "No Data" the server reports for a silent monitor — never as an
    // outage.
    const liveConnectivityCardForModel = AsyncData.matchData(
      model.liveConnectivity,
      {
        onEmpty: () => CHECKING_CONNECTIVITY_CARD,
        onFailure: () =>
          liveConnectivityCard(
            { status: "noInfo", maybeLastSampleAtMs: Option.none() },
            Date.now()
          ),
        onData: (live) => liveConnectivityCard(live, Date.now()),
      }
    );

    const network = networkInfo(
      AsyncData.getOrElse(model.speedtestHistory, () => [])
    );

    const isDark = model.theme === "dark";

    return h.div(
      [
        h.Class("min-h-screen bg-bg text-ink"),
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
                      [
                        h.Class(
                          "whitespace-nowrap text-3xl font-semibold tracking-tight"
                        ),
                      ],
                      ["WAN Monitor"]
                    ),
                    h.p(
                      [h.Class("text-sm text-ink-2")],
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
                      [icon(h, RefreshCw)]
                    ),
                    h.button(
                      [
                        h.Type("button"),
                        h.OnClick(
                          model.isIdle ? Interacted() : ClickedTogglePause()
                        ),
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
                              ? "Auto-refresh paused after inactivity — resume"
                              : "Pause auto-refresh"
                        ),
                        h.Class(GHOST_ICON_BUTTON_CLASS),
                      ],
                      [icon(h, model.isPaused || model.isIdle ? Play : Pause)]
                    ),
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
                      [icon(h, isDark ? Sun : Moon)]
                    ),
                    viewInputs.renderLogoutButton(),
                  ]
                ),
              ]
            ),
            h.div(
              [h.Class("mb-6 grid grid-cols-1 gap-4 md:grid-cols-3")],
              [
                metricCard(liveConnectivityCardForModel, { showStatus: true }),
                metricCard(
                  downloadSpeedCard(
                    AsyncData.getOrElse(model.speedtestHistory, () => [])
                  ),
                  { showStatus: false }
                ),
                metricCard(
                  uploadSpeedCard(
                    AsyncData.getOrElse(model.speedtestHistory, () => [])
                  ),
                  { showStatus: false }
                ),
              ]
            ),
            card(h, { as: "section", className: "mb-6" }, [
              sectionHeader(h, { title: "Connectivity Status" }),
              connectivityStatusSummary,
              connectivityStatusError,
            ]),
            card(h, { as: "section", className: "mb-6" }, [
              sectionHeader(h, { title: "Network Quality" }),
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
            ]),
            card(h, { as: "section" }, [
              sectionHeader(h, {
                title: "Speed Test History",
                actions: h.button(
                  [
                    h.Type("button"),
                    h.OnClick(ClickedTriggerSpeedtest()),
                    h.Disabled(AsyncData.isPending(model.speedtestTrigger)),
                    h.Class(PRIMARY_BUTTON_CLASS),
                  ],
                  [
                    AsyncData.isPending(model.speedtestTrigger)
                      ? "Running…"
                      : "Run Speed Test",
                  ]
                ),
              }),
              speedtestHistorySummary,
              speedtestHistoryError,
              speedStatsRow,
              chartHost(
                "Speed chart",
                MountSpeedChart({ hostId: SPEED_CHART_HOST_ID }),
                "h-[250px]"
              ),
            ]),
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
                      ? "border-l-4 border-l-up"
                      : entry.variant === "Warning"
                        ? "border-l-4 border-l-deg"
                        : entry.variant === "Error"
                          ? "border-l-4 border-l-down"
                          : "border-l-4 border-l-accent";
                  return h.div(
                    [
                      h.Class(
                        `rounded-xl border border-rule bg-card p-4 shadow-lg dark:shadow-none ${variantClass}`
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
                                [h.Class("mt-1 text-sm text-ink-2")],
                                [entry.payload.description]
                              ),
                            ]
                          ),
                          h.button(
                            [
                              ...handlers.dismiss,
                              h.Class(
                                "cursor-pointer text-ink-2 hover:text-ink"
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
