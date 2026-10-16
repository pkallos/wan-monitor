import { describe, expect, test } from "vitest";
import { carryZoom, FULL_ZOOM } from "@/dashboard/charts/zoom";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const NOW = Date.parse("2026-07-27T00:00:00.000Z");
const lastDay = (endMs: number) => ({ startMs: endMs - DAY_MS, endMs });

describe("carryZoom", () => {
  test("a repaint of the same window keeps the zoom as it is", () => {
    const window = lastDay(NOW);

    expect(carryZoom({ start: 20, end: 50 }, window, window)).toEqual({
      start: 20,
      end: 50,
    });
  });

  test("a window that rolled forward keeps the same span of time zoomed", () => {
    const zoomed = { start: 50, end: 75 };

    const carried = carryZoom(zoomed, lastDay(NOW), lastDay(NOW + HOUR_MS));

    // The viewed span began 12h into the old window, which is 11h into the
    // new one, and lasts 6h of its 24h.
    expect(carried.start).toBeCloseTo((11 / 24) * 100);
    expect(carried.end).toBeCloseTo((17 / 24) * 100);
  });

  test("a growing window keeps the same span of time zoomed", () => {
    const previous = { startMs: NOW - DAY_MS, endMs: NOW };
    const next = { startMs: NOW - DAY_MS, endMs: NOW + HOUR_MS };

    const carried = carryZoom({ start: 0, end: 50 }, previous, next);

    expect(carried.start).toBeCloseTo(0);
    expect(carried.end).toBeCloseTo((12 / 25) * 100);
  });

  test("a zoom over the whole window stays over the whole window", () => {
    expect(carryZoom(FULL_ZOOM, lastDay(NOW), lastDay(NOW + HOUR_MS))).toEqual(
      FULL_ZOOM
    );
  });

  test("a different window starts fully zoomed out", () => {
    const week = { startMs: NOW - 7 * DAY_MS, endMs: NOW };

    expect(carryZoom({ start: 20, end: 50 }, lastDay(NOW), week)).toEqual(
      FULL_ZOOM
    );
  });

  test("a brushed span inside the previous window starts fully zoomed out", () => {
    const brushed = { startMs: NOW - 6 * HOUR_MS, endMs: NOW - 3 * HOUR_MS };

    expect(carryZoom({ start: 20, end: 50 }, lastDay(NOW), brushed)).toEqual(
      FULL_ZOOM
    );
  });

  test("a window that moved past the zoomed span starts fully zoomed out", () => {
    const previous = { startMs: NOW - DAY_MS, endMs: NOW };
    const next = {
      startMs: NOW - DAY_MS + 2 * HOUR_MS,
      endMs: NOW + 2 * HOUR_MS,
    };

    expect(carryZoom({ start: 0, end: 5 }, previous, next)).toEqual(FULL_ZOOM);
  });

  test("a window that overlaps the old one by only half is a different selection", () => {
    const previous = { startMs: 0, endMs: 1000 };
    const next = { startMs: 450, endMs: 1450 };

    expect(carryZoom({ start: 20, end: 40 }, previous, next)).toEqual(
      FULL_ZOOM
    );
  });

  test("a window overlapping by exactly nine tenths is still the same selection", () => {
    const previous = { startMs: 0, endMs: 1000 };
    const next = { startMs: 100, endMs: 1100 };

    expect(carryZoom({ start: 10, end: 50 }, previous, next)).toEqual({
      start: 0,
      end: 40,
    });
  });

  test("a window overlapping by just under nine tenths is a different selection", () => {
    const previous = { startMs: 0, endMs: 1000 };
    const next = { startMs: 101, endMs: 1101 };

    expect(carryZoom({ start: 10, end: 50 }, previous, next)).toEqual(
      FULL_ZOOM
    );
  });

  test("a zoomed span that runs past the new window's end is cut off at the end", () => {
    const previous = { startMs: 100, endMs: 1100 };
    const next = { startMs: 0, endMs: 1000 };

    expect(carryZoom({ start: 10, end: 95 }, previous, next)).toEqual({
      start: 20,
      end: 100,
    });
  });
});
