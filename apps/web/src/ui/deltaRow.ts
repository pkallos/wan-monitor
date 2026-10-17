import type { Html, HtmlBuilder } from "foldkit/html";
import type { IconNode } from "lucide";
import { CircleCheck, Minus, TriangleAlert } from "lucide";
import type { Delta } from "@/dashboard/deltas";
import { icon } from "@/ui/icon";

const DELTA_TONES: Record<
  Delta["tone"],
  { glyph: IconNode; className: string }
> = {
  good: { glyph: CircleCheck, className: "text-up" },
  bad: { glyph: TriangleAlert, className: "text-down" },
  neutral: { glyph: Minus, className: "text-ink-2" },
};

/**
 * A change since the previous window: the signed value, the verdict spelled
 * out as a word with a glyph of its own so a good or bad change never rests on
 * colour alone, then the baseline it is measured from.
 */
export const deltaRow = <Message>(
  h: HtmlBuilder<Message>,
  { text, word, tone, rest }: Delta,
  className = "mt-2 text-[13px]"
): Html => {
  const { glyph, className: toneClass } = DELTA_TONES[tone];
  return h.p(
    [
      h.Class(
        `${className} flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-ink-2`
      ),
      h.DataAttribute("delta", word),
    ],
    [
      h.span(
        [h.Class(`inline-flex items-center gap-1 font-semibold ${toneClass}`)],
        [icon(h, glyph, { size: 14 }), h.span([], [`${text} ${word}`])]
      ),
      h.span([], [rest]),
    ]
  );
};
