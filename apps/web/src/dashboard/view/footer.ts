import { Option } from "effect";
import { AsyncData } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { formatDurationAgo } from "@/dashboard/format";
import type { Message } from "@/dashboard/message";
import type { Model } from "@/dashboard/model";
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
            [`Updated ${formatDurationAgo(Date.now() - lastUpdatedMs)}.`]
          ),
      }),
    ]
  );

export const footer = (h: HtmlBuilder<Message>, model: Model): Html =>
  h.footer(
    [h.Class("border-t border-rule bg-bg")],
    [
      h.div(
        [
          h.Class(
            `${WRAP_CLASS} flex flex-wrap gap-x-6 gap-y-2 pb-7 pt-5 text-sm text-ink-2`
          ),
        ],
        Option.isSome(model.maybeLastUpdatedMs) ||
          AsyncData.isRefreshing(model.metrics)
          ? [lastUpdatedIndicator(h, model)]
          : []
      ),
    ]
  );
