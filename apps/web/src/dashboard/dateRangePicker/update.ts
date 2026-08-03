import { Popover } from "@foldkit/ui";
import { Match as M, Option } from "effect";
import { Command, type Update } from "foldkit";
import { evo } from "foldkit/struct";
import {
  Custom,
  type DateRangeSelection,
  getDateRangeWindow,
  Preset,
} from "@/dashboard/dateRange";
import {
  AppliedRange,
  Cancelled,
  GotPopoverMessage,
  type Message,
  type OutMessage,
} from "@/dashboard/dateRangePicker/message";
import type { Model } from "@/dashboard/dateRangePicker/model";

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>;
const withUpdateReturn = M.withReturnType<UpdateReturn>();

const MONTHS_PER_YEAR = 12;

/** `maybeRangeStart`/`maybeDraftRange` always hold local midnights, matching
 *  the `dateMs` the calendar grid renders, so day arithmetic stays exact
 *  across DST transitions and `startOfLocalDay` round-trips an applied
 *  window back to the same draft it was built from. */
const startOfLocalDay = (ms: number): number => {
  const date = new Date(ms);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  ).getTime();
};

const endOfLocalDay = (ms: number): number => {
  const date = new Date(ms);
  return (
    new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate() + 1
    ).getTime() - 1
  );
};

const selectionToCustomWindow = (
  range: Readonly<{ start: number; end: number }>
): Readonly<{ startTime: string; endTime: string }> => ({
  startTime: new Date(startOfLocalDay(range.start)).toISOString(),
  endTime: new Date(endOfLocalDay(range.end)).toISOString(),
});

const draftToSelection = (
  model: Model,
  appliedSelection: DateRangeSelection
): DateRangeSelection =>
  Option.match(model.maybeDraftPreset, {
    onSome: (preset) => Preset({ preset }),
    onNone: () =>
      Option.match(model.maybeDraftRange, {
        onSome: (range) => Custom(selectionToCustomWindow(range)),
        onNone: () => appliedSelection,
      }),
  });

/** The panel renders `visibleMonth` and `visibleMonth + 1` side by side.
 *  Anchoring on the window's start would strand very long ranges (`allTime`
 *  can start years or decades before `now`) on a calendar far from the
 *  range's end, so never open further back than the month preceding it. */
const visibleMonthFromWindow = (window: {
  startTime: string;
  endTime: string;
}): Readonly<{ year: number; month: number }> => {
  const start = new Date(window.startTime);
  const end = new Date(window.endTime);
  const monthIndex = Math.max(
    start.getFullYear() * MONTHS_PER_YEAR + start.getMonth(),
    end.getFullYear() * MONTHS_PER_YEAR + end.getMonth() - 1
  );
  return {
    year: Math.floor(monthIndex / MONTHS_PER_YEAR),
    month: monthIndex % MONTHS_PER_YEAR,
  };
};

/** Resets the draft state (preset, custom range, and any in-progress
 *  start/hover) to reflect `selection` — used both when the popover opens
 *  (so it shows the actually-applied choice) and on Cancel (so it discards
 *  whatever was mid-flight). */
const resetDraftFromSelection = (
  model: Model,
  selection: DateRangeSelection
): Model =>
  evo(model, {
    maybeDraftPreset: () =>
      selection._tag === "Preset"
        ? Option.some(selection.preset)
        : Option.none(),
    maybeDraftRange: () =>
      selection._tag === "Custom"
        ? Option.some({
            start: startOfLocalDay(Date.parse(selection.startTime)),
            end: startOfLocalDay(Date.parse(selection.endTime)),
          })
        : Option.none(),
    maybeRangeStart: () => Option.none(),
    maybeHoveredDay: () => Option.none(),
  });

const mapPopoverCommands = (
  commands: ReadonlyArray<Command.Command<Popover.Message>>
): ReadonlyArray<Command.Command<Message>> =>
  Command.mapMessages(commands, (message) => GotPopoverMessage({ message }));

export const update = (
  model: Model,
  message: Message,
  appliedSelection: DateRangeSelection,
  nowMs: number,
  maybeEarliestDataMs: Option.Option<number> = Option.none()
): UpdateReturn =>
  M.value(message).pipe(
    withUpdateReturn,
    M.tags({
      ClickedPreset: ({ preset }) => [
        evo(model, {
          maybeDraftPreset: () => Option.some(preset),
          maybeDraftRange: () => Option.none(),
          maybeRangeStart: () => Option.none(),
          maybeHoveredDay: () => Option.none(),
        }),
        [],
        Option.none(),
      ],

      ClickedDay: ({ dateMs }) =>
        Option.match(model.maybeRangeStart, {
          onNone: () => [
            evo(model, {
              maybeRangeStart: () => Option.some(dateMs),
              maybeDraftPreset: () => Option.none(),
              maybeDraftRange: () => Option.none(),
              maybeHoveredDay: () => Option.none(),
            }),
            [],
            Option.none(),
          ],
          onSome: (start) => [
            evo(model, {
              maybeDraftRange: () =>
                Option.some({
                  start: Math.min(start, dateMs),
                  end: Math.max(start, dateMs),
                }),
              maybeRangeStart: () => Option.none(),
              maybeHoveredDay: () => Option.none(),
              maybeDraftPreset: () => Option.none(),
            }),
            [],
            Option.none(),
          ],
        }),

      HoveredDay: ({ dateMs }) =>
        Option.isSome(model.maybeRangeStart)
          ? [
              evo(model, { maybeHoveredDay: () => Option.some(dateMs) }),
              [],
              Option.none(),
            ]
          : [model, [], Option.none()],

      ClickedPreviousMonth: () => {
        const { year, month } = model.visibleMonth;
        const previous =
          month === 0
            ? { year: year - 1, month: 11 }
            : { year, month: month - 1 };
        return [
          evo(model, { visibleMonth: () => previous }),
          [],
          Option.none(),
        ];
      },

      ClickedNextMonth: () => {
        const { year, month } = model.visibleMonth;
        const next =
          month === 11
            ? { year: year + 1, month: 0 }
            : { year, month: month + 1 };
        return [evo(model, { visibleMonth: () => next }), [], Option.none()];
      },

      ClickedApply: () => {
        const selection = draftToSelection(model, appliedSelection);
        const [nextPopover, popoverCommands] = Popover.close(model.popover);
        return [
          evo(model, { popover: () => nextPopover }),
          mapPopoverCommands(popoverCommands),
          Option.some(AppliedRange({ selection })),
        ];
      },

      ClickedCancel: () => {
        const [nextPopover, popoverCommands] = Popover.close(model.popover);
        return [
          resetDraftFromSelection(
            evo(model, { popover: () => nextPopover }),
            appliedSelection
          ),
          mapPopoverCommands(popoverCommands),
          Option.some(Cancelled()),
        ];
      },

      GotPopoverMessage: ({ message: popoverMessage }) => {
        const [nextPopover, popoverCommands, maybeOutMessage] = Popover.update(
          model.popover,
          popoverMessage
        );
        const nextModel = evo(model, { popover: () => nextPopover });
        const commands = mapPopoverCommands(popoverCommands);

        return Option.match(maybeOutMessage, {
          onNone: () => [nextModel, commands, Option.none()],
          onSome: (out) =>
            M.value(out).pipe(
              withUpdateReturn,
              M.tag("Opened", () => {
                const window = getDateRangeWindow(
                  appliedSelection,
                  nowMs,
                  maybeEarliestDataMs
                );
                return [
                  resetDraftFromSelection(
                    evo(nextModel, {
                      visibleMonth: () => visibleMonthFromWindow(window),
                    }),
                    appliedSelection
                  ),
                  commands,
                  Option.none(),
                ];
              }),
              M.tag("Closed", () => [nextModel, commands, Option.none()]),
              M.exhaustive
            ),
        });
      },
    }),
    M.exhaustive
  );
