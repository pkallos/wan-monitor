import type { Html, HtmlBuilder } from "foldkit/html";
import { skeleton } from "@/ui/skeleton";
import { type SparklineValue, sparkline } from "@/ui/sparkline";

export type FigureTileContent = Readonly<{
  label: string;
  value: string;
  unit: string;
  caption: string;
  series: ReadonlyArray<SparklineValue>;
}>;

export type FigureTileOptions = Readonly<{
  figure: FigureTileContent;
  /** `hero` sits on the status field; `kpi` is a card in the main column. */
  variant: "hero" | "kpi";
  isLoading: boolean;
  testId: string;
  className?: string;
}>;

const TILE_CLASSES: Record<FigureTileOptions["variant"], string> = {
  hero: "rounded-[16px] border border-field-rule bg-card p-3.5 md:p-[18px]",
  kpi: "rounded-[18px] border border-rule bg-card p-4 md:p-6",
};

const VALUE_CLASSES: Record<FigureTileOptions["variant"], string> = {
  hero: "text-[30px] md:text-[38px]",
  kpi: "text-[24px] md:text-[30px]",
};

// A pair like "99.5 / 45.2" is wider than a 228px tile holds at display size,
// so values past this length step down rather than wrap or clip.
const LONG_VALUE_LENGTH = 10;
const LONG_VALUE_CLASSES: Record<FigureTileOptions["variant"], string> = {
  hero: "text-[24px] md:text-[28px]",
  kpi: "text-[20px] md:text-[24px]",
};

const valueClasses = (
  variant: FigureTileOptions["variant"],
  value: string
): string =>
  value.length >= LONG_VALUE_LENGTH
    ? LONG_VALUE_CLASSES[variant]
    : VALUE_CLASSES[variant];

/**
 * A labelled number with its unit, a caption and a sparkline. While loading,
 * the value, caption and sparkline are skeletons of their own size, so the
 * tile keeps its footprint and nothing shifts when data lands.
 */
export const figureTile = <Message>(
  h: HtmlBuilder<Message>,
  { figure, variant, isLoading, testId, className = "" }: FigureTileOptions
): Html =>
  h.div(
    [
      h.Class(
        `flex min-w-0 flex-col ${TILE_CLASSES[variant]} ${className}`.trim()
      ),
      h.DataAttribute("testid", testId),
    ],
    [
      h.h3(
        [h.Class("text-xs font-semibold uppercase tracking-wide text-ink-2")],
        [figure.label]
      ),
      isLoading
        ? h.div(
            [
              h.Role("status"),
              h.AriaLabel(`Loading ${figure.label.toLowerCase()}`),
              h.Class("flex flex-col gap-2 pt-1"),
            ],
            [
              skeleton(h, "h-9 w-28"),
              skeleton(h, "h-3 w-20"),
              skeleton(h, "h-7 w-full"),
            ]
          )
        : h.div(
            [h.Class("flex flex-col gap-1")],
            [
              h.p(
                [
                  h.Class(
                    `mt-1.5 flex flex-wrap items-baseline gap-x-1 font-semibold leading-[1.05] tracking-[-0.02em] ${valueClasses(variant, figure.value)}`
                  ),
                ],
                [
                  h.span([h.Class("whitespace-nowrap")], [figure.value]),
                  h.span(
                    [
                      h.Class(
                        "text-sm font-medium tracking-normal text-ink-2 md:text-base"
                      ),
                    ],
                    [figure.unit]
                  ),
                ]
              ),
              h.p([h.Class("text-[13px] text-ink-2")], [figure.caption]),
              h.div(
                [h.Class("mt-2.5 text-accent")],
                [sparkline(h, { values: figure.series })]
              ),
            ]
          ),
    ]
  );
