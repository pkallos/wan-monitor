import type { Html, HtmlBuilder } from "foldkit/html";

export type GlyphKind = "healthy" | "degraded" | "outage" | "noData";

/** The id of the `<pattern>` the degraded glyph fills with; the dashboard defines it once. */
const HATCH_PATTERN_ID = "wm-hatch";

const SIZE_PX = 14;

// Each state has a shape of its own as well as a colour: solid for healthy,
// hatched for degraded, struck through for an outage, dashed and hollow for
// no data.
const SHAPES: Record<GlyphKind, { circle: string; strike: boolean }> = {
  healthy: { circle: "fill-up stroke-up", strike: false },
  degraded: { circle: "stroke-deg", strike: false },
  outage: { circle: "fill-down stroke-down", strike: true },
  noData: { circle: "fill-none stroke-nodata", strike: false },
};

export const statusGlyph = <Message>(
  h: HtmlBuilder<Message>,
  kind: GlyphKind,
  size: number = SIZE_PX
): Html => {
  const shape = SHAPES[kind];
  return h.svg(
    [
      h.Attribute("width", String(size)),
      h.Attribute("height", String(size)),
      h.Attribute("viewBox", "0 0 14 14"),
      h.Attribute("aria-hidden", "true"),
      h.Class("flex-shrink-0"),
    ],
    [
      h.circle(
        [
          h.Attribute("cx", "7"),
          h.Attribute("cy", "7"),
          h.Attribute("r", "5.6"),
          h.Attribute("stroke-width", "1.4"),
          h.Class(shape.circle),
          ...(kind === "degraded"
            ? [h.Attribute("fill", `url(#${HATCH_PATTERN_ID})`)]
            : []),
          ...(kind === "noData"
            ? [h.Attribute("stroke-dasharray", "2 2")]
            : []),
        ],
        []
      ),
      ...(shape.strike
        ? [
            h.line(
              [
                h.Attribute("x1", "2.2"),
                h.Attribute("y1", "11.8"),
                h.Attribute("x2", "11.8"),
                h.Attribute("y2", "2.2"),
                h.Attribute("stroke-width", "1.8"),
                h.Class("stroke-card"),
              ],
              []
            ),
          ]
        : []),
    ]
  );
};

/** Defines the hatch fill once for the page; render it near the root and reference it by id. */
export const hatchDefinitions = <Message>(h: HtmlBuilder<Message>): Html =>
  h.svg(
    [
      h.Attribute("width", "0"),
      h.Attribute("height", "0"),
      h.Attribute("aria-hidden", "true"),
      h.Attribute("focusable", "false"),
      h.Class("absolute"),
    ],
    [
      h.defs(
        [],
        [
          h.pattern(
            [
              h.Id(HATCH_PATTERN_ID),
              h.Attribute("width", "5"),
              h.Attribute("height", "5"),
              h.Attribute("patternUnits", "userSpaceOnUse"),
              h.Attribute("patternTransform", "rotate(45)"),
            ],
            [
              h.rect(
                [
                  h.Attribute("width", "5"),
                  h.Attribute("height", "5"),
                  h.Class("fill-deg-bg"),
                ],
                []
              ),
              h.line(
                [
                  h.Attribute("x1", "0"),
                  h.Attribute("y1", "0"),
                  h.Attribute("x2", "0"),
                  h.Attribute("y2", "5"),
                  h.Attribute("stroke-width", "2.6"),
                  h.Class("stroke-deg"),
                ],
                []
              ),
            ]
          ),
        ]
      ),
    ]
  );
