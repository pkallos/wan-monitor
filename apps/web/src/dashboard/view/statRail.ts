import { Array as Array_, Option } from "effect";
import { AsyncData } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import type { Message } from "@/dashboard/message";
import type { Model } from "@/dashboard/model";
import {
  type RailStat,
  railStats,
  unreportedRailStats,
} from "@/dashboard/overview";
import { summaryOf } from "@/dashboard/view/derived";
import { failedLine } from "@/ui/failedLine";
import { skeleton } from "@/ui/skeleton";

const CELL_CLASS =
  "min-w-0 rounded-[14px] border border-field-rule bg-card p-3.5 first:col-span-2 lg:col-span-1 lg:rounded-none lg:border-0 lg:border-l lg:border-rule lg:bg-transparent lg:px-5 lg:py-4 lg:first:col-span-1 lg:first:border-l-0";

const RAIL_HEADING_ID = "range-summary-heading";

const cell = (h: HtmlBuilder<Message>, stat: RailStat): Html =>
  h.div(
    [h.Class(CELL_CLASS), h.DataAttribute("testid", `rail-${stat.key}`)],
    [
      h.h3(
        [h.Class("text-[13px] font-semibold tracking-[0.01em] text-ink-2")],
        [stat.label]
      ),
      h.p(
        [
          h.Class(
            "mt-1 whitespace-nowrap text-[26px] font-semibold leading-[1.1] tracking-[-0.02em] lg:text-[30px]"
          ),
        ],
        [
          stat.unit === "%" ? stat.value : `${stat.value} `,
          h.span(
            [
              h.Class(
                "text-sm font-medium tracking-normal text-ink-2 lg:text-[15px]"
              ),
            ],
            [stat.unit]
          ),
        ]
      ),
      h.p([h.Class("mt-0.5 text-[13px] text-ink-2")], [stat.sub]),
    ]
  );

const loadingCell = (h: HtmlBuilder<Message>, { label }: RailStat): Html =>
  h.div(
    [h.Class(CELL_CLASS)],
    [
      h.h3(
        [h.Class("text-[13px] font-semibold tracking-[0.01em] text-ink-2")],
        [label]
      ),
      h.div(
        [
          h.Role("status"),
          h.AriaLabel(`Loading ${label.toLowerCase()}`),
          h.Class("mt-1 flex flex-col"),
        ],
        [
          skeleton(h, "h-[29px] w-24 lg:h-[33px]"),
          skeleton(h, "mt-0.5 h-5 w-20"),
        ]
      ),
    ]
  );

const failedCell = (h: HtmlBuilder<Message>): Html =>
  failedLine(
    h,
    "Could not load the range summary.",
    "col-span-full rounded-[14px] border border-field-rule bg-card p-3.5 text-sm text-ink-2 lg:rounded-none lg:border-0 lg:bg-transparent lg:px-5 lg:py-4"
  );

/** Latency, loss, jitter and the median speeds for the range. */
export const statRail = (h: HtmlBuilder<Message>, model: Model): Html =>
  h.section(
    [
      h.AriaLabelledBy(RAIL_HEADING_ID),
      h.Class("-mt-1 mb-5 lg:col-span-2 lg:mb-8 lg:mt-0 xl:col-span-1"),
    ],
    [
      h.h2([h.Id(RAIL_HEADING_ID), h.Class("sr-only")], ["Range summary"]),
      h.div(
        [
          h.Class(
            "grid grid-cols-2 gap-2.5 lg:grid-cols-5 lg:gap-0 lg:rounded-2xl lg:border lg:border-field-rule lg:bg-card"
          ),
        ],
        Option.match(summaryOf(model), {
          onSome: (summary) =>
            Array_.map(railStats(summary), (stat) => cell(h, stat)),
          onNone: () =>
            AsyncData.hasError(model.summary)
              ? [failedCell(h)]
              : Array_.map(unreportedRailStats, (stat) => loadingCell(h, stat)),
        })
      ),
    ]
  );
