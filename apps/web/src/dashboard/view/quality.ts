import type { Html, HtmlBuilder } from "foldkit/html";
import {
  JITTER_CHART_HOST_ID,
  LATENCY_CHART_HOST_ID,
  MountJitterChart,
  MountLatencyChart,
  MountPacketLossChart,
  PACKET_LOSS_CHART_HOST_ID,
} from "@/dashboard/charts/command";
import type { Message } from "@/dashboard/message";
import type { Model } from "@/dashboard/model";
import { type ChartHostOptions, chartHost } from "@/dashboard/view/chartHost";
import { isAwaitingData } from "@/dashboard/view/loading";
import { card } from "@/ui/card";
import { sectionHeader } from "@/ui/sectionHeader";

const CHART_TITLE_CLASS = "mb-1.5 mt-2 text-[13px] font-semibold text-ink-2";

type ChartSpec = Readonly<{
  title: string;
  label: string;
  mountAction: ChartHostOptions["mountAction"];
  heightClass: string;
}>;

export const qualityCard = (h: HtmlBuilder<Message>, model: Model): Html => {
  const isLoading = isAwaitingData(model.metrics);
  const chart = ({ title, label, mountAction, heightClass }: ChartSpec): Html =>
    h.div(
      [h.Class("min-w-0")],
      [
        h.p([h.Class(CHART_TITLE_CLASS)], [title]),
        chartHost(h, { label, mountAction, heightClass, isLoading }),
      ]
    );

  return card(h, { as: "section", className: "min-w-0" }, [
    sectionHeader(h, {
      title: "Network Quality",
    }),
    chart({
      title: "Latency · ms",
      label: "Latency chart",
      mountAction: MountLatencyChart({ hostId: LATENCY_CHART_HOST_ID }),
      heightClass: "h-[220px]",
    }),
    h.div(
      [h.Class("mt-4 grid gap-2 lg:grid-cols-2 lg:gap-8")],
      [
        chart({
          title: "Packet loss · %",
          label: "Packet loss chart",
          mountAction: MountPacketLossChart({
            hostId: PACKET_LOSS_CHART_HOST_ID,
          }),
          heightClass: "h-[170px]",
        }),
        chart({
          title: "Jitter · ms",
          label: "Jitter chart",
          mountAction: MountJitterChart({ hostId: JITTER_CHART_HOST_ID }),
          heightClass: "h-[170px]",
        }),
      ]
    ),
  ]);
};
