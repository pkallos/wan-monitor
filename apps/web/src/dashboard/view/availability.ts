import { Array as Array_, Option } from "effect";
import { AsyncData } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import {
  buildSegments,
  CONNECTIVITY_SEGMENT_CLASSES,
  formatSegmentLabel,
  formatUptimeSummary,
  mergeSegments,
  type SegmentStatus,
} from "@/dashboard/connectivity";
import {
  HoveredConnectivitySegment,
  type Message,
  UnhoveredConnectivitySegment,
} from "@/dashboard/message";
import type { ConnectivityStatusData, Model } from "@/dashboard/model";
import { card } from "@/ui/card";
import { sectionHeader } from "@/ui/sectionHeader";
import { skeleton } from "@/ui/skeleton";

const timeline = (
  h: HtmlBuilder<Message>,
  model: Model,
  status: ConnectivityStatusData
): Html => {
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

  // Positioned by percentage of the bar's width, not inside the segment, so
  // the bar's `overflow-hidden` rounded corners don't clip it.
  const tooltip = Option.match(
    Option.flatMap(model.hoveredSegmentIndex, (index) =>
      Option.map(Array_.get(segments, index), (segment) => {
        const before = Array_.reduce(
          Array_.take(segments, index),
          0,
          (sum, s) => sum + s.count
        );
        const centerPercent = ((before + segment.count / 2) / totalCount) * 100;
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
      h.p([h.Class("mb-4 text-sm text-ink-2")], [formatUptimeSummary(status)]),
      h.div(
        [h.Class("relative")],
        [
          h.div(
            [
              h.Role("img"),
              h.AriaLabel("Connectivity status timeline"),
              h.Class("flex h-6 overflow-hidden rounded-lg ring-1 ring-rule"),
            ],
            Array_.map(segments, (segment, index) => {
              const isShowingThisSegment = Option.contains(
                model.hoveredSegmentIndex,
                index
              );
              return h.div(
                [
                  h.DataAttribute("testid", `connectivity-segment-${index}`),
                  h.Class(CONNECTIVITY_SEGMENT_CLASSES[segment.status]),
                  h.Style({ flex: `${segment.count} 1 0%` }),
                  h.OnMouseEnter(HoveredConnectivitySegment({ index })),
                  h.OnMouseLeave(UnhoveredConnectivitySegment()),
                  // Touch has no hover, so a tap toggles the same tooltip.
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
};

const LEGEND: ReadonlyArray<readonly [SegmentStatus, string]> = [
  ["up", "Up"],
  ["degraded", "Degraded"],
  ["down", "Down"],
  ["noInfo", "No data"],
];

// Each swatch repeats the timeline's own fill, pattern included, so the key
// reads the same without colour.
const legend = (h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.Class(
        "flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-ink-2"
      ),
    ],
    Array_.map(LEGEND, ([status, label]) =>
      h.span(
        [h.Class("inline-flex items-center gap-1.5")],
        [
          h.span(
            [
              h.AriaHidden(true),
              h.Class(
                `inline-block h-3 w-[18px] rounded-sm ${CONNECTIVITY_SEGMENT_CLASSES[status]}`
              ),
            ],
            []
          ),
          label,
        ]
      )
    )
  );

export const availabilityCard = (h: HtmlBuilder<Message>, model: Model): Html =>
  card(h, { as: "section", className: "min-w-0" }, [
    sectionHeader(h, {
      title: "Availability",
      actions: legend(h),
    }),
    AsyncData.matchData(model.connectivityStatus, {
      onEmpty: () =>
        h.div(
          [
            h.Role("status"),
            h.AriaLabel("Loading availability"),
            h.Class("flex flex-col gap-4"),
          ],
          [skeleton(h, "h-4 w-48"), skeleton(h, "h-6 w-full")]
        ),
      onFailure: () => h.empty,
      onData: (status) => timeline(h, model, status),
    }),
  ]);
