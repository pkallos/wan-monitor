import type { Html, HtmlBuilder } from "foldkit/html";
import type { Message } from "@/dashboard/message";
import { skeleton } from "@/ui/skeleton";

export type ChartHostOptions = Readonly<{
  label: string;
  mountAction: Parameters<HtmlBuilder<Message>["OnMount"]>[0];
  heightClass: string;
  isLoading: boolean;
}>;

// The mount target stays in the tree while loading so ECharts can attach as
// soon as the host exists; the skeleton is laid over it, not swapped for it.
export const chartHost = (
  h: HtmlBuilder<Message>,
  { label, mountAction, heightClass, isLoading }: ChartHostOptions
): Html =>
  h.div(
    [h.Class("relative w-full min-w-0")],
    [
      h.div(
        [
          h.Class(`${heightClass} w-full`),
          h.AriaLabel(label),
          h.OnMount(mountAction),
        ],
        []
      ),
      isLoading
        ? h.div(
            [
              h.Role("status"),
              h.AriaLabel(`Loading ${label.toLowerCase()}`),
              h.Class("pointer-events-none absolute inset-0"),
            ],
            [skeleton(h, "h-full w-full")]
          )
        : h.empty,
    ]
  );
