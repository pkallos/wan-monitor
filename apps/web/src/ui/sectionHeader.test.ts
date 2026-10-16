import { Scene } from "foldkit";
import { describe, test } from "vitest";
import { sectionHeader } from "@/ui/sectionHeader";
import { renderStatic } from "@/ui/staticScene";

const render = (withActions: boolean, subtitle?: string) =>
  renderStatic((h) =>
    sectionHeader(h, {
      title: "Network Quality",
      subtitle,
      actions: withActions ? h.button([h.Type("button")], ["Run"]) : undefined,
    })
  );

describe("sectionHeader", () => {
  test("titles the section with a heading", () => {
    render(false)(
      Scene.expect(Scene.role("heading", { name: "Network Quality" })).toExist()
    );
  });

  test("is a level 2 heading, below the page title and above card labels", () => {
    render(false)(
      Scene.expect(
        Scene.role("heading", { name: "Network Quality", level: 2 })
      ).toExist()
    );
  });

  test("renders a muted subtitle under the title when given", () => {
    render(
      false,
      "All hosts, averaged"
    )(Scene.expect(Scene.text("All hosts, averaged")).toExist());
  });

  test("renders no subtitle otherwise", () => {
    render(false)(Scene.expect(Scene.selector("p")).not.toExist());
  });

  test("shows the actions beside the heading when given", () => {
    render(true)(Scene.expect(Scene.role("button", { name: "Run" })).toExist());
  });

  test("renders no actions slot otherwise", () => {
    render(false)(Scene.expect(Scene.role("button")).not.toExist());
  });
});
