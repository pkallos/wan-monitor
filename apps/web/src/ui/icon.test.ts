import { Scene } from "foldkit";
import type { IconNode } from "lucide";
import { describe, test } from "vitest";
import { type IconOptions, icon } from "@/ui/icon";
import { renderStatic } from "@/ui/staticScene";

const scene = (node: IconNode, options?: IconOptions) =>
  renderStatic((h) => icon(h, node, options));

const CIRCLE_AND_LINE: IconNode = [
  ["circle", { cx: "12", cy: "12", r: "10" }],
  ["line", { x1: "12", x2: "12", y1: "8", y2: "12" }],
];

describe("icon", () => {
  test("is decorative: hidden from assistive tech and not focusable", () => {
    scene(CIRCLE_AND_LINE)(
      Scene.expect(Scene.selector("svg")).toHaveAttr("aria-hidden", "true"),
      Scene.expect(Scene.selector("svg")).toHaveAttr("focusable", "false")
    );
  });

  test("draws with currentColor strokes on lucide's 24px grid", () => {
    scene(CIRCLE_AND_LINE)(
      Scene.expect(Scene.selector("svg")).toHaveAttr("viewBox", "0 0 24 24"),
      Scene.expect(Scene.selector("svg")).toHaveAttr("fill", "none"),
      Scene.expect(Scene.selector("svg")).toHaveAttr("stroke", "currentColor"),
      Scene.expect(Scene.selector("svg")).toHaveAttr("stroke-linecap", "round"),
      Scene.expect(Scene.selector("svg")).toHaveAttr("stroke-linejoin", "round")
    );
  });

  test("defaults to a 20px icon with a 2px stroke", () => {
    scene(CIRCLE_AND_LINE)(
      Scene.expect(Scene.selector("svg")).toHaveAttr("width", "20"),
      Scene.expect(Scene.selector("svg")).toHaveAttr("height", "20"),
      Scene.expect(Scene.selector("svg")).toHaveAttr("stroke-width", "2")
    );
  });

  test("honors a custom size and stroke width", () => {
    scene(CIRCLE_AND_LINE, { size: 16, strokeWidth: 1.5 })(
      Scene.expect(Scene.selector("svg")).toHaveAttr("width", "16"),
      Scene.expect(Scene.selector("svg")).toHaveAttr("height", "16"),
      Scene.expect(Scene.selector("svg")).toHaveAttr("stroke-width", "1.5")
    );
  });

  test("appends a caller class after the shrink guard", () => {
    scene(CIRCLE_AND_LINE, { className: "text-up" })(
      Scene.expect(Scene.selector("svg")).toHaveClass("shrink-0"),
      Scene.expect(Scene.selector("svg")).toHaveClass("text-up")
    );
  });

  test("renders every shape of the icon node with its attributes", () => {
    scene(CIRCLE_AND_LINE)(
      Scene.expect(Scene.selector("svg circle")).toHaveAttr("r", "10"),
      Scene.expect(Scene.selector("svg line")).toHaveAttr("y2", "12")
    );
  });

  test("stringifies numeric attributes and drops undefined ones", () => {
    scene([["rect", { x: 3, y: 4, width: 18, height: 18, rx: undefined }]])(
      Scene.expect(Scene.selector("svg rect")).toHaveAttr("width", "18"),
      Scene.expect(Scene.selector("svg rect")).not.toHaveAttr("rx")
    );
  });

  test("skips shapes it has no builder for instead of throwing", () => {
    scene([
      ["path", { d: "M0 0" }],
      ["blink", { d: "M1 1" }],
    ])(
      Scene.expect(Scene.selector("svg path")).toExist(),
      Scene.expect(Scene.selector("svg blink")).not.toExist()
    );
  });
});
