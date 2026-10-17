import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const css = readFileSync(join(import.meta.dirname, "styles.css"), "utf8");

const MIN_TEXT_CONTRAST = 4.5;

type Theme = "light" | "dark";

const BLOCK_PATTERN: Record<Theme, RegExp> = {
  light: /^:root\s*\{([^}]*)\}/m,
  dark: /^\.dark\s*\{([^}]*)\}/m,
};

const readTokens = (theme: Theme): Map<string, string> => {
  const body = BLOCK_PATTERN[theme].exec(css)?.[1] ?? "";
  return new Map(
    [...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].flatMap(
      ([, name, value]) => (name && value ? [[name, value] as const] : [])
    )
  );
};

const channelLuminance = (channel: number): number => {
  const normalised = channel / 255;
  return normalised <= 0.03928
    ? normalised / 12.92
    : ((normalised + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((start) =>
    channelLuminance(Number.parseInt(hex.slice(start, start + 2), 16))
  );
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
};

const contrastRatio = (foreground: string, background: string): number => {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a
  );
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
};

const SURFACES = ["bg", "card", "field"] as const;

const TEXT_ON_SURFACES = [
  "ink",
  "ink-2",
  "accent",
  "up",
  "deg-text",
  "down",
] as const;

const TEXT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ...TEXT_ON_SURFACES.flatMap((text) =>
    SURFACES.map((surface) => [text, surface] as const)
  ),
  ["on-accent", "accent"],
  ["deg-text", "deg-bg"],
];

describe.each<Theme>(["light", "dark"])("%s theme text contrast", (theme) => {
  const tokens = readTokens(theme);

  test.each(TEXT_PAIRS)(
    "text-%s on %s meets the minimum ratio",
    (text, background) => {
      const foreground = tokens.get(text);
      const surface = tokens.get(background);
      expect(foreground, `--${text} is defined`).toBeDefined();
      expect(surface, `--${background} is defined`).toBeDefined();
      expect(
        contrastRatio(foreground ?? "", surface ?? "")
      ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    }
  );
});
