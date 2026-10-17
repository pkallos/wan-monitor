import type { Html, HtmlBuilder } from "foldkit/html";
import type { IconNode } from "lucide";
import { CircleCheck, CircleDashed, CircleX, TriangleAlert } from "lucide";
import { icon } from "@/ui/icon";

export type StatusTone = "good" | "warning" | "error" | "neutral";

export type StatusBadgeOptions = Readonly<{
  tone: StatusTone;
  label: string;
  iconSize?: number;
}>;

// Each tone pairs a colour with its own glyph, so status is readable without
// colour: a check, a warning triangle, a cross, a dashed (absent) circle.
const TONES: Record<StatusTone, { glyph: IconNode; className: string }> = {
  good: { glyph: CircleCheck, className: "text-up" },
  warning: { glyph: TriangleAlert, className: "text-deg-text" },
  error: { glyph: CircleX, className: "text-down" },
  neutral: { glyph: CircleDashed, className: "text-ink-2" },
};

const DEFAULT_ICON_SIZE_PX = 16;

export const statusBadge = <Message>(
  h: HtmlBuilder<Message>,
  { tone, label, iconSize = DEFAULT_ICON_SIZE_PX }: StatusBadgeOptions
): Html => {
  const { glyph, className } = TONES[tone];
  return h.span(
    [h.Class(`inline-flex items-center gap-2 ${className}`)],
    [icon(h, glyph, { size: iconSize }), h.span([], [label])]
  );
};
