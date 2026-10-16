import type { Html, HtmlBuilder } from "foldkit/html";

export type SectionHeaderOptions = Readonly<{
  title: string;
  actions?: Html;
}>;

export const sectionHeader = <Message>(
  h: HtmlBuilder<Message>,
  { title, actions }: SectionHeaderOptions
): Html =>
  h.div(
    [h.Class("mb-4 flex items-center justify-between gap-4")],
    [
      h.h3([h.Class("text-lg font-semibold tracking-tight")], [title]),
      ...(actions === undefined ? [] : [actions]),
    ]
  );
