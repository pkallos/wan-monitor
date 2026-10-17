import { Array as Array_, Option, Record } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";
import type { IconNode } from "lucide";

export type IconOptions = Readonly<{
  size?: number;
  strokeWidth?: number;
  className?: string;
}>;

const DEFAULT_SIZE_PX = 20;
const DEFAULT_STROKE_WIDTH = 2;

/**
 * Renders a lucide `IconNode` as a decorative inline SVG. It strokes with
 * `currentColor`, so the icon takes its colour from the surrounding text.
 * Shapes outside the set lucide actually emits are skipped rather than
 * rendered as unknown elements.
 */
export const icon = <Message>(
  h: HtmlBuilder<Message>,
  node: IconNode,
  {
    size = DEFAULT_SIZE_PX,
    strokeWidth = DEFAULT_STROKE_WIDTH,
    className = "",
  }: IconOptions = {}
): Html => {
  const shapes: Record<string, typeof h.path> = {
    path: h.path,
    circle: h.circle,
    ellipse: h.ellipse,
    rect: h.rect,
    line: h.line,
    polyline: h.polyline,
    polygon: h.polygon,
  };

  return h.svg(
    [
      h.Attribute("viewBox", "0 0 24 24"),
      h.Attribute("width", String(size)),
      h.Attribute("height", String(size)),
      h.Attribute("fill", "none"),
      h.Attribute("stroke", "currentColor"),
      h.Attribute("stroke-width", String(strokeWidth)),
      h.Attribute("stroke-linecap", "round"),
      h.Attribute("stroke-linejoin", "round"),
      h.Attribute("aria-hidden", "true"),
      h.Attribute("focusable", "false"),
      h.Class(`shrink-0 ${className}`.trim()),
    ],
    Array_.flatMap(node, ([tag, attrs]) =>
      Option.match(Record.get(shapes, tag), {
        onNone: () => [],
        onSome: (shape) => [
          shape(
            Array_.flatMap(Record.toEntries(attrs), ([name, value]) =>
              value === undefined ? [] : [h.Attribute(name, String(value))]
            ),
            []
          ),
        ],
      })
    )
  );
};
