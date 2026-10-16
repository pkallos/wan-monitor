import { Array as Array_, Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";
import {
  CELL_CLASSES,
  type Cell,
  cellBody,
  cellTitle,
} from "@/dashboard/connectivity";
import { type Message, ToggledConnectivitySegment } from "@/dashboard/message";
import type { ConnectivityStatusData } from "@/dashboard/model";
import {
  dayRows,
  describeRibbon,
  type IncidentChip,
  stacksByDay,
} from "@/dashboard/ribbon";
import { chipButton } from "@/dashboard/view/ribbon/chips";
import {
  CURRENT_OUTLINE,
  describeCell,
  ribbonKeys,
  SELECTED_OUTLINE,
} from "@/dashboard/view/ribbon/shared";
import {
  derive,
  type SelectedArgs,
  splitSelected,
} from "@/dashboard/view/ribbon/source";

type Granularity = ConnectivityStatusData["granularity"];

/** A row holds a day's hourly cells, or this many cells of a shorter bucket. */
const CELLS_PER_ROW = 24;

// Rows of cells have no focus stops of their own: the group is the one tab
// stop and arrow keys move the pinned cell, as on the desktop ribbon.
const tapCell = (
  h: HtmlBuilder<Message>,
  cell: Cell,
  index: number,
  isSelected: boolean,
  granularity: Granularity
): Html =>
  h.button(
    [
      h.Type("button"),
      h.Tabindex(-1),
      h.DataAttribute("testid", `ribbon-day-cell-${index}`),
      h.AriaLabel(describeCell(cell, granularity)),
      h.AriaPressed(String(isSelected)),
      h.OnClick(ToggledConnectivitySegment({ startMs: cell.startMs })),
      h.Class(
        `h-6 min-w-0 cursor-pointer p-0 shadow-[inset_-1px_-1px_0_0_var(--card)] ${CELL_CLASSES[cell.status]} ${
          isSelected ? SELECTED_OUTLINE : cell.isCurrent ? CURRENT_OUTLINE : ""
        }`
      ),
    ],
    []
  );

const cellGrid = (
  h: HtmlBuilder<Message>,
  columnCount: number,
  children: ReadonlyArray<Html>
): Html =>
  h.div(
    [
      h.DataAttribute("testid", "ribbon-cell-row"),
      h.Class("grid"),
      h.Style({
        gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
      }),
    ],
    children
  );

const HOUR_LABELS: ReadonlyArray<string> = ["00", "06", "12", "18"];

const hourAxis = (h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.AriaHidden(true), h.Class("grid grid-cols-4 text-xs text-ink-2")],
    Array_.map(HOUR_LABELS, (label) => h.span([], [label]))
  );

const dayStack = (
  h: HtmlBuilder<Message>,
  cells: ReadonlyArray<Cell>,
  chips: ReadonlyArray<IncidentChip>,
  selectedIndex: number,
  granularity: Granularity,
  nowMs: number
): Html =>
  h.div(
    [
      h.DataAttribute("testid", "ribbon-day-stack"),
      h.Class("flex flex-col gap-3"),
    ],
    [
      hourAxis(h),
      ...Array_.map(dayRows(cells, nowMs, chips), (row) =>
        h.div(
          [
            h.DataAttribute("testid", "ribbon-day-row"),
            h.Class("flex flex-col gap-1"),
          ],
          [
            h.div(
              [h.Class("flex items-baseline justify-between gap-2")],
              [
                h.span(
                  [h.Class("text-[13px] font-semibold text-ink-2")],
                  [row.label]
                ),
                h.span(
                  [h.Class("text-xs font-bold text-ink")],
                  [row.refs.join(" ")]
                ),
              ]
            ),
            cellGrid(
              h,
              row.slots.length,
              Array_.map(row.slots, (slot) =>
                Option.match(slot, {
                  onNone: () =>
                    h.span(
                      [
                        h.AriaHidden(true),
                        h.DataAttribute("testid", "ribbon-day-spacer"),
                        h.Class("h-6"),
                      ],
                      []
                    ),
                  onSome: ({ cell, index }) =>
                    tapCell(
                      h,
                      cell,
                      index,
                      index === selectedIndex,
                      granularity
                    ),
                })
              )
            ),
          ]
        )
      ),
    ]
  );

const wrappedRows = (
  h: HtmlBuilder<Message>,
  cells: ReadonlyArray<Cell>,
  selectedIndex: number,
  granularity: Granularity
): Html =>
  h.div(
    [
      h.DataAttribute("testid", "ribbon-wrapped-rows"),
      h.Class("flex flex-col"),
    ],
    Array_.map(
      Array_.chunksOf(
        Array_.map(cells, (cell, index) => ({ cell, index })),
        CELLS_PER_ROW
      ),
      (row) =>
        cellGrid(
          h,
          CELLS_PER_ROW,
          Array_.map(row, ({ cell, index }) =>
            tapCell(h, cell, index, index === selectedIndex, granularity)
          )
        )
    )
  );

/** The ribbon for a phone: tappable cells, the pinned cell's detail, and touch-sized incident chips; hidden from `md` up. */
export const mobileRibbon = (
  h: HtmlBuilder<Message>,
  ...args: SelectedArgs
) => {
  const { source, selectedIndex } = splitSelected(args);
  const { granularity } = source.status;
  const { cells, chips, hosts } = derive(source);
  return h.div(
    [h.Class("md:hidden")],
    [
      h.div(
        [
          h.Role("group"),
          h.AriaLabel(describeRibbon(cells, granularity)),
          h.DataAttribute("testid", "availability-ribbon-touch"),
          h.Tabindex(0),
          ribbonKeys(h),
        ],
        [
          stacksByDay(cells, granularity)
            ? dayStack(
                h,
                cells,
                chips,
                selectedIndex,
                granularity,
                source.nowBucketMs
              )
            : wrappedRows(h, cells, selectedIndex, granularity),
        ]
      ),
      ...Option.match(Array_.get(cells, selectedIndex), {
        onNone: () => [],
        onSome: (cell) => [
          h.div(
            [
              h.AriaHidden(true),
              h.Class(
                "mt-2.5 rounded-[10px] bg-ink px-3 py-2.5 text-sm leading-[1.4] text-card"
              ),
            ],
            [
              h.span(
                [h.Class("block font-bold")],
                [cellTitle(cell, granularity)]
              ),
              h.span([h.Class("block")], [cellBody(cell)]),
            ]
          ),
        ],
      }),
      h.div(
        [h.Class("mt-3 flex flex-wrap gap-2")],
        Array_.map(chips, (chip) =>
          chipButton(h, chip, chip.cellIndex === selectedIndex, hosts, "touch")
        )
      ),
    ]
  );
};
