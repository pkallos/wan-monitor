import { Scene } from "foldkit";
import { describe, test } from "vitest";
import { skeleton } from "@/ui/skeleton";
import { renderStatic } from "@/ui/staticScene";

const render = renderStatic((h) => skeleton(h, "h-6 w-full"));

describe("skeleton", () => {
  test("is a decorative placeholder hidden from assistive tech", () => {
    render(
      Scene.expect(Scene.selector("div.bg-track")).toHaveAttr(
        "aria-hidden",
        "true"
      )
    );
  });

  test("passes the caller class through to the element", () => {
    render(
      Scene.expect(Scene.selector("div[aria-hidden='true']")).toHaveClass(
        "h-6"
      ),
      Scene.expect(Scene.selector("div[aria-hidden='true']")).toHaveClass(
        "w-full"
      )
    );
  });

  test("only pulses when the viewer allows motion", () => {
    render(
      Scene.expect(Scene.selector("div.bg-track")).toHaveClass(
        "motion-safe:animate-pulse"
      )
    );
  });
});
