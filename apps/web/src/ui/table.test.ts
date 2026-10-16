import { Scene } from "foldkit";
import { describe, test } from "vitest";
import { renderStatic } from "@/ui/staticScene";
import { scrollableTable } from "@/ui/table";

const body = (h: Parameters<Parameters<typeof renderStatic>[0]>[0]) =>
  h.table(
    [h.AriaLabel("Rows")],
    [h.tbody([], [h.tr([], [h.td([], ["cell"])])])]
  );

describe("scrollableTable", () => {
  test("keeps the table and its accessible name", () => {
    renderStatic((h) => scrollableTable(h, body(h)))(
      Scene.expect(Scene.role("table", { name: "Rows" })).toExist()
    );
  });

  test("adds no tab stop or landmark around the table", () => {
    renderStatic((h) => scrollableTable(h, body(h), { from: "lg" }))(
      Scene.expectAll(Scene.all.selector("[tabindex]")).toHaveCount(0),
      Scene.expectAll(Scene.all.role("region")).toHaveCount(0)
    );
  });
});
