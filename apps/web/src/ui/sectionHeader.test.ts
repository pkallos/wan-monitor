import { Scene } from "foldkit";
import { describe, test } from "vitest";
import { sectionHeader } from "@/ui/sectionHeader";
import { renderStatic } from "@/ui/staticScene";

const render = (withActions: boolean) =>
  renderStatic((h) =>
    sectionHeader(h, {
      title: "Network Quality",
      actions: withActions ? h.button([h.Type("button")], ["Run"]) : undefined,
    })
  );

describe("sectionHeader", () => {
  test("titles the section with a heading", () => {
    render(false)(
      Scene.expect(Scene.role("heading", { name: "Network Quality" })).toExist()
    );
  });

  test("shows the actions beside the heading when given", () => {
    render(true)(Scene.expect(Scene.role("button", { name: "Run" })).toExist());
  });

  test("renders no actions slot otherwise", () => {
    render(false)(Scene.expect(Scene.role("button")).not.toExist());
  });
});
