import type { Granularity } from "@shared/api/routes/metrics";
import type { SpeedMetric } from "@shared/api/routes/speedtest";
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
import {
  lastTestLabel,
  latestSpeedPair,
  speedAveragesNote,
} from "@/dashboard/overview";
import { chartHost } from "@/dashboard/view/chartHost";
import { speedReadout } from "@/dashboard/view/chartReadout";
import {
  speedtestBucketFor,
  speedtestHistoryFor,
} from "@/dashboard/view/derived";
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
  {
    history,
    maybeBucket,
    isRunning,
    isLoading,
    hasFailed,
  }: {
    history: ReadonlyArray<SpeedMetric>;
    maybeBucket: Option.Option<Granularity>;
    isRunning: boolean;
    isLoading: boolean;
    hasFailed: boolean;
  }
): Html =>
  h.div(
    [
      h.Class(
        "mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-rule pt-[18px]"
      ),
    ],
    [
      hasFailed
        ? h.div([], [])
        : h.div(
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
                        lastTestLabel(history, maybeBucket),
                        () => "No tests in this range."
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
                      latestSpeedPair(history),
                      h.span(
                        [
                          h.Class(
                            "text-sm font-medium text-ink-2 lg:text-base"
                          ),
                        ],
                        [" Mbps down / up"]
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
          isRunning ? "Running…" : "Run speed test",
        ]
      ),
    ]
  );

export const speedCard = (h: HtmlBuilder<Message>, model: Model): Html => {
  const speedtestHistory = speedtestHistoryFor(model);
  const isLoading = isAwaitingData(speedtestHistory);
  const hasFailed = AsyncData.isFailure(speedtestHistory);
  const history = AsyncData.getOrElse(speedtestHistory, () => []);
  const maybeBucket = speedtestBucketFor(model);
  const stats = calculateSpeedStats(history);

  return card(h, { as: "section", className: "min-w-0" }, [
    sectionHeader(h, {
      title: "Speed tests",
    }),
    chartHost(h, {
      label: "Speed chart",
      readout: speedReadout(model),
      mountAction: MountSpeedChart({ hostId: SPEED_CHART_HOST_ID }),
      heightClass: "h-[260px]",
    }),
    hasFailed
      ? h.empty
      : h.div(
          [h.Class("mt-4")],
          [
            h.div(
              [h.Class("grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4")],
              Array_.map(
                [
                  ["Avg download", stats.avgDownload],
                  ["Avg upload", stats.avgUpload],
                  ["Max download", stats.maxDownload],
                  ["Max upload", stats.maxUpload],
                ] as const,
                ([label, value]) => statItem(h, label, value, isLoading)
              )
            ),
            isLoading
              ? h.empty
              : Option.match(maybeBucket, {
                  onNone: () => h.empty,
                  onSome: (bucket) =>
                    h.p(
                      [h.Class("mt-2 text-xs text-ink-2")],
                      [speedAveragesNote(bucket)]
                    ),
                }),
          ]
        ),
    lastTest(h, {
      history,
      maybeBucket,
      isRunning: AsyncData.isPending(model.speedtestTrigger),
      isLoading,
      hasFailed,
    }),
  ]);
};
