import { Scene } from "foldkit";
import { describe, test } from "vitest";
import { renderStatic } from "@/ui/staticScene";
import { type StatusTone, statusBadge } from "@/ui/statusBadge";

const render = (tone: StatusTone, iconSize?: number) =>
  renderStatic((h) => statusBadge(h, { tone, label: "Online", iconSize }));

describe("statusBadge", () => {
  test("pairs a glyph with the status word, so it never relies on colour alone", () => {
    render("good")(
      Scene.expect(Scene.text("Online")).toExist(),
      Scene.expect(Scene.selector("svg")).toHaveAttr("aria-hidden", "true")
    );
  });

  test.each([
    ["good", "text-up"],
    ["warning", "text-deg-text"],
    ["error", "text-down"],
    ["neutral", "text-ink-2"],
  ] as const)("colors the %s tone with %s", (tone, className) => {
    render(tone)(Scene.expect(Scene.selector(`span.${className}`)).toExist());
  });

  test("sizes the glyph to match its text", () => {
    render(
      "good",
      28
    )(Scene.expect(Scene.selector("svg")).toHaveAttr("width", "28"));
  });
});
