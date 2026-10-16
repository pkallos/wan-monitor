import type { Outage } from "@shared/api/routes/connectivity-status";
import type { Html, HtmlBuilder } from "foldkit/html";

type IncidentStatus = Outage["status"];

// A down incident is a solid red disc and a degraded one an amber-tinted ring,
// so the two differ in shape of fill as well as hue.
const COLORS: Record<IncidentStatus, string> = {
  down: "bg-down text-on-accent",
  degraded: "border-[1.5px] border-deg bg-deg-bg text-deg-text",
};

const MIN_FONT_PX = 11;

/** An incident's letter in a disc of its own, sized to sit in a chip or a table cell. */
export const refBadge = <Message>(
  h: HtmlBuilder<Message>,
  ref: string,
  status: IncidentStatus,
  sizePx: number
): Html =>
  h.span(
    [
      h.Class(
        `inline-flex flex-none box-border items-center justify-center rounded-full font-bold ${COLORS[status]}`
      ),
      h.Style({
        minWidth: `${sizePx}px`,
        height: `${sizePx}px`,
        fontSize: `${Math.max(MIN_FONT_PX, Math.round(sizePx * 0.5))}px`,
      }),
    ],
    [ref]
  );
