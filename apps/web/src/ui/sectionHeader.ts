import type { Html, HtmlBuilder } from "foldkit/html";

export type SectionHeaderOptions = Readonly<{
  title: string;
  subtitle?: string;
  /** Sits opposite the title: a legend, a control, or any compact content. */
  actions?: Html;
}>;

export const sectionHeader = <Message>(
  h: HtmlBuilder<Message>,
  { title, subtitle, actions }: SectionHeaderOptions
): Html =>
  h.div(
    [
      h.Class(
        "mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2"
      ),
    ],
    [
      h.div(
        [],
        [
          h.h2(
            [
              h.Class(
                "text-[19px] font-semibold tracking-[-0.01em] md:text-[22px]"
              ),
            ],
            [title]
          ),
          ...(subtitle === undefined
            ? []
            : [h.p([h.Class("mt-1 text-sm text-ink-2")], [subtitle])]),
        ]
      ),
      ...(actions === undefined ? [] : [actions]),
    ]
  );
