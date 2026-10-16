import { Array as Array_, Option } from "effect";
import { AsyncData } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import {
  formatDateRangeLabel,
  getDateRangeWindow,
} from "@/dashboard/dateRange";
import type { Message } from "@/dashboard/message";
import type { Model } from "@/dashboard/model";
import { formatDurationAgo } from "@/dashboard/overview";
import { WRAP_CLASS } from "@/dashboard/view/layout";

const lastUpdatedIndicator = (h: HtmlBuilder<Message>, model: Model): Html =>
  h.span(
    [h.Class("inline-flex items-center gap-2")],
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

const coverageText = (model: Model): Option.Option<string> =>
  Option.map(
    AsyncData.getData(model.connectivityStatus),
    ({ coveragePercentage }) =>
      `data coverage ${coveragePercentage.toFixed(1)}% of the selected range`
  );

export const footer = (h: HtmlBuilder<Message>, model: Model): Html => {
  const rangeLabel = formatDateRangeLabel(
    getDateRangeWindow(model.dateRange, Date.now(), model.maybeEarliestDataMs)
  );
  const details: ReadonlyArray<Html> = [
    ...(Option.isSome(model.maybeLastUpdatedMs) ||
    AsyncData.isRefreshing(model.metrics)
      ? [lastUpdatedIndicator(h, model)]
      : []),
    ...Option.match(coverageText(model), {
      onNone: () => [],
      onSome: (text) => [h.span([], [text])],
    }),
    h.span([], [rangeLabel]),
    h.span([], [model.isPaused ? "auto-refresh paused" : "auto-refresh on"]),
  ];

  return h.footer(
    [h.Class("border-t border-rule bg-bg")],
    [
      h.div(
        [
          h.Class(
            `${WRAP_CLASS} flex flex-wrap justify-between gap-x-6 gap-y-2 pb-7 pt-5 text-sm text-ink-2`
          ),
        ],
        [
          h.span([h.Class("font-semibold text-ink")], ["WAN Monitor"]),
          h.span(
            [h.Class("flex flex-wrap items-center gap-x-2.5 gap-y-1")],
            Array_.flatMap(details, (detail, index) =>
              index === 0
                ? [detail]
                : [h.span([h.AriaHidden(true)], ["·"]), detail]
            )
          ),
        ]
      ),
    ]
  );
};
