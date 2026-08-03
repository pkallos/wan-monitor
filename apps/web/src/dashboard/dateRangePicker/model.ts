import { Popover } from "@foldkit/ui";
import { Option, Schema as S } from "effect";
import { PresetKey } from "@/dashboard/dateRange";

const DraftRange = S.Struct({ start: S.Number, end: S.Number });

export const Model = S.Struct({
  popover: Popover.Model,
  visibleMonth: S.Struct({ year: S.Number, month: S.Number }),
  maybeRangeStart: S.Option(S.Number),
  maybeHoveredDay: S.Option(S.Number),
  maybeDraftRange: S.Option(DraftRange),
  maybeDraftPreset: S.Option(PresetKey),
});
export type Model = typeof Model.Type;

export type InitConfig = Readonly<{ id: string }>;

/**
 * Pure like `initModel` elsewhere in this app: `visibleMonth` starts at a
 * placeholder and is only ever meaningful once `GotPopoverMessage` observes
 * an `Opened` OutMessage and derives it from the applied selection + nowMs.
 */
export const init = (config: InitConfig): Model => ({
  popover: Popover.init({ id: config.id }),
  visibleMonth: { year: 1970, month: 0 },
  maybeRangeStart: Option.none(),
  maybeHoveredDay: Option.none(),
  maybeDraftRange: Option.none(),
  maybeDraftPreset: Option.none(),
});
