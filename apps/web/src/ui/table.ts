import type { Html, HtmlBuilder } from "foldkit/html";

export const TABLE_TH_CLASS =
  "whitespace-nowrap border-b border-rule px-2 pb-2 text-xs font-semibold text-ink-2";

export const TABLE_TD_CLASS =
  "whitespace-nowrap border-b border-rule px-2 py-3 align-middle";

/** A cell whose text (a host list or name) wraps in the room the other columns leave, rather than widening the table. */
export const TABLE_TD_WRAP_CLASS =
  "min-w-32 break-words border-b border-rule px-2 py-3 align-middle";

type ScrollableTableOptions = Readonly<{
  /** The breakpoint the table takes over from the stacked list; `md` unless the columns need more room. */
  from?: "md" | "lg";
}>;

const SHOWN_FROM = {
  md: "hidden overflow-x-auto md:block",
  lg: "hidden overflow-x-auto lg:block",
} as const;

/** A wide table that scrolls inside its card when its columns outgrow it; hidden below its breakpoint, where a stacked list takes its place. */
export const scrollableTable = <Message>(
  h: HtmlBuilder<Message>,
  table: Html,
  { from = "md" }: ScrollableTableOptions = {}
): Html => h.div([h.Class(SHOWN_FROM[from])], [table]);
