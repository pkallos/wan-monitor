import type { Option } from "effect";
import { Submodel } from "foldkit";
import { GotToastMessage, type Message } from "@/dashboard/message";
import type { Model } from "@/dashboard/model";
import { Toast } from "@/dashboard/toast";
import { errorBanner } from "@/dashboard/view/banner";
import { footer } from "@/dashboard/view/footer";
import { pageHeader, statusField } from "@/dashboard/view/header";
import { hostsCard } from "@/dashboard/view/hosts";
import { incidentsCard } from "@/dashboard/view/incidents";
import { WRAP_CLASS } from "@/dashboard/view/layout";
import { qualityCard } from "@/dashboard/view/quality";
import { speedCard } from "@/dashboard/view/speed";
import { hatchDefinitions } from "@/ui/statusGlyph";

export type ViewInputs = Readonly<{ maybeUsername: Option.Option<string> }>;

const TOAST_VARIANT_CLASSES = {
  Success: "border-l-up",
  Warning: "border-l-deg",
  Error: "border-l-down",
  Info: "border-l-accent",
} as const;

export const view = Submodel.defineView<Model, Message, ViewInputs>(
  (model, viewInputs, h) => {
    const toast = h.submodel({
      slotId: "dashboard-toast",
      model: model.toast,
      view: Toast.view,
      viewInputs: {
        position: "BottomRight",
        entryClassName: "w-80",
        entryToView: (entry, handlers) =>
          h.div(
            [
              h.Class(
                `rounded-xl border border-rule border-l-4 bg-card p-4 shadow-lg dark:shadow-none ${TOAST_VARIANT_CLASSES[entry.variant]}`
              ),
            ],
            [
              h.div(
                [h.Class("flex items-start justify-between gap-2")],
                [
                  h.div(
                    [],
                    [
                      h.p(
                        [h.Class("text-sm font-semibold")],
                        [entry.payload.title]
                      ),
                      h.p(
                        [h.Class("mt-1 text-sm text-ink-2")],
                        [entry.payload.description]
                      ),
                    ]
                  ),
                  h.button(
                    [
                      ...handlers.dismiss,
                      h.Class(
                        "min-h-11 cursor-pointer text-sm text-ink-2 hover:text-ink lg:min-h-0"
                      ),
                    ],
                    ["Close"]
                  ),
                ]
              ),
            ]
          ),
      },
      toParentMessage: (message) => GotToastMessage({ message }),
    });

    return h.div(
      [
        h.Class("relative min-h-screen bg-bg text-ink"),
        h.DataAttribute("testid", "dashboard-root"),
      ],
      [
        hatchDefinitions(h),
        pageHeader(h, model, viewInputs),
        h.main(
          [],
          [
            statusField(h, model),
            h.div(
              [
                h.Class(
                  `${WRAP_CLASS} grid gap-4 pb-6 pt-4 lg:gap-6 lg:pb-10 lg:pt-8`
                ),
              ],
              [
                errorBanner(h, model),
                incidentsCard(h, model),
                qualityCard(h, model),
                hostsCard(h, model),
                speedCard(h, model),
              ]
            ),
          ]
        ),
        footer(h, model),
        toast,
      ]
    );
  }
);
