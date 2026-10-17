import { Array as Array_, Option } from "effect";
import { AsyncData } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { everyInterval } from "@/dashboard/format";
import type { Message } from "@/dashboard/message";
import type { Model } from "@/dashboard/model";
import { formatDurationAgo } from "@/dashboard/overview";
import { currentConnectivity } from "@/dashboard/view/derived";
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

const speedtestText = (model: Model): ReadonlyArray<string> =>
  Option.match(AsyncData.getData(model.pingHosts), {
    onNone: () => [],
    onSome: ({ speedtestIntervalSeconds }) => [
      `speed test ${everyInterval(speedtestIntervalSeconds)}`,
    ],
  });

const coverageText = (model: Model): Option.Option<string> =>
  Option.map(
    currentConnectivity(model),
    ({ coveragePercentage }) => `Coverage ${coveragePercentage.toFixed(1)}%`
  );

// A paused or idle dashboard is already flagged by the header chip.
const autoRefreshText = (model: Model): ReadonlyArray<string> =>
  model.isPaused || model.isIdle ? [] : ["auto-refresh on"];

// Separators sit between the items of a group, and the groups wrap as whole
// units, so a narrow screen breaks between groups and never strands a dot at
// the end or start of a line.
const group = (h: HtmlBuilder<Message>, items: ReadonlyArray<Html>): Html =>
  h.span(
    [h.Class("flex flex-wrap items-center gap-x-2.5 gap-y-1")],
    Array_.flatMap(items, (item, index) =>
      index === 0 ? [item] : [h.span([h.AriaHidden(true)], ["·"]), item]
    )
  );

export const footer = (h: HtmlBuilder<Message>, model: Model): Html => {
  const freshness: ReadonlyArray<Html> = [
    ...(Option.isSome(model.maybeLastUpdatedMs) ||
    AsyncData.isRefreshing(model.metrics)
      ? [lastUpdatedIndicator(h, model)]
      : []),
    ...Array_.map(autoRefreshText(model), (text) => h.span([], [text])),
  ];
  const scope: ReadonlyArray<Html> = [
    ...Array_.map(speedtestText(model), (text) => h.span([], [text])),
    ...Option.match(coverageText(model), {
      onNone: () => [],
      onSome: (text) => [h.span([], [text])],
    }),
  ];

  return h.footer(
    [h.Class("border-t border-rule bg-bg")],
    [
      h.div(
        [
          h.Class(
            `${WRAP_CLASS} flex flex-wrap gap-x-6 gap-y-2 pb-7 pt-5 text-sm text-ink-2`
          ),
        ],
        Array_.map(
          Array_.filter([freshness, scope], Array_.isReadonlyArrayNonEmpty),
          (items) => group(h, items)
        )
      ),
    ]
  );
};
