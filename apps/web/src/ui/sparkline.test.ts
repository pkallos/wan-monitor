import { Scene } from "foldkit";
import { describe, expect, test } from "vitest";
import {
  downsample,
  SPARKLINE_HEIGHT,
  SPARKLINE_WIDTH,
  sparkline,
  sparklinePath,
} from "@/ui/sparkline";
import { renderStatic } from "@/ui/staticScene";

const BOX = { width: 100, height: 20, padding: 2 };

describe("sparklinePath", () => {
  test("is empty when there is nothing to draw", () => {
    expect(sparklinePath([], BOX)).toBe("");
    expect(sparklinePath([null, null], BOX)).toBe("");
  });

  test("spans the full width and maps the min to the bottom and the max to the top", () => {
    expect(sparklinePath([0, 10], BOX)).toBe("M0 18L100 2");
  });

  test("keeps a rising series rising and a falling one falling", () => {
    expect(sparklinePath([1, 2, 3], BOX)).toBe("M0 18L50 10L100 2");
    expect(sparklinePath([3, 2, 1], BOX)).toBe("M0 2L50 10L100 18");
  });

  test("draws a flat series as a centered line rather than dividing by zero", () => {
    expect(sparklinePath([5, 5, 5], BOX)).toBe("M0 10L50 10L100 10");
  });

  test("draws a lone point as a zero-length segment so it still renders a dot", () => {
    expect(sparklinePath([7], BOX)).toBe("M50 10L50 10");
  });

  test("breaks the line at a gap instead of bridging it", () => {
    expect(sparklinePath([0, null, 10], BOX)).toBe("M0 18L0 18M100 2L100 2");
    expect(sparklinePath([0, 10, null, 0, 10], BOX)).toBe(
      "M0 18L25 2M75 18L100 2"
    );
  });

  test("rounds coordinates to two decimals", () => {
    expect(sparklinePath([0, 1, 2, 3], { ...BOX, width: 10 })).toBe(
      "M0 18L3.33 12.67L6.67 7.33L10 2"
    );
  });
});

describe("downsample", () => {
  test("returns the series untouched when it already fits", () => {
    expect(downsample([1, null, 3], 3)).toEqual([1, null, 3]);
    expect(downsample([1, 2], 10)).toEqual([1, 2]);
  });

  test("averages each bucket down to the requested point count", () => {
    expect(downsample([1, 3, 5, 7], 2)).toEqual([2, 6]);
    expect(downsample([1, 2, 3, 4, 5, 6], 3)).toEqual([1.5, 3.5, 5.5]);
  });

  test("ignores gaps within a bucket and keeps a fully empty bucket a gap", () => {
    expect(downsample([1, null, null, null, 5, 7], 3)).toEqual([1, null, 6]);
  });

  test("never returns more than the requested number of points for an uneven split", () => {
    const result = downsample(
      Array.from({ length: 10 }, (_, i) => i),
      3
    );

    expect(result).toHaveLength(3);
    expect(result.every((value) => value !== null)).toBe(true);
  });
});

describe("sparkline", () => {
  const render = (values: ReadonlyArray<number | null>) =>
    renderStatic((h) => sparkline(h, { values, className: "text-accent" }));

  test("is decorative and carries its caller class", () => {
    render([1, 2, 3])(
      Scene.expect(Scene.selector("svg")).toHaveAttr("aria-hidden", "true"),
      Scene.expect(Scene.selector("svg")).toHaveClass("text-accent"),
      Scene.expect(Scene.selector("svg")).toHaveAttr(
        "viewBox",
        `0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`
      )
    );
  });

  test("strokes its path with currentColor, unfilled", () => {
    render([1, 2, 3])(
      Scene.expect(Scene.selector("svg path")).toHaveAttr(
        "stroke",
        "currentColor"
      ),
      Scene.expect(Scene.selector("svg path")).toHaveAttr("fill", "none")
    );
  });

  test("draws no path for an empty series but keeps the box", () => {
    render([])(
      Scene.expect(Scene.selector("svg")).toExist(),
      Scene.expect(Scene.selector("svg path")).not.toExist()
    );
  });

  test("keeps its drawing inside the viewBox", () => {
    const path = sparklinePath([3, 9, 1, 4], {
      width: SPARKLINE_WIDTH,
      height: SPARKLINE_HEIGHT,
      padding: 2,
    });
    const coordinates = path.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];

    expect(coordinates.length).toBeGreaterThan(0);
    for (const [index, value] of coordinates.entries()) {
      const limit = index % 2 === 0 ? SPARKLINE_WIDTH : SPARKLINE_HEIGHT;
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(limit);
    }
  });
});
