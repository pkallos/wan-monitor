import type { Html, HtmlBuilder } from "foldkit/html";

export type CardOptions = Readonly<{
  as?: "div" | "section";
  className?: string;
}>;

const CARD_CLASS = "rounded-[18px] border border-rule bg-card p-4 lg:p-6";

export const card = <Message>(
  h: HtmlBuilder<Message>,
  { as = "div", className = "" }: CardOptions,
  children: ReadonlyArray<Html | string>
): Html =>
  (as === "section" ? h.section : h.div)(
    [h.Class(`${CARD_CLASS} ${className}`.trim())],
    children
  );
