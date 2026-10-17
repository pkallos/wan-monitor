import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * The per-host latency lines are told apart by colour alone, so the series
 * tokens in `styles.css` are checked here, in both themes: each has to stand
 * out from the card behind it, stay clear of the status colours the incident
 * marks use on the same chart, keep its hue across themes, and the first three
 * (the fewest hosts the feature is for) have to stay apart for the common
 * kinds of colour blindness.
 */

const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");

const SERIES_COUNT = 6;
const GUARANTEED_DISTINCT = 3;
const MIN_CONTRAST = 3;
const MIN_DELTA_E_GUARANTEED = 25;
const MIN_DELTA_E_ALL = 20;
const MIN_DELTA_E_STATUS = 20;
const STATUS_TOKENS = ["up", "deg", "down"] as const;
const MAX_HUE_SHIFT_DEGREES = 20;
const MIN_HUE_CHROMA = 10;

const blockOf = (selector: string): string => {
  const start = css.indexOf(`${selector} {`);
  const end = css.indexOf("}", start);
  return css.slice(start, end);
};

const tokensOf = (selector: string): Record<string, string> => {
  const block = blockOf(selector);
  return Object.fromEntries(
    [...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map(
      ([, name, value]) => [name, value]
    )
  );
};

const themes = {
  light: tokensOf(":root"),
  dark: tokensOf(".dark"),
};

const seriesOf = (tokens: Record<string, string>): ReadonlyArray<string> =>
  Array.from({ length: SERIES_COUNT }, (_, i) => tokens[`series-${i + 1}`]);

type Rgb = readonly [number, number, number];

const toRgb = (hex: string): Rgb => [
  Number.parseInt(hex.slice(1, 3), 16) / 255,
  Number.parseInt(hex.slice(3, 5), 16) / 255,
  Number.parseInt(hex.slice(5, 7), 16) / 255,
];

const toLinear = (channel: number): number =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

const luminance = (hex: string): number => {
  const [r, g, b] = toRgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrastRatio = (a: string, b: string): number => {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
};

// Machado, Oliveira and Fernandes (2009), full severity, in linear RGB.
const VISIONS: Record<string, ReadonlyArray<Rgb>> = {
  normal: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const toLab = (hex: string, vision: ReadonlyArray<Rgb>): Rgb => {
  const linear = toRgb(hex).map(toLinear);
  const [r, g, b] = vision.map((row) =>
    clamp01(row[0] * linear[0] + row[1] * linear[1] + row[2] * linear[2])
  );
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number): number =>
    t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
};

const deltaE = (a: string, b: string, vision: ReadonlyArray<Rgb>): number => {
  const [l1, a1, b1] = toLab(a, vision);
  const [l2, a2, b2] = toLab(b, vision);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
};

const hueOf = (hex: string): { degrees: number; chroma: number } => {
  const [, a, b] = toLab(hex, VISIONS.normal);
  return {
    degrees: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360,
    chroma: Math.hypot(a, b),
  };
};

const hueDistance = (a: number, b: number): number => {
  const gap = Math.abs(a - b) % 360;
  return Math.min(gap, 360 - gap);
};

const pairs = <A>(items: ReadonlyArray<A>): ReadonlyArray<readonly [A, A]> =>
  items.flatMap((a, i) => items.slice(i + 1).map((b) => [a, b] as const));

describe.each(Object.entries(themes))("%s series colours", (_name, tokens) => {
  const series = seriesOf(tokens);

  test("defines all six as hex colours", () => {
    expect(series.every((colour) => /^#[0-9a-fA-F]{6}$/.test(colour))).toBe(
      true
    );
  });

  test("each stands out from the card behind it", () => {
    for (const colour of series) {
      expect(contrastRatio(colour, tokens.card)).toBeGreaterThanOrEqual(
        MIN_CONTRAST
      );
    }
  });

  test.each(Object.entries(VISIONS))(
    "the first three stay apart under %s",
    (_vision, matrix) => {
      for (const [a, b] of pairs(series.slice(0, GUARANTEED_DISTINCT))) {
        expect(deltaE(a, b, matrix)).toBeGreaterThanOrEqual(
          MIN_DELTA_E_GUARANTEED
        );
      }
    }
  );

  test.each(STATUS_TOKENS)("none is mistakable for --%s", (status) => {
    for (const colour of series) {
      expect(
        deltaE(colour, tokens[status], VISIONS.normal)
      ).toBeGreaterThanOrEqual(MIN_DELTA_E_STATUS);
    }
  });

  test("all six stay apart for normal vision", () => {
    for (const [a, b] of pairs(series)) {
      expect(deltaE(a, b, VISIONS.normal)).toBeGreaterThanOrEqual(
        MIN_DELTA_E_ALL
      );
    }
  });
});

describe("series colours across themes", () => {
  test("each keeps its hue family, so a host does not change colour with the theme", () => {
    const light = seriesOf(themes.light);
    const dark = seriesOf(themes.dark);

    light.forEach((colour, index) => {
      const lightHue = hueOf(colour);
      const darkHue = hueOf(dark[index]);
      if (Math.min(lightHue.chroma, darkHue.chroma) < MIN_HUE_CHROMA) return;
      expect(
        hueDistance(lightHue.degrees, darkHue.degrees)
      ).toBeLessThanOrEqual(MAX_HUE_SHIFT_DEGREES);
    });
  });
});

// The p95 band's fill (`--chart-band`) is a faint wash, so the line along its
// upper edge, drawn in the accent, is what carries p95.
describe.each(Object.entries(themes))(
  "%s p95 band outline",
  (_name, tokens) => {
    test("stands out from the card behind it", () => {
      expect(contrastRatio(tokens.accent, tokens.card)).toBeGreaterThanOrEqual(
        MIN_CONTRAST
      );
    });
  }
);
