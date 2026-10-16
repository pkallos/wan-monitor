import { Array as Array_, Option } from "effect";
import { AsyncData } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { type HostRow, hostRows, hostsCaption } from "@/dashboard/hostRows";
import type { Message } from "@/dashboard/message";
import type { Model } from "@/dashboard/model";
import { configuredHosts, summaryOf } from "@/dashboard/view/derived";
import { card } from "@/ui/card";
import { failedLine } from "@/ui/failedLine";
import { sectionHeader } from "@/ui/sectionHeader";
import { skeleton } from "@/ui/skeleton";
import { type GlyphKind, statusGlyph } from "@/ui/statusGlyph";
import {
  scrollableTable,
  TABLE_TD_CLASS,
  TABLE_TD_WRAP_CLASS,
  TABLE_TH_CLASS,
} from "@/ui/table";

const HOST_GLYPHS: Record<HostRow["tone"], GlyphKind> = {
  good: "healthy",
  warning: "degraded",
  error: "outage",
  none: "noData",
};

const GLYPH_PX = 14;

const hostStatus = (h: HtmlBuilder<Message>, row: HostRow): Html =>
  h.span(
    [h.Class("inline-flex items-center gap-2 font-semibold")],
    [
      statusGlyph(h, HOST_GLYPHS[row.tone], GLYPH_PX),
      h.span([], [row.statusWord]),
    ]
  );

const COLUMNS = [
  ["Host", false],
  ["Last status", false],
  ["p50 latency", true],
  ["p95 latency", true],
  ["Packet loss", true],
  ["Jitter", true],
  ["Availability", true],
] as const;

const table = (h: HtmlBuilder<Message>, rows: ReadonlyArray<HostRow>): Html =>
  h.table(
    [
      h.AriaLabel("Per-host statistics"),
      h.Class("w-full border-collapse text-[15px]"),
    ],
    [
      h.thead(
        [],
        [
          h.tr(
            [],
            Array_.map(COLUMNS, ([label, isNumeric]) =>
              h.th(
                [
                  h.Attribute("scope", "col"),
                  h.Class(
                    `${TABLE_TH_CLASS} ${isNumeric ? "text-right" : "text-left"}`
                  ),
                ],
                [label]
              )
            )
          ),
        ]
      ),
      h.tbody(
        [],
        Array_.map(rows, (row) =>
          h.tr(
            [h.DataAttribute("testid", `host-row-${row.host}`)],
            [
              h.th(
                [
                  h.Attribute("scope", "row"),
                  h.Class(`${TABLE_TD_WRAP_CLASS} text-left font-semibold`),
                ],
                [row.host]
              ),
              h.td([h.Class(TABLE_TD_CLASS)], [hostStatus(h, row)]),
              ...Array_.map(
                [row.p50, row.p95, row.loss, row.jitter, row.availability],
                (value) =>
                  h.td([h.Class(`${TABLE_TD_CLASS} text-right`)], [value])
              ),
            ]
          )
        )
      ),
    ]
  );

const stat = (h: HtmlBuilder<Message>, label: string, value: string): Html =>
  h.div(
    [],
    [
      h.dt([h.Class("text-xs font-semibold text-ink-2")], [label]),
      h.dd([h.Class("mt-0.5 text-base font-semibold")], [value]),
    ]
  );

const stackedList = (
  h: HtmlBuilder<Message>,
  rows: ReadonlyArray<HostRow>
): Html =>
  h.ul(
    [h.Class("m-0 grid list-none gap-2.5 p-0 md:hidden")],
    Array_.map(rows, (row) =>
      h.li(
        [
          h.Class("min-w-0 rounded-xl border border-rule bg-bg p-3.5"),
          h.DataAttribute("testid", `host-card-${row.host}`),
        ],
        [
          h.div(
            [h.Class("flex items-center justify-between gap-2")],
            [
              h.strong(
                [h.Class("min-w-0 break-words text-base font-semibold")],
                [row.host]
              ),
              hostStatus(h, row),
            ]
          ),
          h.dl(
            [h.Class("m-0 mt-3 grid grid-cols-3 gap-x-3 gap-y-2.5")],
            [
              stat(h, "p50 latency", row.p50),
              stat(h, "p95 latency", row.p95),
              stat(h, "Packet loss", row.loss),
              stat(h, "Jitter", row.jitter),
              stat(h, "Availability", row.availability),
            ]
          ),
        ]
      )
    )
  );

/** One row per ping target over the selected range: where the latency and loss come from. */
export const hostsCard = (h: HtmlBuilder<Message>, model: Model): Html => {
  const subtitle = Option.match(AsyncData.getData(model.pingHosts), {
    onNone: () => undefined,
    onSome: ({ hosts, pingIntervalSeconds }) =>
      hostsCaption(hosts.length, pingIntervalSeconds),
  });

  return card(h, { as: "section", className: "min-w-0" }, [
    sectionHeader(h, { title: "Hosts", subtitle }),
    Option.match(summaryOf(model), {
      onSome: ({ hosts }) => {
        const rows = hostRows(hosts, configuredHosts(model));
        return rows.length === 0
          ? h.p(
              [h.Class("text-[15px] text-ink-2")],
              ["No host data in this range."]
            )
          : h.div(
              [],
              [scrollableTable(h, table(h, rows)), stackedList(h, rows)]
            );
      },
      onNone: () =>
        AsyncData.hasError(model.summary)
          ? failedLine(h, "Could not load hosts.")
          : h.div(
              [
                h.Role("status"),
                h.AriaLabel("Loading hosts"),
                h.Class("flex flex-col gap-2"),
              ],
              [
                skeleton(h, "h-10 w-full"),
                skeleton(h, "h-10 w-full"),
                skeleton(h, "h-10 w-full"),
              ]
            ),
    }),
  ]);
};
