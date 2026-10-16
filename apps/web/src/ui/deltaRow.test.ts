import { Scene } from "foldkit";
import { describe, test } from "vitest";
import type { Delta } from "@/dashboard/deltas";
import { deltaRow } from "@/ui/deltaRow";
import { renderStatic } from "@/ui/staticScene";

const render = (delta: Delta, className?: string) =>
  renderStatic((h) => deltaRow(h, delta, className));

describe("deltaRow", () => {
  test("spells out the signed change, the verdict word and the baseline", () => {
    render({
      text: "+1.1 ms",
      word: "worse",
      tone: "bad",
      rest: "vs 13.1 ms prev.",
    })(
      Scene.expect(Scene.text("+1.1 ms worse")).toExist(),
      Scene.expect(Scene.text("vs 13.1 ms prev.")).toExist()
    );
  });

  test.each([
    ["good", "better", "text-up"],
    ["bad", "worse", "text-down"],
    ["neutral", "steady", "text-ink-2"],
  ] as const)(
    "tones a %s change as %s and gives it a glyph of its own",
    (tone, word, toneClass) => {
      render({ text: "+0.1 ms", word, tone, rest: "vs 1 ms prev." })(
        Scene.expect(
          Scene.selector(`span.${toneClass} svg[aria-hidden="true"]`)
        ).toExist(),
        Scene.expect(Scene.selector(`p[data-delta="${word}"]`)).toExist()
      );
    }
  );

  test("takes its spacing and size from the caller", () => {
    render(
      { text: "+0.1 ms", word: "worse", tone: "bad", rest: "vs 1 ms prev." },
      "mt-3 text-sm"
    )(
      Scene.expect(Scene.selector("p[data-delta]")).toHaveClass("mt-3"),
      Scene.expect(Scene.selector("p[data-delta]")).toHaveClass("text-sm")
    );
  });
});
