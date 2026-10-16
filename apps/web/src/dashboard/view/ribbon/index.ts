import { Array as Array_, Option } from "effect";
import { AsyncData } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { createLazy } from "foldkit/html";
import { alignTimestampToMs } from "@/dashboard/charts/timeline";
import type { Cell } from "@/dashboard/connectivity";
import {
  CLAMPED_WINDOW_PHRASE,
  describeTotals,
  outageTotals,
} from "@/dashboard/incidents";
import type { Message } from "@/dashboard/message";
import type { ConnectivityStatusData, Model } from "@/dashboard/model";
import { rangeTitle } from "@/dashboard/overview";
import { bucketAdjective, ribbonWidthPx } from "@/dashboard/ribbon";
import { currentConnectivity, outagesFor } from "@/dashboard/view/derived";
import { clusterLinesFor } from "@/dashboard/view/ribbon/chips";
import { desktopRibbon } from "@/dashboard/view/ribbon/desktop";
import { legend } from "@/dashboard/view/ribbon/legend";
import { mobileRibbon } from "@/dashboard/view/ribbon/mobile";
import { describeCell } from "@/dashboard/view/ribbon/shared";
import {
  type Derived,
  derive,
  type Source,
  selectedArgs,
  selectedIndexOf,
} from "@/dashboard/view/ribbon/source";
import { failedLine } from "@/ui/failedLine";
import { sectionHeader } from "@/ui/sectionHeader";
import { skeleton } from "@/ui/skeleton";

const CARD_CLASS =
  "min-w-0 rounded-2xl border border-field-rule bg-card p-4 lg:p-5";

const mobileRibbonSlot = createLazy();

const subtitle = (model: Model, status: ConnectivityStatusData): string =>
  [
    rangeTitle(model.dateRange),
    bucketAdjective(status.granularity),
    ...Option.match(outagesFor(model.outages, status.request), {
      onNone: () => [],
      onSome: ({ log, isClamped }) => [
        `${describeTotals(outageTotals(log.data))}${isClamped ? ` in ${CLAMPED_WINDOW_PHRASE}` : ""}`,
      ],
    }),
  ].join(" · ");

const header = (
  h: HtmlBuilder<Message>,
  cells: ReadonlyArray<Cell>,
  subtitleText?: string
): Html =>
  sectionHeader(h, {
    title: "Availability",
    subtitle: subtitleText,
    actions: legend(h, cells),
  });

/** Announces the pinned cell to a screen reader; the same text shows as a tooltip or a detail box. */
const announcement = (
  h: HtmlBuilder<Message>,
  { cells, chips }: Derived,
  selectedIndex: number,
  { granularity }: ConnectivityStatusData,
  ribbonWidth: number
): Html =>
  h.div(
    [
      h.Role("status"),
      h.DataAttribute("testid", "ribbon-announcement"),
      h.Class("sr-only"),
    ],
    Option.match(Array_.get(cells, selectedIndex), {
      onNone: () => [],
      onSome: (cell) => {
        const lines = clusterLinesFor(chips, selectedIndex, ribbonWidth);
        return [
          Array_.isReadonlyArrayNonEmpty(lines)
            ? `${describeCell(cell, granularity)}. ${lines.join("; ")}`
            : describeCell(cell, granularity),
        ];
      },
    })
  );

const loadingBody = (h: HtmlBuilder<Message>): Html =>
  h.div(
    [],
    [
      header(h, []),
      h.div(
        [
          h.Role("status"),
          h.AriaLabel("Loading availability"),
          h.Class("flex flex-col gap-3 pt-2"),
        ],
        [skeleton(h, "h-4 w-64"), skeleton(h, "h-24 w-full")]
      ),
    ]
  );

const body = (
  h: HtmlBuilder<Message>,
  model: Model,
  nowMs: number,
  status: ConnectivityStatusData
): Html => {
  const source: Source = {
    status,
    maybeEarliestDataMs: model.maybeEarliestDataMs,
    outages: model.outages,
    summary: model.summary,
    pingHosts: model.pingHosts,
    live: model.liveConnectivity,
    nowBucketMs: alignTimestampToMs(nowMs, status.granularity),
    ribbonWidthPx: ribbonWidthPx(model.maybeRibbonWidthPx),
  };
  const derived = derive(source);
  const selectedIndex = selectedIndexOf(model, status);
  return h.div(
    [],
    [
      header(h, derived.cells, subtitle(model, status)),
      desktopRibbon(h, model, source, derived, selectedIndex),
      mobileRibbonSlot(mobileRibbon, [
        h,
        ...selectedArgs(source, selectedIndex),
      ]),
      announcement(h, derived, selectedIndex, status, source.ribbonWidthPx),
    ]
  );
};

const failedBody = (h: HtmlBuilder<Message>): Html =>
  h.div(
    [],
    [
      header(h, []),
      failedLine(
        h,
        "Could not load availability.",
        "pt-2 text-[15px] text-ink-2"
      ),
    ]
  );

/** The history ribbon: every bucket of the selected range, with its incidents lettered above. */
export const ribbonCard = (
  h: HtmlBuilder<Message>,
  model: Model,
  nowMs: number
): Html =>
  h.section(
    [h.Class(CARD_CLASS), h.DataAttribute("testid", "availability-card")],
    [
      Option.match(currentConnectivity(model), {
        onSome: (status) => body(h, model, nowMs, status),
        onNone: () =>
          AsyncData.hasError(model.connectivityStatus)
            ? failedBody(h)
            : loadingBody(h),
      }),
    ]
  );
