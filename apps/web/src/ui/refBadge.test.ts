import { Scene } from "foldkit";
import { describe, test } from "vitest";
import { refBadge } from "@/ui/refBadge";
import { renderStatic } from "@/ui/staticScene";

describe("refBadge", () => {
  test("shows the incident's letter", () => {
    renderStatic((h) => refBadge(h, "B", "down", 26))(
      Scene.expect(Scene.text("B")).toExist()
    );
  });

  test("fills a down incident solid and rings a degraded one", () => {
    renderStatic((h) => refBadge(h, "A", "down", 26))(
      Scene.expect(Scene.text("A")).toHaveClass("bg-down")
    );
    renderStatic((h) => refBadge(h, "A", "degraded", 26))(
      Scene.expect(Scene.text("A")).toHaveClass("border-deg"),
      Scene.expect(Scene.text("A")).toHaveClass("bg-deg-bg")
    );
  });
});
