import { Scene } from "foldkit";
import { describe, test } from "vitest";
import { type FigureTileContent, figureTile } from "@/ui/figureTile";
import { renderStatic } from "@/ui/staticScene";

const FIGURE: FigureTileContent = {
  label: "Latency",
  value: "12.3",
  unit: "ms",
  caption: "avg",
  series: [10, 12, 15],
};

const render = (isLoading: boolean, variant: "hero" | "kpi" = "hero") =>
  renderStatic((h) =>
    figureTile(h, {
      figure: FIGURE,
      variant,
      isLoading,
      testId: "latency-tile",
    })
  );

describe("figureTile", () => {
  test("shows the label, value, unit and caption", () => {
    render(false)(
      Scene.expect(Scene.role("heading", { name: "Latency" })).toExist(),
      Scene.expect(Scene.text("12.3")).toExist(),
      Scene.expect(Scene.text("ms")).toExist(),
      Scene.expect(Scene.text("avg")).toExist()
    );
  });

  test("draws the series as a sparkline", () => {
    render(false)(Scene.expect(Scene.selector("svg path")).toExist());
  });

  test("is addressable by its test id", () => {
    render(false)(Scene.expect(Scene.testId("latency-tile")).toExist());
  });

  test("keeps the value on a single line", () => {
    render(false)(
      Scene.expect(Scene.selector("span.whitespace-nowrap")).toHaveText("12.3")
    );
  });

  test("swaps the numbers for skeletons while loading, keeping the label", () => {
    render(true)(
      Scene.expect(Scene.role("heading", { name: "Latency" })).toExist(),
      Scene.expect(Scene.role("status", { name: "Loading latency" })).toExist(),
      Scene.expect(Scene.text("12.3")).not.toExist(),
      Scene.expect(Scene.selector("svg path")).not.toExist()
    );
  });

  test("shows a short value at display size and steps a long pair down so it never wraps or clips", () => {
    const withValue = (value: string) =>
      renderStatic((h) =>
        figureTile(h, {
          figure: { ...FIGURE, value },
          variant: "hero",
          isLoading: false,
          testId: "latency-tile",
        })
      );

    withValue("886 / 883")(
      Scene.expect(Scene.selector("p")).toHaveClass("md:text-[38px]"),
      Scene.expect(Scene.selector("p")).not.toHaveClass("md:text-[28px]")
    );
    withValue("99.5 / 45.2")(
      Scene.expect(Scene.selector("p")).toHaveClass("md:text-[28px]")
    );
  });

  test("sits on the status field as a hero and on the page as a kpi", () => {
    render(
      false,
      "hero"
    )(
      Scene.expect(Scene.testId("latency-tile")).toHaveClass(
        "border-field-rule"
      )
    );
    render(
      false,
      "kpi"
    )(Scene.expect(Scene.testId("latency-tile")).toHaveClass("border-rule"));
  });
});
