import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";
import type { Message } from "@/dashboard/message";
import type { ChartReadout } from "@/dashboard/view/chartReadout";
import { skeleton } from "@/ui/skeleton";

export type ChartHostOptions = Readonly<{
  /** Names the chart as a group and in its loading state. */
  label: string;
  readout: ChartReadout;
  mountAction: Parameters<HtmlBuilder<Message>["OnMount"]>[0];
  heightClass: string;
}>;

// The mount target stays in the tree while loading so ECharts can attach as
// soon as the host exists; the skeleton and the notice are laid over it, not
// swapped for it. The group keeps the chart's own name; the canvas inside it is
// announced as an image named by its readout, which already carries the
// notice, so the notice itself is hidden from assistive tech. A chart whose
// data does not answer the selected range is covered like a first load, so it
// is never labelled with another range's plot. The cover is opaque beneath the
// pulsing skeleton, so that plot does not show through.
export const chartHost = (
  h: HtmlBuilder<Message>,
  { label, readout, mountAction, heightClass }: ChartHostOptions
): Html =>
  h.div(
    [h.Class("relative w-full min-w-0"), h.Role("group"), h.AriaLabel(label)],
    [
      h.div(
        [
          h.Class(`${heightClass} w-full`),
          h.Role("img"),
          h.AriaLabel(readout.label),
          h.OnMount(mountAction),
        ],
        []
      ),
      readout.isLoading
        ? h.div(
            [
              h.Role("status"),
              h.AriaLabel(`Loading ${label.toLowerCase()}`),
              h.Class("pointer-events-none absolute inset-0 bg-card"),
            ],
            [skeleton(h, "h-full w-full")]
          )
        : Option.match(readout.maybeNotice, {
            onNone: () => h.empty,
            onSome: (notice) =>
              h.div(
                [
                  h.DataAttribute("testid", "chart-notice"),
                  h.AriaHidden(true),
                  h.Class(
                    "absolute inset-0 flex items-center justify-center bg-card px-4 text-center text-[15px] text-ink-2"
                  ),
                ],
                [notice]
              ),
          }),
    ]
  );
