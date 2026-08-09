import { Popover } from "@foldkit/ui";
import { Option } from "effect";
import { Story } from "foldkit";
import { describe, expect, test } from "vitest";
import {
  Custom,
  type DateRangeSelection,
  getDateRangeWindow,
  Preset,
} from "@/dashboard/dateRange";
import {
  AppliedRange,
  Cancelled,
  ClickedApply,
  ClickedCancel,
  ClickedDay,
  ClickedNextMonth,
  ClickedPreset,
  ClickedPreviousMonth,
  GotPopoverMessage,
  HoveredDay,
} from "@/dashboard/dateRangePicker/message";
import { init, type Model } from "@/dashboard/dateRangePicker/model";
import { update } from "@/dashboard/dateRangePicker/update";

const NOW_MS = Date.parse("2026-07-28T12:00:00.000Z");
const APPLIED_LAST_30D = Preset({ preset: "last30d" });

const withContext =
  (appliedSelection: DateRangeSelection = APPLIED_LAST_30D, nowMs = NOW_MS) =>
  (model: Model, message: Parameters<typeof update>[1]) =>
    update(model, message, appliedSelection, nowMs);

const day = (year: number, monthIndex: number, date: number): number =>
  new Date(year, monthIndex, date).getTime();

const endOfDay = (year: number, monthIndex: number, date: number): number =>
  day(year, monthIndex, date + 1) - 1;

const resolveFocusButton = () =>
  Story.Command.resolve(Popover.FocusButton, Popover.CompletedFocusButton());

describe("dateRangePicker update — opening the popover", () => {
  test("resets drafts to reflect the applied preset and derives visibleMonth from it", () => {
    const dirtyModel: Model = {
      ...init({ id: "picker" }),
      maybeDraftPreset: Option.some("allTime" as const),
      maybeRangeStart: Option.some(day(2020, 0, 1)),
    };
    const expectedWindow = getDateRangeWindow(APPLIED_LAST_30D, NOW_MS);
    const expectedStart = new Date(expectedWindow.startTime);

    Story.story(
      withContext(),
      Story.given(dirtyModel),
      Story.message(GotPopoverMessage({ message: Popover.RequestedOpen() })),
      Story.model((model) => {
        expect(model.maybeDraftPreset).toEqual(Option.some("last30d"));
        expect(model.maybeDraftRange).toEqual(Option.none());
        expect(model.maybeRangeStart).toEqual(Option.none());
        expect(model.maybeHoveredDay).toEqual(Option.none());
        expect(model.visibleMonth).toEqual({
          year: expectedStart.getFullYear(),
          month: expectedStart.getMonth(),
        });
      })
    );
  });

  test("resets drafts to reflect an applied custom range", () => {
    const appliedCustom = Custom({
      startTime: new Date(day(2026, 5, 1)).toISOString(),
      endTime: new Date(endOfDay(2026, 5, 15)).toISOString(),
    });

    Story.story(
      withContext(appliedCustom, NOW_MS),
      Story.given(init({ id: "picker" })),
      Story.message(GotPopoverMessage({ message: Popover.RequestedOpen() })),
      Story.model((model) => {
        expect(model.maybeDraftPreset).toEqual(Option.none());
        expect(model.maybeDraftRange).toEqual(
          Option.some({ start: day(2026, 5, 1), end: day(2026, 5, 15) })
        );
      })
    );
  });

  test("snaps an applied window that straddles local midnight onto the days it covers", () => {
    const appliedCustom = Custom({
      startTime: "2026-06-01T00:00:00.000Z",
      endTime: "2026-06-15T23:59:59.999Z",
    });
    const localStart = new Date(Date.parse(appliedCustom.startTime));
    const localEnd = new Date(Date.parse(appliedCustom.endTime));

    Story.story(
      withContext(appliedCustom, NOW_MS),
      Story.given(init({ id: "picker" })),
      Story.message(GotPopoverMessage({ message: Popover.RequestedOpen() })),
      Story.model((model) => {
        expect(model.maybeDraftRange).toEqual(
          Option.some({
            start: day(
              localStart.getFullYear(),
              localStart.getMonth(),
              localStart.getDate()
            ),
            end: day(
              localEnd.getFullYear(),
              localEnd.getMonth(),
              localEnd.getDate()
            ),
          })
        );
      })
    );
  });

  test("keeps the applied window's end month on the right-hand grid for long ranges", () => {
    const now = new Date(NOW_MS);

    Story.story(
      withContext(Preset({ preset: "allTime" }), NOW_MS),
      Story.given(init({ id: "picker" })),
      Story.message(GotPopoverMessage({ message: Popover.RequestedOpen() })),
      Story.model((model) => {
        expect(model.visibleMonth).toEqual({
          year: now.getFullYear(),
          month: now.getMonth() - 1,
        });
      })
    );
  });

  test("keeps a short preset's own start month visible", () => {
    Story.story(
      withContext(Preset({ preset: "last7d" }), NOW_MS),
      Story.given(init({ id: "picker" })),
      Story.message(GotPopoverMessage({ message: Popover.RequestedOpen() })),
      Story.model((model) => {
        expect(model.visibleMonth).toEqual({ year: 2026, month: 6 });
      })
    );
  });
});

describe("dateRangePicker update — dismissing the popover", () => {
  test("Escape or a backdrop click closes without applying or discarding drafts", () => {
    const openPopover = Popover.open(Popover.init({ id: "picker" }))[0];
    const model: Model = {
      ...init({ id: "picker" }),
      popover: openPopover,
      maybeDraftPreset: Option.some("ytd" as const),
    };

    Story.story(
      withContext(),
      Story.given(model),
      Story.message(GotPopoverMessage({ message: Popover.RequestedClose() })),
      Story.expectNoOutMessage(),
      Story.model((next) => {
        expect(next.popover.isOpen).toBe(false);
        // The stale draft is harmless: reopening reseeds it from the applied
        // selection.
        expect(next.maybeDraftPreset).toEqual(Option.some("ytd"));
      }),
      resolveFocusButton()
    );
  });
});

describe("dateRangePicker update — reopening an applied selection", () => {
  test("re-applying a reopened custom range emits the identical window", () => {
    const appliedCustom = Custom({
      startTime: new Date(day(2026, 6, 10)).toISOString(),
      endTime: new Date(endOfDay(2026, 6, 12)).toISOString(),
    });

    Story.story(
      withContext(appliedCustom, NOW_MS),
      Story.given(init({ id: "picker" })),
      Story.message(GotPopoverMessage({ message: Popover.RequestedOpen() })),
      Story.message(ClickedApply()),
      Story.expectOutMessage(AppliedRange({ selection: appliedCustom })),
      resolveFocusButton()
    );
  });
});

describe("dateRangePicker update — custom range selection", () => {
  test("picking a start day records it without committing a range", () => {
    Story.story(
      withContext(),
      Story.given(init({ id: "picker" })),
      Story.message(ClickedDay({ dateMs: day(2026, 6, 10) })),
      Story.model((model) => {
        expect(model.maybeRangeStart).toEqual(Option.some(day(2026, 6, 10)));
        expect(model.maybeDraftRange).toEqual(Option.none());
      })
    );
  });

  test("hovering after a start day previews the range without committing it", () => {
    Story.story(
      withContext(),
      Story.given(init({ id: "picker" })),
      Story.message(ClickedDay({ dateMs: day(2026, 6, 10) })),
      Story.message(HoveredDay({ dateMs: day(2026, 6, 15) })),
      Story.model((model) => {
        expect(model.maybeHoveredDay).toEqual(Option.some(day(2026, 6, 15)));
        expect(model.maybeDraftRange).toEqual(Option.none());
      })
    );
  });

  test("hovering with no start day selected is a no-op", () => {
    Story.story(
      withContext(),
      Story.given(init({ id: "picker" })),
      Story.message(HoveredDay({ dateMs: day(2026, 6, 15) })),
      Story.model((model) => {
        expect(model.maybeHoveredDay).toEqual(Option.none());
      })
    );
  });

  test("clicking a later day after the start commits an ordered range", () => {
    Story.story(
      withContext(),
      Story.given(init({ id: "picker" })),
      Story.message(ClickedDay({ dateMs: day(2026, 6, 10) })),
      Story.message(HoveredDay({ dateMs: day(2026, 6, 15) })),
      Story.message(ClickedDay({ dateMs: day(2026, 6, 20) })),
      Story.model((model) => {
        expect(model.maybeDraftRange).toEqual(
          Option.some({ start: day(2026, 6, 10), end: day(2026, 6, 20) })
        );
        expect(model.maybeRangeStart).toEqual(Option.none());
        expect(model.maybeHoveredDay).toEqual(Option.none());
      })
    );
  });

  test("clicking the same day twice commits a single-day range", () => {
    Story.story(
      withContext(),
      Story.given(init({ id: "picker" })),
      Story.message(ClickedDay({ dateMs: day(2026, 6, 10) })),
      Story.message(ClickedDay({ dateMs: day(2026, 6, 10) })),
      Story.message(ClickedApply()),
      Story.expectOutMessage(
        AppliedRange({
          selection: Custom({
            startTime: new Date(day(2026, 6, 10)).toISOString(),
            endTime: new Date(endOfDay(2026, 6, 10)).toISOString(),
          }),
        })
      )
    );
  });

  test("clicking an earlier day second still commits start <= end regardless of click order", () => {
    Story.story(
      withContext(),
      Story.given(init({ id: "picker" })),
      Story.message(ClickedDay({ dateMs: day(2026, 6, 20) })),
      Story.message(ClickedDay({ dateMs: day(2026, 6, 10) })),
      Story.model((model) => {
        expect(model.maybeDraftRange).toEqual(
          Option.some({ start: day(2026, 6, 10), end: day(2026, 6, 20) })
        );
      })
    );
  });
});

describe("dateRangePicker update — preset and custom drafts are mutually exclusive", () => {
  test("picking a preset clears an in-progress custom selection", () => {
    Story.story(
      withContext(),
      Story.given(init({ id: "picker" })),
      Story.message(ClickedDay({ dateMs: day(2026, 6, 10) })),
      Story.message(ClickedPreset({ preset: "qtd" })),
      Story.model((model) => {
        expect(model.maybeDraftPreset).toEqual(Option.some("qtd"));
        expect(model.maybeRangeStart).toEqual(Option.none());
        expect(model.maybeDraftRange).toEqual(Option.none());
      })
    );
  });

  test("picking a preset clears an already-committed custom draft range", () => {
    const model: Model = {
      ...init({ id: "picker" }),
      maybeDraftRange: Option.some({
        start: day(2026, 6, 10),
        end: day(2026, 6, 20),
      }),
    };

    Story.story(
      withContext(),
      Story.given(model),
      Story.message(ClickedPreset({ preset: "ytd" })),
      Story.model((next) => {
        expect(next.maybeDraftPreset).toEqual(Option.some("ytd"));
        expect(next.maybeDraftRange).toEqual(Option.none());
      })
    );
  });

  test("clicking a day clears a drafted preset", () => {
    const model: Model = {
      ...init({ id: "picker" }),
      maybeDraftPreset: Option.some("mtd" as const),
    };

    Story.story(
      withContext(),
      Story.given(model),
      Story.message(ClickedDay({ dateMs: day(2026, 6, 10) })),
      Story.model((next) => {
        expect(next.maybeDraftPreset).toEqual(Option.none());
        expect(next.maybeRangeStart).toEqual(Option.some(day(2026, 6, 10)));
      })
    );
  });
});

describe("dateRangePicker update — month navigation", () => {
  test("previous month rolls over the year boundary from January to December", () => {
    const model: Model = {
      ...init({ id: "picker" }),
      visibleMonth: { year: 2026, month: 0 },
    };

    Story.story(
      withContext(),
      Story.given(model),
      Story.message(ClickedPreviousMonth()),
      Story.model((next) => {
        expect(next.visibleMonth).toEqual({ year: 2025, month: 11 });
      })
    );
  });

  test("next month rolls over the year boundary from December to January", () => {
    const model: Model = {
      ...init({ id: "picker" }),
      visibleMonth: { year: 2025, month: 11 },
    };

    Story.story(
      withContext(),
      Story.given(model),
      Story.message(ClickedNextMonth()),
      Story.model((next) => {
        expect(next.visibleMonth).toEqual({ year: 2026, month: 0 });
      })
    );
  });

  test("month navigation within a year does not roll the year over", () => {
    const model: Model = {
      ...init({ id: "picker" }),
      visibleMonth: { year: 2026, month: 5 },
    };

    Story.story(
      withContext(),
      Story.given(model),
      Story.message(ClickedNextMonth()),
      Story.model((next) => {
        expect(next.visibleMonth).toEqual({ year: 2026, month: 6 });
      })
    );
  });
});

describe("dateRangePicker update — Apply", () => {
  test("Apply with a preset drafted emits AppliedRange with that preset", () => {
    const model: Model = {
      ...init({ id: "picker" }),
      maybeDraftPreset: Option.some("last7d" as const),
    };

    Story.story(
      withContext(),
      Story.given(model),
      Story.message(ClickedApply()),
      Story.expectOutMessage(
        AppliedRange({ selection: Preset({ preset: "last7d" }) })
      )
    );
  });

  test("Apply with a custom range drafted emits AppliedRange spanning the full start and end days", () => {
    const model: Model = {
      ...init({ id: "picker" }),
      maybeDraftRange: Option.some({
        start: day(2026, 6, 10),
        end: day(2026, 6, 12),
      }),
    };

    Story.story(
      withContext(),
      Story.given(model),
      Story.message(ClickedApply()),
      Story.expectOutMessage(
        AppliedRange({
          selection: Custom({
            startTime: new Date(day(2026, 6, 10)).toISOString(),
            endTime: new Date(
              day(2026, 6, 12) + 24 * 60 * 60 * 1000 - 1
            ).toISOString(),
          }),
        })
      )
    );
  });

  test("Apply with nothing drafted re-emits the currently-applied selection", () => {
    Story.story(
      withContext(),
      Story.given(init({ id: "picker" })),
      Story.message(ClickedApply()),
      Story.expectOutMessage(AppliedRange({ selection: APPLIED_LAST_30D }))
    );
  });

  test("Apply closes the popover", () => {
    const openPopover = Popover.open(Popover.init({ id: "picker" }))[0];
    const model: Model = { ...init({ id: "picker" }), popover: openPopover };

    Story.story(
      withContext(),
      Story.given(model),
      Story.message(ClickedApply()),
      Story.model((next) => {
        expect(next.popover.isOpen).toBe(false);
      }),
      resolveFocusButton()
    );
  });
});

describe("dateRangePicker update — Cancel", () => {
  test("Cancel discards an in-progress custom selection and re-applies the current selection's draft", () => {
    const model: Model = {
      ...init({ id: "picker" }),
      maybeRangeStart: Option.some(day(2026, 6, 10)),
      maybeHoveredDay: Option.some(day(2026, 6, 12)),
    };

    Story.story(
      withContext(),
      Story.given(model),
      Story.message(ClickedCancel()),
      Story.expectOutMessage(Cancelled()),
      Story.model((next) => {
        expect(next.maybeRangeStart).toEqual(Option.none());
        expect(next.maybeHoveredDay).toEqual(Option.none());
        expect(next.maybeDraftPreset).toEqual(Option.some("last30d"));
        expect(next.maybeDraftRange).toEqual(Option.none());
      })
    );
  });

  test("Cancel closes the popover", () => {
    const openPopover = Popover.open(Popover.init({ id: "picker" }))[0];
    const model: Model = { ...init({ id: "picker" }), popover: openPopover };

    Story.story(
      withContext(),
      Story.given(model),
      Story.message(ClickedCancel()),
      Story.model((next) => {
        expect(next.popover.isOpen).toBe(false);
      }),
      resolveFocusButton()
    );
  });

  test("Cancel discards a drafted preset that was never applied", () => {
    const model: Model = {
      ...init({ id: "picker" }),
      maybeDraftPreset: Option.some("allTime" as const),
    };

    Story.story(
      withContext(),
      Story.given(model),
      Story.message(ClickedCancel()),
      Story.expectOutMessage(Cancelled()),
      Story.model((next) => {
        expect(next.maybeDraftPreset).toEqual(Option.some("last30d"));
      })
    );
  });
});
