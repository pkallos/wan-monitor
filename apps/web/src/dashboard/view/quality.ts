import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";
import {
  JITTER_CHART_HOST_ID,
  LATENCY_CHART_HOST_ID,
  MountJitterChart,
  MountLatencyChart,
  MountPacketLossChart,
  PACKET_LOSS_CHART_HOST_ID,
} from "@/dashboard/charts/command";
import type { LatencyView } from "@/dashboard/latencyView";
import {
  LATENCY_VIEWS,
  LatencyViewRadioGroup,
} from "@/dashboard/latencyViewRadioGroup";
import {
  ClickedResetRange,
  GotLatencyViewMessage,
  type Message,
} from "@/dashboard/message";
import type { Model } from "@/dashboard/model";
import { type ChartHostOptions, chartHost } from "@/dashboard/view/chartHost";
import {
  isPerHostView,
  jitterReadout,
  latencyReadout,
  packetLossReadout,
} from "@/dashboard/view/chartReadout";
import { card } from "@/ui/card";
import {
  SECONDARY_BUTTON_CLASS,
  SEGMENTED_GROUP_CLASS,
  segmentStateClass,
} from "@/ui/controls";
import { sectionHeader } from "@/ui/sectionHeader";

const CHART_TITLE_CLASS = "mb-1.5 mt-2 text-[13px] font-semibold text-ink-2";

type ChartSpec = Readonly<{
  title: string;
  label: string;
  readout: ChartHostOptions["readout"];
  mountAction: ChartHostOptions["mountAction"];
  heightClass: string;
}>;

const LATENCY_VIEW_LABELS: Record<LatencyView, string> = {
  all: "All hosts",
  perHost: "Per host",
};

const LATENCY_SEGMENT_CLASS =
  "h-11 cursor-pointer rounded-lg px-3 text-[13px] font-semibold transition-colors lg:h-8";

const latencyViewToggle = (h: HtmlBuilder<Message>, model: Model): Html =>
  h.submodel({
    slotId: "latency-view",
    model: model.latencyViewRadioGroup,
    view: LatencyViewRadioGroup.view,
    viewInputs: {
      options: LATENCY_VIEWS,
      selectedValue: Option.some(model.latencyView),
      ariaLabel: "Latency view",
      orientation: "Horizontal",
      toView: ({ group, options }) =>
        h.div(
          [...group, h.Class(SEGMENTED_GROUP_CLASS)],
          options.map(({ value, isSelected, option, label }) =>
            h.button(
              [
                ...option,
                h.Class(
                  `${LATENCY_SEGMENT_CLASS} ${segmentStateClass(isSelected)}`
                ),
              ],
              [h.span([...label], [LATENCY_VIEW_LABELS[value]])]
            )
          )
        ),
    },
    toParentMessage: (message) => GotLatencyViewMessage({ message }),
  });

const resetRangeButton = (h: HtmlBuilder<Message>): Html =>
  h.button(
    [
      h.Type("button"),
      h.OnClick(ClickedResetRange()),
      h.Class(SECONDARY_BUTTON_CLASS),
    ],
    ["Reset range"]
  );

export const qualityCard = (h: HtmlBuilder<Message>, model: Model): Html => {
  const chart = ({
    title,
    label,
    readout,
    mountAction,
    heightClass,
  }: ChartSpec): Html =>
    h.div(
      [h.Class("min-w-0")],
      [
        h.p([h.Class(CHART_TITLE_CLASS)], [title]),
        chartHost(h, { label, readout, mountAction, heightClass }),
      ]
    );

  return card(h, { as: "section", className: "min-w-0" }, [
    sectionHeader(h, {
      title: "Network quality",
      actions: Option.isSome(model.maybeRangeBeforeBrush)
        ? resetRangeButton(h)
        : undefined,
    }),
    h.div(
      [h.Class("mt-2 flex flex-wrap items-center justify-between gap-2")],
      [
        h.p(
          [h.Class("text-[13px] font-semibold text-ink-2")],
          [
            "Latency · ms ",
            h.span(
              [h.Class("ml-1 font-normal")],
              [isPerHostView(model) ? "p50 per host" : "p50 line, p95 band"]
            ),
          ]
        ),
        latencyViewToggle(h, model),
      ]
    ),
    chartHost(h, {
      label: "Latency chart",
      readout: latencyReadout(model),
      mountAction: MountLatencyChart({ hostId: LATENCY_CHART_HOST_ID }),
      heightClass: "h-[220px]",
    }),
    h.div(
      [h.Class("mt-4 grid gap-2 lg:grid-cols-2 lg:gap-8")],
      [
        chart({
          title: "Packet loss · %",
          label: "Packet loss chart",
          readout: packetLossReadout(model),
          mountAction: MountPacketLossChart({
            hostId: PACKET_LOSS_CHART_HOST_ID,
          }),
          heightClass: "h-[170px]",
        }),
        chart({
          title: "Jitter · ms",
          label: "Jitter chart",
          readout: jitterReadout(model),
          mountAction: MountJitterChart({ hostId: JITTER_CHART_HOST_ID }),
          heightClass: "h-[170px]",
        }),
      ]
    ),
  ]);
};
