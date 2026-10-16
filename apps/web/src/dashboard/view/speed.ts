import { Array as Array_, Option } from "effect";
import { AsyncData } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { Gauge } from "lucide";
import {
  MountSpeedChart,
  SPEED_CHART_HOST_ID,
} from "@/dashboard/charts/command";
import { calculateSpeedStats } from "@/dashboard/charts/stats";
import { ClickedTriggerSpeedtest, type Message } from "@/dashboard/message";
import type { Model } from "@/dashboard/model";
import { lastTestLabel, speedFigure } from "@/dashboard/overview";
import { chartHost } from "@/dashboard/view/chartHost";
import { isAwaitingData } from "@/dashboard/view/loading";
import { card } from "@/ui/card";
import { PRIMARY_BUTTON_CLASS } from "@/ui/controls";
import { icon } from "@/ui/icon";
import { sectionHeader } from "@/ui/sectionHeader";
import { skeleton } from "@/ui/skeleton";

// A label followed by its value paragraph: the value is the label's next
// sibling, which is the shape the e2e specs read it by.
const statItem = (
  h: HtmlBuilder<Message>,
  label: string,
  value: string,
  isLoading: boolean
): Html =>
  h.div(
    [h.Class("min-w-0")],
    [
      h.p([h.Class("text-xs font-semibold text-ink-2")], [label]),
      isLoading
        ? skeleton(h, "mt-1 h-6 w-24")
        : h.p(
            [h.Class("mt-0.5 whitespace-nowrap text-base font-semibold")],
            [`${value} Mbps`]
          ),
    ]
  );

const lastTest = (
  h: HtmlBuilder<Message>,
  model: Model,
  isLoading: boolean
): Html => {
  const history = AsyncData.getOrElse(model.speedtestHistory, () => []);
  const isRunning = AsyncData.isPending(model.speedtestTrigger);
  const figure = speedFigure(history, Date.now());

  return h.div(
    [
      h.Class(
        "mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-rule pt-[18px]"
      ),
    ],
    [
      h.div(
        [h.Class("min-w-0")],
        [
          isLoading
            ? skeleton(h, "h-4 w-56 max-w-full")
            : h.p(
                [
                  h.Class(
                    "text-[13px] font-semibold tracking-[0.01em] text-ink-2"
                  ),
                ],
                [
                  Option.getOrElse(
                    lastTestLabel(history),
                    () => "Last test · none yet"
                  ),
                ]
              ),
          isLoading
            ? skeleton(h, "mt-1 h-7 w-40")
            : h.p(
                [
                  h.Class(
                    "mt-1 whitespace-nowrap text-[22px] font-semibold tracking-[-0.01em] lg:text-[26px]"
                  ),
                ],
                [
                  figure.value,
                  h.span(
                    [
                      h.Class(
                        "ml-1 text-sm font-medium text-ink-2 lg:text-base"
                      ),
                    ],
                    [`${figure.unit} down / up`]
                  ),
                ]
              ),
        ]
      ),
      h.button(
        [
          h.Type("button"),
          h.OnClick(ClickedTriggerSpeedtest()),
          h.Disabled(isRunning),
          h.Class(
            `inline-flex w-full items-center justify-center gap-2 text-[15px] lg:w-auto ${PRIMARY_BUTTON_CLASS}`
          ),
        ],
        [
          icon(h, Gauge, { size: 18, strokeWidth: 1.75 }),
          isRunning ? "Running…" : "Run Speed Test",
        ]
      ),
    ]
  );
};

export const speedCard = (h: HtmlBuilder<Message>, model: Model): Html => {
  const isLoading = isAwaitingData(model.speedtestHistory);
  const stats = calculateSpeedStats(
    AsyncData.getOrElse(model.speedtestHistory, () => [])
  );

  return card(h, { as: "section", className: "min-w-0" }, [
    sectionHeader(h, {
      title: "Speed tests",
    }),
    chartHost(h, {
      label: "Speed chart",
      mountAction: MountSpeedChart({ hostId: SPEED_CHART_HOST_ID }),
      heightClass: "h-[260px]",
      isLoading,
    }),
    h.div(
      [h.Class("mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4")],
      Array_.map(
        [
          ["Avg Download", stats.avgDownload],
          ["Avg Upload", stats.avgUpload],
          ["Max Download", stats.maxDownload],
          ["Max Upload", stats.maxUpload],
        ] as const,
        ([label, value]) => statItem(h, label, value, isLoading)
      )
    ),
    lastTest(h, model, isLoading),
  ]);
};
