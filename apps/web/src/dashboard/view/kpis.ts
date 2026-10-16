import { Array as Array_ } from "effect";
import { AsyncData } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import type { Message } from "@/dashboard/message";
import type { Model } from "@/dashboard/model";
import { jitterFigure, packetLossFigure } from "@/dashboard/overview";
import { isAwaitingData } from "@/dashboard/view/loading";
import { figureTile } from "@/ui/figureTile";

/** Packet loss and jitter, the two quality figures that don't make the hero row. */
export const kpiTiles = (
  h: HtmlBuilder<Message>,
  model: Model
): ReadonlyArray<Html> => {
  const metrics = AsyncData.getOrElse(model.metrics, () => []);
  const isLoading = isAwaitingData(model.metrics);
  return Array_.map(
    [
      { figure: packetLossFigure(metrics), testId: "kpi-packet-loss" },
      { figure: jitterFigure(metrics), testId: "kpi-jitter" },
    ],
    (tile) => figureTile(h, { ...tile, variant: "kpi", isLoading })
  );
};
