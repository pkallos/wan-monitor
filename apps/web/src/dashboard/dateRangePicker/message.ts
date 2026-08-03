import { Popover } from "@foldkit/ui";
import { Schema as S } from "effect";
import { m } from "foldkit/message";
import { DateRangeSelection, PresetKey } from "@/dashboard/dateRange";

export const ClickedPreset = m("ClickedPreset", { preset: PresetKey });
export const ClickedDay = m("ClickedDay", { dateMs: S.Number });
export const HoveredDay = m("HoveredDay", { dateMs: S.Number });
export const ClickedPreviousMonth = m("ClickedPreviousMonth");
export const ClickedNextMonth = m("ClickedNextMonth");
export const ClickedApply = m("ClickedApply");
export const ClickedCancel = m("ClickedCancel");
export const GotPopoverMessage = m("GotPopoverMessage", {
  message: Popover.Message,
});

export const Message = S.Union([
  ClickedPreset,
  ClickedDay,
  HoveredDay,
  ClickedPreviousMonth,
  ClickedNextMonth,
  ClickedApply,
  ClickedCancel,
  GotPopoverMessage,
]);
export type Message = typeof Message.Type;

/** Sent to the parent once Apply commits a selection (a drafted preset or
 *  custom range, or the currently-applied selection when nothing was
 *  drafted). */
export const AppliedRange = m("AppliedRange", {
  selection: DateRangeSelection,
});
/** Sent to the parent when Cancel discards any in-progress draft. */
export const Cancelled = m("Cancelled");

export const OutMessage = S.Union([AppliedRange, Cancelled]);
export type OutMessage = typeof OutMessage.Type;
