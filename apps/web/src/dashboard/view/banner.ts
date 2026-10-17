import { Array as Array_ } from "effect";
import { AsyncData } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { TriangleAlert } from "lucide";
import { ClickedRefreshNow, type Message } from "@/dashboard/message";
import type { Model } from "@/dashboard/model";
import { describeFetchErrors } from "@/dashboard/overview";
import { icon } from "@/ui/icon";

const RETRY_BUTTON_CLASS =
  "min-h-11 cursor-pointer rounded-lg border border-deg px-3 text-sm font-semibold text-deg-text transition-colors hover:bg-card/60 lg:min-h-9";

// `getError` spans Failure and Stale, so a refresh that fails after data
// already loaded still surfaces here while the stale data stays on screen.
const fetchErrors = (model: Model) =>
  describeFetchErrors([
    { source: "Metrics", maybeError: AsyncData.getError(model.metrics) },
    {
      source: "Speed tests",
      maybeError: AsyncData.getError(model.speedtestHistory),
    },
    {
      source: "Availability",
      maybeError: AsyncData.getError(model.connectivityStatus),
    },
    {
      source: "Live status",
      maybeError: AsyncData.getError(model.liveConnectivity),
    },
    { source: "Summary", maybeError: AsyncData.getError(model.summary) },
    { source: "Incidents", maybeError: AsyncData.getError(model.outages) },
    { source: "Hosts", maybeError: AsyncData.getError(model.pingHosts) },
  ]);

/** One non-blocking alert for every failed fetch, with a way to try again. */
export const errorBanner = (h: HtmlBuilder<Message>, model: Model): Html =>
  Array_.match(fetchErrors(model), {
    onEmpty: () => h.empty,
    onNonEmpty: (lines) =>
      h.div(
        [
          h.Role("alert"),
          h.Class(
            "flex items-start gap-3 rounded-xl border border-deg bg-deg-bg px-4 py-3 text-sm text-deg-text"
          ),
        ],
        [
          h.span([h.Class("mt-0.5")], [icon(h, TriangleAlert, { size: 16 })]),
          h.div(
            [h.Class("flex min-w-0 flex-1 flex-col gap-1")],
            Array_.map(lines, (line) => h.p([], [line]))
          ),
          h.button(
            [
              h.Type("button"),
              h.OnClick(ClickedRefreshNow()),
              h.Class(RETRY_BUTTON_CLASS),
            ],
            ["Retry"]
          ),
        ]
      ),
  });
