import { Popover } from "@foldkit/ui";
import { Option } from "effect";
import { Scene } from "foldkit";
import { describe, expect, test } from "vitest";
import {
  Custom,
  type DateRangeSelection,
  formatDateRangeLabel,
  getDateRangeWindow,
  Preset,
} from "@/dashboard/dateRange";
import { AppliedRange, Cancelled } from "@/dashboard/dateRangePicker/message";
import { init, type Model } from "@/dashboard/dateRangePicker/model";
import { update } from "@/dashboard/dateRangePicker/update";
import {
  view as dateRangePickerView,
  initialFocusSelector,
} from "@/dashboard/dateRangePicker/view";

const NOW_MS = Date.parse("2026-07-28T12:00:00.000Z");
const APPLIED_LAST_30D = Preset({ preset: "last30d" });
const TRIGGER_LABEL = formatDateRangeLabel(
  getDateRangeWindow(APPLIED_LAST_30D, NOW_MS)
);

const day = (year: number, monthIndex: number, date: number): number =>
  new Date(year, monthIndex, date).getTime();

const dayTestId = (dateMs: number): string => `date-range-day-${dateMs}`;

const boundUpdate =
  (appliedSelection: DateRangeSelection = APPLIED_LAST_30D, nowMs = NOW_MS) =>
  (model: Model, message: Parameters<typeof update>[1]) =>
    update(model, message, appliedSelection, nowMs);

const boundView = (
  appliedSelection: DateRangeSelection = APPLIED_LAST_30D,
  nowMs = NOW_MS
) =>
  Scene.withViewInputs(dateRangePickerView, {
    appliedSelection: APPLIED_LAST_30D,
    nowMs: NOW_MS,
  })({ appliedSelection, nowMs });

const openPopoverMounts = () =>
  Scene.Mount.resolveAll(
    [Popover.AnchorPopover, Popover.CompletedAnchorPopover()],
    [Popover.PortalPopoverBackdrop, Popover.CompletedPortalPopoverBackdrop()]
  );

const resolveFocusButton = () =>
  Scene.Command.resolve(Popover.FocusButton, Popover.CompletedFocusButton());

const endedPopoverMounts = () =>
  Scene.Mount.expectEnded(Popover.AnchorPopover, Popover.PortalPopoverBackdrop);

const openPicker = () => [
  Scene.click(Scene.role("button", { name: TRIGGER_LABEL })),
  openPopoverMounts(),
];

describe("dateRangePicker view — trigger", () => {
  test("shows the formatted applied range as the trigger's label", () => {
    Scene.scene(
      { update: boundUpdate(), view: boundView() },
      Scene.given(init({ id: "picker" })),
      Scene.expect(Scene.role("button", { name: TRIGGER_LABEL })).toExist()
    );
  });

  test("the panel is closed until the trigger is clicked", () => {
    Scene.scene(
      { update: boundUpdate(), view: boundView() },
      Scene.given(init({ id: "picker" })),
      Scene.expect(Scene.role("button", { name: "Apply" })).not.toExist(),
      Scene.expect(Scene.role("button", { name: "Cancel" })).not.toExist()
    );
  });

  test("clicking the trigger opens the panel with presets, both month grids, and Apply/Cancel", () => {
    Scene.scene(
      { update: boundUpdate(), view: boundView() },
      Scene.given(init({ id: "picker" })),
      ...openPicker(),
      Scene.expect(Scene.text("Last 7 days")).toExist(),
      Scene.expect(Scene.text("Last 30 days")).toExist(),
      Scene.expect(Scene.text("Month to date")).toExist(),
      Scene.expect(Scene.text("Quarter to date")).toExist(),
      Scene.expect(Scene.text("Year to date")).toExist(),
      Scene.expect(Scene.text("Last 12 months")).toExist(),
      Scene.expect(Scene.text("All time")).toExist(),
      Scene.expect(Scene.text("June 2026")).toExist(),
      Scene.expect(Scene.text("July 2026")).toExist(),
      Scene.expect(Scene.role("button", { name: "Apply" })).toExist(),
      Scene.expect(Scene.role("button", { name: "Cancel" })).toExist()
    );
  });
});

describe("dateRangePicker view — presets", () => {
  test("highlights the applied preset by default once opened", () => {
    Scene.scene(
      { update: boundUpdate(), view: boundView() },
      Scene.given(init({ id: "picker" })),
      ...openPicker(),
      Scene.expect(Scene.role("button", { name: "Last 30 days" })).toHaveAttr(
        "aria-pressed",
        "true"
      )
    );
  });

  test("the selector the popover focuses on open resolves to the first preset", () => {
    Scene.scene(
      { update: boundUpdate(), view: boundView() },
      Scene.given(init({ id: "picker" })),
      ...openPicker(),
      Scene.expect(Scene.selector(initialFocusSelector("picker"))).toHaveText(
        "Last hour"
      )
    );
  });

  test("clicking a preset highlights it instead", () => {
    Scene.scene(
      { update: boundUpdate(), view: boundView() },
      Scene.given(init({ id: "picker" })),
      ...openPicker(),
      Scene.click(Scene.role("button", { name: "Last 7 days" })),
      Scene.expect(Scene.role("button", { name: "Last 7 days" })).toHaveAttr(
        "aria-pressed",
        "true"
      ),
      Scene.expect(Scene.role("button", { name: "Last 30 days" })).toHaveAttr(
        "aria-pressed",
        "false"
      )
    );
  });

  test("starting a custom range clears the preset highlight", () => {
    Scene.scene(
      { update: boundUpdate(), view: boundView() },
      Scene.given(init({ id: "picker" })),
      ...openPicker(),
      Scene.click(Scene.testId(dayTestId(day(2026, 6, 10)))),
      Scene.expect(Scene.role("button", { name: "Last 30 days" })).toHaveAttr(
        "aria-pressed",
        "false"
      ),
      Scene.expectAll(Scene.all.role("button", { pressed: true })).toHaveCount(
        0
      )
    );
  });

  test("Apply with a preset selected closes the picker and emits AppliedRange", () => {
    Scene.scene(
      { update: boundUpdate(), view: boundView() },
      Scene.given(init({ id: "picker" })),
      ...openPicker(),
      Scene.click(Scene.role("button", { name: "Last 7 days" })),
      Scene.click(Scene.role("button", { name: "Apply" })),
      Scene.expect(Scene.role("button", { name: "Apply" })).not.toExist(),
      Scene.tap((simulation) => {
        expect(simulation.outMessage).toEqual(
          Option.some(AppliedRange({ selection: Preset({ preset: "last7d" }) }))
        );
      }),
      resolveFocusButton(),
      endedPopoverMounts()
    );
  });
});

describe("dateRangePicker view — calendar grids", () => {
  test("marks today with a distinct ring", () => {
    // `nowMs` is an instant, so the local calendar day it lands on shifts with
    // the runner's time zone. Derive it rather than pinning a date.
    const today = new Date(NOW_MS);
    const todayMs = day(today.getFullYear(), today.getMonth(), today.getDate());

    Scene.scene(
      { update: boundUpdate(), view: boundView() },
      Scene.given(init({ id: "picker" })),
      ...openPicker(),
      Scene.expect(Scene.testId(dayTestId(todayMs))).toHaveClass("ring-1")
    );
  });

  test("grays out and disables days outside the visible months", () => {
    Scene.scene(
      { update: boundUpdate(), view: boundView() },
      Scene.given(init({ id: "picker" })),
      ...openPicker(),
      // May 31 pads the June grid's leading edge but belongs to a month
      // that isn't rendered as its own grid, so it is never clickable.
      Scene.expect(Scene.testId(dayTestId(day(2026, 4, 31)))).not.toExist()
    );
  });

  test("hovering after a start click previews the range without committing it", () => {
    Scene.scene(
      { update: boundUpdate(), view: boundView() },
      Scene.given(init({ id: "picker" })),
      ...openPicker(),
      Scene.click(Scene.testId(dayTestId(day(2026, 6, 10)))),
      Scene.hover(Scene.testId(dayTestId(day(2026, 6, 15)))),
      Scene.expect(Scene.testId(dayTestId(day(2026, 6, 12)))).toHaveClass(
        "bg-blue-100"
      )
    );
  });

  test("clicking a second day commits a solid highlight across the range", () => {
    Scene.scene(
      { update: boundUpdate(), view: boundView() },
      Scene.given(init({ id: "picker" })),
      ...openPicker(),
      Scene.click(Scene.testId(dayTestId(day(2026, 6, 10)))),
      Scene.hover(Scene.testId(dayTestId(day(2026, 6, 15)))),
      Scene.click(Scene.testId(dayTestId(day(2026, 6, 20)))),
      Scene.expect(Scene.testId(dayTestId(day(2026, 6, 15)))).toHaveClass(
        "bg-blue-600"
      ),
      Scene.expect(Scene.testId(dayTestId(day(2026, 6, 15)))).not.toHaveClass(
        "bg-blue-100"
      )
    );
  });

  test("exposes the committed range through aria-pressed, not colour alone", () => {
    Scene.scene(
      { update: boundUpdate(), view: boundView() },
      Scene.given(init({ id: "picker" })),
      ...openPicker(),
      Scene.click(Scene.testId(dayTestId(day(2026, 6, 10)))),
      Scene.click(Scene.testId(dayTestId(day(2026, 6, 20)))),
      Scene.expect(Scene.testId(dayTestId(day(2026, 6, 15)))).toHaveAttr(
        "aria-pressed",
        "true"
      ),
      Scene.expect(Scene.testId(dayTestId(day(2026, 6, 21)))).toHaveAttr(
        "aria-pressed",
        "false"
      )
    );
  });

  test("Apply with a committed custom range closes the picker and emits the full-day window", () => {
    Scene.scene(
      { update: boundUpdate(), view: boundView() },
      Scene.given(init({ id: "picker" })),
      ...openPicker(),
      Scene.click(Scene.testId(dayTestId(day(2026, 6, 10)))),
      Scene.click(Scene.testId(dayTestId(day(2026, 6, 20)))),
      Scene.click(Scene.role("button", { name: "Apply" })),
      Scene.tap((simulation) => {
        expect(simulation.outMessage).toEqual(
          Option.some(
            AppliedRange({
              selection: Custom({
                startTime: new Date(day(2026, 6, 10)).toISOString(),
                endTime: new Date(
                  day(2026, 6, 20) + 24 * 60 * 60 * 1000 - 1
                ).toISOString(),
              }),
            })
          )
        );
      }),
      resolveFocusButton(),
      endedPopoverMounts()
    );
  });
});

describe("dateRangePicker view — applied custom range", () => {
  const APPLIED_CUSTOM = Custom({
    startTime: new Date(day(2026, 6, 10)).toISOString(),
    endTime: new Date(day(2026, 6, 20) + 24 * 60 * 60 * 1000 - 1).toISOString(),
  });
  const CUSTOM_TRIGGER_LABEL = formatDateRangeLabel(
    getDateRangeWindow(APPLIED_CUSTOM, NOW_MS)
  );

  test("opens showing the applied custom range as the committed selection", () => {
    Scene.scene(
      {
        update: boundUpdate(APPLIED_CUSTOM),
        view: boundView(APPLIED_CUSTOM),
      },
      Scene.given(init({ id: "picker" })),
      Scene.click(Scene.role("button", { name: CUSTOM_TRIGGER_LABEL })),
      openPopoverMounts(),
      Scene.expect(Scene.testId(dayTestId(day(2026, 6, 15)))).toHaveAttr(
        "aria-pressed",
        "true"
      ),
      Scene.expect(Scene.testId(dayTestId(day(2026, 6, 21)))).toHaveAttr(
        "aria-pressed",
        "false"
      ),
      // No preset row claims the selection while a custom range is applied.
      Scene.expect(Scene.role("button", { name: "Last 30 days" })).toHaveAttr(
        "aria-pressed",
        "false"
      )
    );
  });
});

describe("dateRangePicker view — month navigation", () => {
  test("shows exactly one previous chevron (left grid) and one next chevron (right grid)", () => {
    Scene.scene(
      { update: boundUpdate(), view: boundView() },
      Scene.given(init({ id: "picker" })),
      ...openPicker(),
      Scene.expectAll(
        Scene.all.role("button", { name: "Previous month" })
      ).toHaveCount(1),
      Scene.expectAll(
        Scene.all.role("button", { name: "Next month" })
      ).toHaveCount(1)
    );
  });

  test("Next month advances both grids by one calendar month", () => {
    Scene.scene(
      { update: boundUpdate(), view: boundView() },
      Scene.given(init({ id: "picker" })),
      ...openPicker(),
      Scene.click(Scene.role("button", { name: "Next month" })),
      Scene.expect(Scene.text("June 2026")).not.toExist(),
      Scene.expect(Scene.text("July 2026")).toExist(),
      Scene.expect(Scene.text("August 2026")).toExist()
    );
  });

  test("Previous month rewinds both grids by one calendar month", () => {
    Scene.scene(
      { update: boundUpdate(), view: boundView() },
      Scene.given(init({ id: "picker" })),
      ...openPicker(),
      Scene.click(Scene.role("button", { name: "Previous month" })),
      Scene.expect(Scene.text("May 2026")).toExist(),
      Scene.expect(Scene.text("June 2026")).toExist(),
      Scene.expect(Scene.text("July 2026")).not.toExist()
    );
  });
});

describe("dateRangePicker view — Cancel", () => {
  test("Cancel discards an in-progress selection and closes the picker", () => {
    Scene.scene(
      { update: boundUpdate(), view: boundView() },
      Scene.given(init({ id: "picker" })),
      ...openPicker(),
      Scene.click(Scene.testId(dayTestId(day(2026, 6, 10)))),
      Scene.click(Scene.role("button", { name: "Cancel" })),
      Scene.expect(Scene.role("button", { name: "Cancel" })).not.toExist(),
      Scene.tap((simulation) => {
        expect(simulation.outMessage).toEqual(Option.some(Cancelled()));
      }),
      resolveFocusButton(),
      endedPopoverMounts()
    );
  });

  test("reopening after Cancel shows the applied preset again, not the discarded draft", () => {
    Scene.scene(
      { update: boundUpdate(), view: boundView() },
      Scene.given(init({ id: "picker" })),
      ...openPicker(),
      Scene.click(Scene.testId(dayTestId(day(2026, 6, 10)))),
      Scene.click(Scene.role("button", { name: "Cancel" })),
      resolveFocusButton(),
      endedPopoverMounts(),
      ...openPicker(),
      Scene.expect(Scene.role("button", { name: "Last 30 days" })).toHaveAttr(
        "aria-pressed",
        "true"
      )
    );
  });
});
