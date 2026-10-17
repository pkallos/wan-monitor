import { Scene } from "foldkit";
import { describe, test } from "vitest";
import { renderStatic } from "@/ui/staticScene";
import {
  type GlyphKind,
  hatchDefinitions,
  statusGlyph,
} from "@/ui/statusGlyph";

const render = (kind: GlyphKind) => renderStatic((h) => statusGlyph(h, kind));

describe("statusGlyph", () => {
  test.each(["healthy", "degraded", "outage", "noData"] as const)(
    "is decorative for %s",
    (kind) => {
      render(kind)(
        Scene.expect(Scene.selector("svg")).toHaveAttr("aria-hidden", "true")
      );
    }
  );

  test("fills healthy solid in the up color", () => {
    render("healthy")(
      Scene.expect(Scene.selector("circle")).toHaveClass("fill-up"),
      Scene.expect(Scene.selector("line")).not.toExist()
    );
  });

  test("hatches degraded rather than filling it", () => {
    render("degraded")(
      Scene.expect(Scene.selector("circle")).toHaveAttr(
        "fill",
        "url(#wm-hatch)"
      ),
      Scene.expect(Scene.selector("circle")).toHaveClass("stroke-deg")
    );
  });

  test("strikes an outage through, in the down color", () => {
    render("outage")(
      Scene.expect(Scene.selector("circle")).toHaveClass("fill-down"),
      Scene.expect(Scene.selector("line")).toExist()
    );
  });

  test("draws no data as a hollow dashed ring", () => {
    render("noData")(
      Scene.expect(Scene.selector("circle")).toHaveClass("fill-none"),
      Scene.expect(Scene.selector("circle")).toHaveAttr(
        "stroke-dasharray",
        "2 2"
      )
    );
  });
});

describe("hatchDefinitions", () => {
  test("defines the pattern the degraded fills point at", () => {
    renderStatic((h) => hatchDefinitions(h))(
      Scene.expect(Scene.selector("pattern")).toHaveId("wm-hatch")
    );
  });
});
