import type {
  GetOutagesResponseType,
  Outage,
} from "@shared/api/routes/connectivity-status";
import { Array as Array_, Option } from "effect";
import { AsyncData } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { CELL_LABELS } from "@/dashboard/connectivity";
import { formatDateTime, formatDuration } from "@/dashboard/format";
import {
  affectedHostsText,
  assignIncidents,
  describeIncidents,
  incidentDetails,
  lossText,
  outageLogPhrase,
  outageTotals,
  peakText,
} from "@/dashboard/incidents";
import type { Message } from "@/dashboard/message";
import type { Model } from "@/dashboard/model";
import { describeRange } from "@/dashboard/overview";
import {
  configuredHosts,
  currentOutages,
  openIncidentOf,
} from "@/dashboard/view/derived";
import { card } from "@/ui/card";
import { failedLine } from "@/ui/failedLine";
import { refBadge } from "@/ui/refBadge";
import { sectionHeader } from "@/ui/sectionHeader";
import { skeleton } from "@/ui/skeleton";
import { type GlyphKind, statusGlyph } from "@/ui/statusGlyph";
import {
  scrollableTable,
  TABLE_TD_CLASS,
  TABLE_TD_WRAP_CLASS,
  TABLE_TH_CLASS,
} from "@/ui/table";

const BADGE_PX = 26;
const GLYPH_PX = 14;

const OUTAGE_GLYPHS: Record<Outage["status"], GlyphKind> = {
  down: "outage",
  degraded: "degraded",
};

const statusCell = (h: HtmlBuilder<Message>, outage: Outage): Html =>
  h.span(
    [h.Class("inline-flex items-center gap-2 text-[15px] font-semibold")],
    [
      statusGlyph(h, OUTAGE_GLYPHS[outage.status], GLYPH_PX),
      h.span([], [CELL_LABELS[outage.status]]),
    ]
  );

type Entry = Readonly<{
  outage: Outage;
  ref: string;
  hosts: string;
  isOngoing: boolean;
}>;

const entriesOf = (
  model: Model,
  outages: ReadonlyArray<Outage>
): ReadonlyArray<Entry> => {
  const configured = configuredHosts(model);
  const open = openIncidentOf(model);
  return Array_.zipWith(
    outages,
    assignIncidents(outages),
    (outage, { ref }) => ({
      outage,
      ref,
      hosts: affectedHostsText(outage.affectedHosts, configured),
      isOngoing: Option.exists(open, (incident) => incident === outage),
    })
  );
};

const endText = ({ outage, isOngoing }: Entry): string =>
  isOngoing ? "-" : formatDateTime(outage.end);

const spanText = (entry: Entry): string =>
  entry.isOngoing
    ? `Since ${formatDateTime(entry.outage.start)}`
    : `${formatDateTime(entry.outage.start)} – ${endText(entry)}`;

const durationText = ({ outage, isOngoing }: Entry): string =>
  isOngoing ? "Ongoing" : formatDuration(outage.durationSeconds);

const durationClass = (entry: Entry): string =>
  entry.isOngoing ? "font-semibold text-deg-text" : "font-semibold";

const COLUMNS = [
  ["Ref", ""],
  ["Start", ""],
  ["End", ""],
  ["Duration", "text-right"],
  ["Status", ""],
  ["Hosts", ""],
  ["Max loss", "text-right"],
  ["Peak latency", "text-right"],
] as const;

const table = (h: HtmlBuilder<Message>, entries: ReadonlyArray<Entry>): Html =>
  scrollableTable(
    h,
    h.table(
      [
        h.AriaLabel("Incidents in the selected range"),
        h.Class("w-full border-collapse text-sm"),
      ],
      [
        h.thead(
          [],
          [
            h.tr(
              [],
              Array_.map(COLUMNS, ([label, align]) =>
                h.th(
                  [
                    h.Attribute("scope", "col"),
                    h.Class(`${TABLE_TH_CLASS} ${align || "text-left"}`),
                  ],
                  [label]
                )
              )
            ),
          ]
        ),
        h.tbody(
          [],
          Array_.map(entries, (entry) =>
            h.tr(
              [h.DataAttribute("testid", `incident-row-${entry.ref}`)],
              [
                h.th(
                  [
                    h.Attribute("scope", "row"),
                    h.Class(`${TABLE_TD_CLASS} text-left`),
                  ],
                  [refBadge(h, entry.ref, entry.outage.status, BADGE_PX)]
                ),
                h.td(
                  [h.Class(TABLE_TD_CLASS)],
                  [formatDateTime(entry.outage.start)]
                ),
                h.td([h.Class(TABLE_TD_CLASS)], [endText(entry)]),
                h.td(
                  [
                    h.Class(
                      `${TABLE_TD_CLASS} text-right ${durationClass(entry)}`
                    ),
                  ],
                  [durationText(entry)]
                ),
                h.td([h.Class(TABLE_TD_CLASS)], [statusCell(h, entry.outage)]),
                h.td([h.Class(TABLE_TD_WRAP_CLASS)], [entry.hosts]),
                h.td(
                  [h.Class(`${TABLE_TD_CLASS} text-right`)],
                  [lossText(entry.outage.maxPacketLoss)]
                ),
                h.td(
                  [h.Class(`${TABLE_TD_CLASS} text-right`)],
                  [peakText(entry.outage.peakLatency)]
                ),
              ]
            )
          )
        ),
      ]
    ),
    { from: "lg" }
  );

const stackedList = (
  h: HtmlBuilder<Message>,
  entries: ReadonlyArray<Entry>
): Html =>
  h.ul(
    [h.Class("m-0 list-none p-0 lg:hidden")],
    Array_.map(entries, (entry) =>
      h.li(
        [
          h.Class(
            "grid grid-cols-[26px_minmax(0,1fr)] items-start gap-3 border-t border-rule py-3 first:border-t-0 first:pt-0"
          ),
          h.DataAttribute("testid", `incident-card-${entry.ref}`),
        ],
        [
          refBadge(h, entry.ref, entry.outage.status, BADGE_PX),
          h.div(
            [h.Class("min-w-0")],
            [
              h.div(
                [
                  h.Class(
                    "flex min-h-[26px] items-center justify-between gap-2"
                  ),
                ],
                [
                  statusCell(h, entry.outage),
                  h.span(
                    [
                      h.Class(
                        `whitespace-nowrap text-[15px] ${durationClass(entry)}`
                      ),
                    ],
                    [durationText(entry)]
                  ),
                ]
              ),
              h.div([h.Class("mt-1 text-sm text-ink-2")], [spanText(entry)]),
              h.div(
                [h.Class("mt-1 text-sm text-ink-2")],
                [
                  incidentDetails(
                    entry.hosts,
                    entry.outage.maxPacketLoss,
                    entry.outage.peakLatency
                  ),
                ]
              ),
            ]
          ),
        ]
      )
    )
  );

const notes = (
  h: HtmlBuilder<Message>,
  model: Model,
  outages: ReadonlyArray<Outage>,
  meta: { count: number; totalCount: number },
  isClamped: boolean
): ReadonlyArray<Html> => [
  h.p(
    [h.Class("mt-3.5 text-sm text-ink-2")],
    [
      describeIncidents(
        outageTotals(outages),
        outageLogPhrase(isClamped, describeRange(model.dateRange))
      ),
    ]
  ),
  ...(meta.totalCount > meta.count
    ? [
        h.p(
          [h.Class("mt-1 text-sm text-ink-2")],
          [`Showing the newest ${meta.count} of ${meta.totalCount} incidents.`]
        ),
      ]
    : []),
];

const loading = (h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.Role("status"),
      h.AriaLabel("Loading incidents"),
      h.Class("flex flex-col gap-2"),
    ],
    [skeleton(h, "h-10 w-full"), skeleton(h, "h-10 w-full")]
  );

const loaded = (
  h: HtmlBuilder<Message>,
  model: Model,
  log: GetOutagesResponseType,
  isClamped: boolean
): Html => {
  const entries = entriesOf(model, log.data);
  return h.div(
    [h.DataAttribute("testid", "incident-log")],
    entries.length === 0
      ? [
          h.p(
            [h.Class("text-[15px] text-ink-2")],
            [`No incidents in ${outageLogPhrase(isClamped, "this range")}.`]
          ),
        ]
      : [
          table(h, entries),
          stackedList(h, entries),
          ...notes(h, model, log.data, log.meta, isClamped),
        ]
  );
};

/** The incidents in the selected range, newest first, lettered to match the ribbon and the charts. */
export const incidentsCard = (h: HtmlBuilder<Message>, model: Model): Html =>
  card(h, { as: "section", className: "min-w-0" }, [
    sectionHeader(h, { title: "Incidents" }),
    Option.match(currentOutages(model), {
      onSome: ({ log, isClamped }) => loaded(h, model, log, isClamped),
      onNone: () =>
        AsyncData.hasError(model.outages)
          ? failedLine(h, "Could not load incidents.")
          : loading(h),
    }),
  ]);
