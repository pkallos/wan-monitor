import { Scene } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { describe, test } from "vitest";
import { card } from "@/ui/card";
import { renderStatic } from "@/ui/staticScene";

const render = (
  options: Parameters<typeof card>[1],
  body: (h: HtmlBuilder<never>) => Html
) => renderStatic((h) => card(h, options, [body(h)]));

describe("card", () => {
  test("renders its children inside a div by default", () => {
    render({}, (h) => h.p([], ["inside"]))(
      Scene.expect(Scene.selector("div p")).toExist(),
      Scene.expect(Scene.text("inside")).toExist(),
      Scene.expect(Scene.selector("section")).not.toExist()
    );
  });

  test("renders a section element on request", () => {
    render({ as: "section" }, (h) => h.p([], ["inside"]))(
      Scene.expect(Scene.selector("section p")).toExist(),
      Scene.expect(Scene.selector("div")).not.toExist()
    );
  });

  test("passes the caller class through to the root element", () => {
    render({ className: "mb-6" }, (h) => h.p([], ["inside"]))(
      Scene.expect(Scene.selector("div p")).toExist(),
      Scene.expect(Scene.selector("div")).toHaveClass("mb-6")
    );
  });
});
