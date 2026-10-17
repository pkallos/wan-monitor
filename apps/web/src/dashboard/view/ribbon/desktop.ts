import { Array as Array_, Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";
import { createLazy } from "foldkit/html";
import {
  CELL_CLASSES,
  type Cell,
  cellBody,
  cellTitle,
} from "@/dashboard/connectivity";
import {
  ClearedConnectivitySelection,
  HoveredConnectivitySegment,
  type Message,
  ToggledConnectivitySegment,
  UnhoveredConnectivitySegment,
} from "@/dashboard/message";
import type { ConnectivityStatusData, Model } from "@/dashboard/model";
import {
  axisTicks,
  describeRibbon,
  labelsClearOfNow,
} from "@/dashboard/ribbon";
import { MeasureRibbon } from "@/dashboard/ribbonMeasure";
import { chipLane, clusterLinesFor } from "@/dashboard/view/ribbon/chips";
import { CURRENT_OUTLINE, ribbonKeys } from "@/dashboard/view/ribbon/shared";
import {
  type Derived,
  derive,
  type Source,
  type SourceArgs,
  selectedArgs,
  sourceArgs,
  sourceOf,
} from "@/dashboard/view/ribbon/source";

const CELL_GAP_MAX_COUNT = 200;
const TOOLTIP_FLIP_FRACTION = 0.4;

// Selection is drawn by the overlay and the tooltip rather than by each cell,
// so the cells never change on hover and can be memoized as a whole.
const cellRow = (h: HtmlBuilder<Message>, ...args: SourceArgs) => {
  const source = sourceOf(args);
  const { cells } = derive(source);
  const gap = cells.length <= CELL_GAP_MAX_COUNT ? "mx-[0.4px]" : "";
  const ticks = axisTicks(cells, source.nowBucketMs);
  return h.div(
    [h.Class("relative")],
    [
      h.div(
        [
          h.Role("group"),
          h.AriaLabel(describeRibbon(cells, source.status.granularity)),
          h.DataAttribute("testid", "availability-ribbon"),
          h.Tabindex(0),
          h.OnBlur(ClearedConnectivitySelection()),
          ribbonKeys(h),
          h.Class("flex h-24 min-w-0 rounded-sm"),
        ],
        Array_.map(cells, (cell, index) =>
          h.div(
            [
              h.DataAttribute("testid", `connectivity-segment-${index}`),
              h.Class(
                `min-w-0 flex-1 ${gap} ${CELL_CLASSES[cell.status]} ${cell.isCurrent ? CURRENT_OUTLINE : ""}`.replace(
                  /\s+/g,
                  " "
                )
              ),
              h.OnMouseEnter(HoveredConnectivitySegment({ index })),
              h.OnMouseLeave(UnhoveredConnectivitySegment()),
              // Touch has no hover, so a tap toggles the same tooltip.
              h.OnClick(ToggledConnectivitySegment({ startMs: cell.startMs })),
            ],
            []
          )
        )
      ),
      ...Array_.flatMap(ticks, ({ fraction }) =>
        fraction === 0
          ? []
          : [
              h.span(
                [
                  h.AriaHidden(true),
                  h.Class(
                    "pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-card"
                  ),
                  h.Style({ left: `${fraction * 100}%` }),
                ],
                []
              ),
            ]
      ),
    ]
  );
};

const axis = (h: HtmlBuilder<Message>, ...args: SourceArgs) => {
  const source = sourceOf(args);
  const { cells } = derive(source);
  const ticks = axisTicks(cells, source.nowBucketMs);
  const hasNow = Array_.some(cells, (cell) => cell.isCurrent);
  return h.div(
    [h.AriaHidden(true)],
    [
      h.div(
        [h.Class("relative h-3")],
        Array_.map(ticks, ({ fraction }) =>
          h.span(
            [
              h.Class("absolute top-[3px] h-2 w-px bg-ink-2"),
              h.Style({ left: `${fraction * 100}%` }),
            ],
            []
          )
        )
      ),
      h.div(
        [h.Class("relative h-5")],
        [
          ...Array_.map(
            hasNow ? labelsClearOfNow(ticks, source.ribbonWidthPx) : ticks,
            ({ fraction, label }) =>
              h.span(
                [
                  h.Class(
                    `absolute top-0.5 whitespace-nowrap text-xs font-semibold text-ink-2 ${fraction === 0 ? "" : "pl-1"}`
                  ),
                  h.Style({ left: `${fraction * 100}%` }),
                ],
                [label]
              )
          ),
          hasNow
            ? h.span(
                [
                  h.Class(
                    "absolute right-0 top-0.5 text-xs font-bold text-ink"
                  ),
                ],
                ["Now"]
              )
            : h.empty,
        ]
      ),
    ]
  );
};

const tooltip = (
  h: HtmlBuilder<Message>,
  cells: ReadonlyArray<Cell>,
  index: number,
  granularity: ConnectivityStatusData["granularity"],
  clusterLines: ReadonlyArray<string>
): Html =>
  Option.match(Array_.get(cells, index), {
    onNone: () => h.empty,
    onSome: (cell) => {
      const flipsLeft = (index + 0.5) / cells.length > TOOLTIP_FLIP_FRACTION;
      return h.div(
        [
          h.Role("tooltip"),
          h.Class(
            "pointer-events-none absolute top-1/2 z-20 -translate-y-1/2 whitespace-nowrap rounded-[10px] bg-ink px-3 py-2 text-[13px] leading-[1.4] text-card shadow-lg dark:shadow-none"
          ),
          h.Style(
            flipsLeft
              ? {
                  right: `${(1 - index / cells.length) * 100}%`,
                  marginRight: "12px",
                }
              : {
                  left: `${((index + 1) / cells.length) * 100}%`,
                  marginLeft: "12px",
                }
          ),
        ],
        [
          h.span(
            [
              h.AriaHidden(true),
              h.Class(
                `absolute top-1/2 -mt-[5px] size-2.5 rotate-45 bg-ink ${flipsLeft ? "-right-[5px]" : "-left-[5px]"}`
              ),
            ],
            []
          ),
          h.span([h.Class("block font-bold")], [cellTitle(cell, granularity)]),
          h.span([h.Class("block")], [cellBody(cell)]),
          ...Array_.map(clusterLines, (line) =>
            h.span([h.Class("mt-1 block text-xs opacity-90")], [line])
          ),
        ]
      );
    },
  });

const selectionOutline = (
  h: HtmlBuilder<Message>,
  cellCount: number,
  index: number
): Html =>
  h.span(
    [
      h.AriaHidden(true),
      h.Class(
        "pointer-events-none absolute inset-y-0 z-10 outline outline-2 outline-offset-1 outline-ink"
      ),
      h.Style({
        left: `${(index / cellCount) * 100}%`,
        width: `${100 / cellCount}%`,
      }),
    ],
    []
  );

const desktopCells = createLazy();
const desktopAxis = createLazy();
const desktopChips = createLazy();

/** Chips over the cells, the cells with their tooltip, and the time axis; shown from `md` up. */
export const desktopRibbon = (
  h: HtmlBuilder<Message>,
  model: Model,
  source: Source,
  { cells, chips }: Derived,
  selectedIndex: number
): Html => {
  const activeIndex = Option.getOrElse(
    model.hoveredSegmentIndex,
    () => selectedIndex
  );
  const hasActive = activeIndex >= 0 && activeIndex < cells.length;
  return h.div(
    [h.Class("hidden md:block"), h.OnMount(MeasureRibbon())],
    [
      desktopChips(chipLane, [h, ...selectedArgs(source, selectedIndex)]),
      h.div(
        [h.Class("relative")],
        [
          desktopCells(cellRow, [h, ...sourceArgs(source)]),
          hasActive ? selectionOutline(h, cells.length, activeIndex) : h.empty,
          hasActive
            ? tooltip(
                h,
                cells,
                activeIndex,
                source.status.granularity,
                clusterLinesFor(chips, activeIndex, source.ribbonWidthPx)
              )
            : h.empty,
        ]
      ),
      desktopAxis(axis, [h, ...sourceArgs(source)]),
    ]
  );
};
