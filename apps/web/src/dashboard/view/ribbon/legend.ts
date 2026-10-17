import { Array as Array_ } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";
import {
  CELL_CLASSES,
  CELL_LABELS,
  type Cell,
  type CellStatus,
} from "@/dashboard/connectivity";
import type { Message } from "@/dashboard/message";

const ALWAYS_LISTED: ReadonlyArray<CellStatus> = [
  "up",
  "degraded",
  "down",
  "noInfo",
];

const listedStatuses = (
  cells: ReadonlyArray<Cell>
): ReadonlyArray<CellStatus> => [
  ...ALWAYS_LISTED,
  ...(Array_.some(cells, (cell) => cell.status === "notMonitored")
    ? (["notMonitored"] as const)
    : []),
];

// Each swatch repeats the ribbon's own fill, pattern included, so the key
// reads the same without colour.
export const legend = (
  h: HtmlBuilder<Message>,
  cells: ReadonlyArray<Cell>
): Html =>
  h.div(
    [
      h.Class(
        "flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[13px] text-ink-2"
      ),
    ],
    Array_.map(listedStatuses(cells), (status) =>
      h.span(
        [h.Class("inline-flex items-center gap-1.5")],
        [
          h.span(
            [
              h.AriaHidden(true),
              h.Class(
                `inline-block h-3 w-[18px] rounded-sm ${CELL_CLASSES[status]}`
              ),
            ],
            []
          ),
          CELL_LABELS[status],
        ]
      )
    )
  );
