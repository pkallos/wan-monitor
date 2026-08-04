import { Popover } from "@foldkit/ui";
import { Array as Array_, Option } from "effect";
import { Submodel } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { buildMonthGrid, type CalendarDay } from "@/dashboard/calendarGrid";
import {
  type DateRangeSelection,
  formatDateRangeLabel,
  getDateRangeWindow,
  PRESET_LABELS,
  PRESET_ORDER,
  type PresetKey,
} from "@/dashboard/dateRange";
import {
  ClickedApply,
  ClickedCancel,
  ClickedDay,
  ClickedNextMonth,
  ClickedPreset,
  ClickedPreviousMonth,
  GotPopoverMessage,
  HoveredDay,
  type Message,
} from "@/dashboard/dateRangePicker/message";
import type { Model } from "@/dashboard/dateRangePicker/model";

const MONTHS_PER_YEAR = 12;
const WEEKDAY_LABELS: ReadonlyArray<string> = [
  "Su",
  "Mo",
  "Tu",
  "We",
  "Th",
  "Fr",
  "Sa",
];

const TRIGGER_BUTTON_CLASS =
  "flex cursor-pointer items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700";

// Absolutely-positioned with no explicit width, this shrinks to whatever
// space Floating UI leaves on the constrained side of the anchor rather than
// its natural content size (two 7-column day grids plus the presets list),
// squeezing the grids down to a few px per column. The panel's own content
// needs ~50rem at the lg:flex-row breakpoint to render at a readable size;
// lg (1024px) rather than sm leaves enough headroom that phones and
// portrait tablets both get the stacked single-month layout below it (see
// the calendar row's class), since anything narrower than ~50rem clips the
// second month. max-w guards the rest since Floating UI's shift/flip
// middleware repositions the panel but never shrinks it.
const PANEL_CLASS =
  "z-20 flex max-w-[calc(100vw-2rem)] flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-lg dark:border-gray-700 dark:bg-gray-800 lg:max-w-none lg:min-w-[50rem] lg:flex-row lg:gap-6";

const BACKDROP_CLASS = "fixed inset-0 z-10";

const PRESET_ROW_BASE_CLASS =
  "w-full cursor-pointer rounded-md px-3 py-2 text-left text-sm";
const PRESET_ROW_ACTIVE_CLASS = "bg-blue-600 font-semibold text-white";
const PRESET_ROW_INACTIVE_CLASS =
  "text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700";

const NAV_BUTTON_CLASS =
  "cursor-pointer rounded-md p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700";
const NAV_PLACEHOLDER_CLASS = "h-6 w-6";

const DAY_BASE_CLASS =
  "flex h-9 w-9 items-center justify-center rounded-md text-sm";
const DAY_OUT_OF_MONTH_CLASS = "text-gray-300 dark:text-gray-600";
const DAY_DEFAULT_CLASS =
  "cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700";
const DAY_PREVIEW_CLASS =
  "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-200";
const DAY_COMMITTED_CLASS =
  "cursor-pointer bg-blue-600 text-white hover:bg-blue-600 dark:hover:bg-blue-600";
const DAY_TODAY_CLASS = "font-bold ring-1 ring-inset ring-blue-500";

const PRIMARY_BUTTON_CLASS =
  "cursor-pointer rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700";
const SECONDARY_BUTTON_CLASS =
  "cursor-pointer rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700";

export type ViewInputs = Readonly<{
  appliedSelection: DateRangeSelection;
  nowMs: number;
  maybeEarliestDataMs?: Option.Option<number>;
}>;

/** Selector for the element the Popover focuses once the panel is positioned.
 *  It has to resolve to a control inside the panel: focusing the panel itself
 *  (the Popover default) makes the first Tab blur it, and a blurred panel
 *  closes unless it was opened with a mouse. Keyed by the popover's id so two
 *  pickers on one page keep distinct focus targets. */
export const initialFocusSelector = (popoverId: string): string =>
  `[data-date-range-initial-focus="${popoverId}"]`;

type MonthKey = Readonly<{ year: number; month: number }>;

const addMonths = (month: MonthKey, delta: number): MonthKey => {
  const index = month.year * MONTHS_PER_YEAR + month.month + delta;
  return {
    year: Math.floor(index / MONTHS_PER_YEAR),
    month: ((index % MONTHS_PER_YEAR) + MONTHS_PER_YEAR) % MONTHS_PER_YEAR,
  };
};

const monthLabel = (month: MonthKey): string =>
  new Date(month.year, month.month, 1).toLocaleDateString([], {
    month: "long",
    year: "numeric",
  });

type Highlight = "none" | "preview" | "committed";

/** In-progress selection (`maybeRangeStart`) and a committed draft
 *  (`maybeDraftRange`) are mutually exclusive per `update.ts`, so checking
 *  the start first and falling back to the committed range covers every
 *  reachable state. */
const highlightFor = (model: Model, dateMs: number): Highlight =>
  Option.match(model.maybeRangeStart, {
    onSome: (start) => {
      const hovered = Option.getOrElse(model.maybeHoveredDay, () => start);
      const lo = Math.min(start, hovered);
      const hi = Math.max(start, hovered);
      return dateMs >= lo && dateMs <= hi ? "preview" : "none";
    },
    onNone: () =>
      Option.match(model.maybeDraftRange, {
        onSome: (range) =>
          dateMs >= range.start && dateMs <= range.end ? "committed" : "none",
        onNone: () => "none",
      }),
  });

const chevronIcon = (
  h: HtmlBuilder<Message>,
  direction: "left" | "right"
): Html => {
  const points = direction === "left" ? "15 18 9 12 15 6" : "9 18 15 12 9 6";
  return h.svg(
    [
      h.Attribute("viewBox", "0 0 24 24"),
      h.Attribute("fill", "none"),
      h.Class("h-4 w-4"),
    ],
    [
      h.polyline(
        [
          h.Attribute("points", points),
          h.Attribute("stroke", "currentColor"),
          h.Attribute("stroke-width", "2"),
          h.Attribute("stroke-linecap", "round"),
          h.Attribute("stroke-linejoin", "round"),
        ],
        []
      ),
    ]
  );
};

const calendarIcon = (h: HtmlBuilder<Message>): Html => {
  return h.svg(
    [
      h.Attribute("viewBox", "0 0 24 24"),
      h.Attribute("fill", "none"),
      h.Class("h-4 w-4"),
    ],
    [
      h.rect(
        [
          h.Attribute("x", "3"),
          h.Attribute("y", "4"),
          h.Attribute("width", "18"),
          h.Attribute("height", "18"),
          h.Attribute("rx", "2"),
          h.Attribute("stroke", "currentColor"),
          h.Attribute("stroke-width", "1.5"),
        ],
        []
      ),
      h.line(
        [
          h.Attribute("x1", "3"),
          h.Attribute("y1", "10"),
          h.Attribute("x2", "21"),
          h.Attribute("y2", "10"),
          h.Attribute("stroke", "currentColor"),
          h.Attribute("stroke-width", "1.5"),
        ],
        []
      ),
      h.line(
        [
          h.Attribute("x1", "8"),
          h.Attribute("y1", "2"),
          h.Attribute("x2", "8"),
          h.Attribute("y2", "6"),
          h.Attribute("stroke", "currentColor"),
          h.Attribute("stroke-width", "1.5"),
          h.Attribute("stroke-linecap", "round"),
        ],
        []
      ),
      h.line(
        [
          h.Attribute("x1", "16"),
          h.Attribute("y1", "2"),
          h.Attribute("x2", "16"),
          h.Attribute("y2", "6"),
          h.Attribute("stroke", "currentColor"),
          h.Attribute("stroke-width", "1.5"),
          h.Attribute("stroke-linecap", "round"),
        ],
        []
      ),
    ]
  );
};

const navButton = (
  h: HtmlBuilder<Message>,
  direction: "previous" | "next"
): Html => {
  return h.button(
    [
      h.Type("button"),
      h.OnClick(
        direction === "previous" ? ClickedPreviousMonth() : ClickedNextMonth()
      ),
      h.AriaLabel(direction === "previous" ? "Previous month" : "Next month"),
      h.Class(NAV_BUTTON_CLASS),
    ],
    [chevronIcon(h, direction === "previous" ? "left" : "right")]
  );
};

const navPlaceholder = (h: HtmlBuilder<Message>): Html => {
  return h.div([h.Class(NAV_PLACEHOLDER_CLASS)], []);
};

const dayCell = (
  h: HtmlBuilder<Message>,
  model: Model,
  calendarDay: CalendarDay
): Html => {
  const label = String(new Date(calendarDay.dateMs).getDate());

  if (!calendarDay.inMonth) {
    return h.div(
      [h.Class(`${DAY_BASE_CLASS} ${DAY_OUT_OF_MONTH_CLASS}`)],
      [label]
    );
  }

  const highlight = highlightFor(model, calendarDay.dateMs);
  const highlightClass =
    highlight === "committed"
      ? DAY_COMMITTED_CLASS
      : highlight === "preview"
        ? `cursor-pointer ${DAY_PREVIEW_CLASS}`
        : DAY_DEFAULT_CLASS;
  const todayClass = calendarDay.isToday ? DAY_TODAY_CLASS : "";

  return h.button(
    [
      h.Type("button"),
      h.DataAttribute("testid", `date-range-day-${calendarDay.dateMs}`),
      h.AriaLabel(new Date(calendarDay.dateMs).toLocaleDateString()),
      h.AriaPressed(String(highlight === "committed")),
      h.OnClick(ClickedDay({ dateMs: calendarDay.dateMs })),
      h.OnMouseEnter(HoveredDay({ dateMs: calendarDay.dateMs })),
      h.Class(`${DAY_BASE_CLASS} ${highlightClass} ${todayClass}`),
    ],
    [label]
  );
};

const monthGridView = (
  h: HtmlBuilder<Message>,
  model: Model,
  month: MonthKey,
  todayMs: number,
  edge: "left" | "right"
): Html => {
  const weeks = buildMonthGrid(month.year, month.month, todayMs);

  return h.div(
    // grid-cols-7's minmax(0,1fr) tracks have no max-content contribution of
    // their own, so under the panel's shrink-to-fit sizing (an absolutely
    // positioned box with no explicit width) the grid collapses toward
    // whatever space is left instead of the day buttons' actual h-9 w-9 size.
    // An explicit width (7 * 2.25rem + 6 * 0.25rem gaps) keeps the grid at
    // its real content size regardless of ancestor width.
    [h.Class("flex w-[17.25rem] flex-shrink-0 flex-col gap-2")],
    [
      h.div(
        [h.Class("flex items-center justify-between")],
        [
          edge === "left" ? navButton(h, "previous") : navPlaceholder(h),
          h.p([h.Class("text-sm font-semibold")], [monthLabel(month)]),
          edge === "right" ? navButton(h, "next") : navPlaceholder(h),
        ]
      ),
      h.div(
        [
          h.Class(
            "grid grid-cols-7 gap-1 text-center text-xs text-gray-500 dark:text-gray-400"
          ),
        ],
        Array_.map(WEEKDAY_LABELS, (label) => h.span([], [label]))
      ),
      h.div(
        [h.Class("flex flex-col gap-1")],
        Array_.map(weeks, (week) =>
          h.div(
            [h.Class("grid grid-cols-7 gap-1")],
            Array_.map(week, (calendarDay) => dayCell(h, model, calendarDay))
          )
        )
      ),
    ]
  );
};

export const view = Submodel.defineView<Model, Message, ViewInputs>(
  (model, viewInputs, h) => {
    const triggerLabel = formatDateRangeLabel(
      getDateRangeWindow(
        viewInputs.appliedSelection,
        viewInputs.nowMs,
        viewInputs.maybeEarliestDataMs
      )
    );

    const presetRow = (preset: PresetKey, index: number): Html => {
      // `maybeDraftPreset` alone drives the highlight: opening the panel seeds
      // it from the applied selection, and starting a custom range clears it,
      // so a preset never stays lit while days are being picked.
      const isActive = Option.contains(model.maybeDraftPreset, preset);
      return h.button(
        [
          h.Type("button"),
          h.OnClick(ClickedPreset({ preset })),
          h.AriaPressed(String(isActive)),
          ...(index === 0
            ? [h.DataAttribute("date-range-initial-focus", model.popover.id)]
            : []),
          h.Class(
            `${PRESET_ROW_BASE_CLASS} ${isActive ? PRESET_ROW_ACTIVE_CLASS : PRESET_ROW_INACTIVE_CLASS}`
          ),
        ],
        [PRESET_LABELS[preset]]
      );
    };

    const rightMonth = addMonths(model.visibleMonth, 1);

    const panelChildren: ReadonlyArray<Html> = [
      h.div(
        [h.Class("flex w-40 flex-shrink-0 flex-col gap-1")],
        Array_.map(PRESET_ORDER, (preset, index) => presetRow(preset, index))
      ),
      h.div(
        [h.Class("flex flex-col gap-4")],
        [
          h.div(
            [h.Class("flex flex-col gap-6 lg:flex-row")],
            [
              monthGridView(
                h,
                model,
                model.visibleMonth,
                viewInputs.nowMs,
                "left"
              ),
              monthGridView(h, model, rightMonth, viewInputs.nowMs, "right"),
            ]
          ),
          h.div(
            [h.Class("flex justify-end gap-2")],
            [
              h.button(
                [
                  h.Type("button"),
                  h.OnClick(ClickedCancel()),
                  h.Class(SECONDARY_BUTTON_CLASS),
                ],
                ["Cancel"]
              ),
              h.button(
                [
                  h.Type("button"),
                  h.OnClick(ClickedApply()),
                  h.Class(PRIMARY_BUTTON_CLASS),
                ],
                ["Apply"]
              ),
            ]
          ),
        ]
      ),
    ];

    return h.submodel({
      slotId: "date-range-popover",
      model: model.popover,
      view: Popover.view,
      viewInputs: {
        // The panel stays in the app tree rather than being portaled (the
        // library defaults `portal` to true): the `dark` class lives on the
        // dashboard's root div, so a portaled panel would render outside
        // every `dark:` variant's scope.
        anchor: { placement: "bottom-start", gap: 8, portal: false },
        focusSelector: initialFocusSelector(model.popover.id),
        toView: ({ button, panel, backdrop, isVisible }) =>
          h.div(
            [h.Class("relative inline-block")],
            [
              h.button(
                [...button, h.Class(TRIGGER_BUTTON_CLASS)],
                [calendarIcon(h), triggerLabel]
              ),
              ...(isVisible
                ? [
                    h.div([...backdrop, h.Class(BACKDROP_CLASS)], []),
                    h.div([...panel, h.Class(PANEL_CLASS)], panelChildren),
                  ]
                : []),
            ]
          ),
      },
      toParentMessage: (message) => GotPopoverMessage({ message }),
    });
  }
);
