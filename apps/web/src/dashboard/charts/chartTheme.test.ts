import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { readChartPalette } from "@/dashboard/charts/chartTheme";

const LIGHT = {
  card: "#ffffff",
  ink: "#0b2545",
  "ink-2": "#45607a",
  rule: "#d5dee8",
  accent: "#2563a6",
  deg: "#b26b00",
  down: "#b3261e",
  "chart-band": "rgba(37, 99, 166, 0.18)",
  "font-sans": '"Figtree Variable", sans-serif',
  "series-1": "#0072b2",
  "series-2": "#d55e00",
  "series-3": "#7e2537",
  "series-4": "#00855f",
  "series-5": "#b87800",
  "series-6": "#7b5ea7",
};

const DARK = {
  card: "#121b2e",
  ink: "#e8eef7",
  "ink-2": "#a3b3c9",
  rule: "#24324a",
  accent: "#7db3f0",
  deg: "#f0a93b",
  down: "#f2685f",
  "chart-band": "rgba(125, 179, 240, 0.22)",
  "font-sans": '"Figtree Variable", sans-serif',
  "series-1": "#56b4e9",
  "series-2": "#f0e442",
  "series-3": "#ff6f61",
  "series-4": "#3dd6a0",
  "series-5": "#cc79a7",
  "series-6": "#9aa5ff",
};

const declarations = (tokens: Record<string, string>): string =>
  Object.entries(tokens)
    .map(([name, value]) => `--${name}: ${value};`)
    .join(" ");

let style: HTMLStyleElement;

beforeEach(() => {
  style = document.createElement("style");
  style.textContent = `:root { ${declarations(LIGHT)} } .dark { ${declarations(DARK)} }`;
  document.head.appendChild(style);
});

afterEach(() => {
  style.remove();
  document.documentElement.classList.remove("dark");
});

describe("readChartPalette", () => {
  test("resolves the light tokens from the document root", () => {
    expect(readChartPalette()).toEqual({
      card: LIGHT.card,
      ink: LIGHT.ink,
      inkSecondary: LIGHT["ink-2"],
      rule: LIGHT.rule,
      accent: LIGHT.accent,
      degraded: LIGHT.deg,
      down: LIGHT.down,
      band: LIGHT["chart-band"],
      series: [
        LIGHT["series-1"],
        LIGHT["series-2"],
        LIGHT["series-3"],
        LIGHT["series-4"],
        LIGHT["series-5"],
        LIGHT["series-6"],
      ],
      fontFamily: LIGHT["font-sans"],
    });
  });

  test("resolves the dark tokens once the root carries the dark class", () => {
    document.documentElement.classList.add("dark");

    expect(readChartPalette()).toEqual({
      card: DARK.card,
      ink: DARK.ink,
      inkSecondary: DARK["ink-2"],
      rule: DARK.rule,
      accent: DARK.accent,
      degraded: DARK.deg,
      down: DARK.down,
      band: DARK["chart-band"],
      series: [
        DARK["series-1"],
        DARK["series-2"],
        DARK["series-3"],
        DARK["series-4"],
        DARK["series-5"],
        DARK["series-6"],
      ],
      fontFamily: DARK["font-sans"],
    });
  });

  test("tracks the class as it toggles, never caching a stale theme", () => {
    const light = readChartPalette();
    document.documentElement.classList.add("dark");
    const dark = readChartPalette();
    document.documentElement.classList.remove("dark");

    expect(dark.ink).not.toBe(light.ink);
    expect(readChartPalette()).toEqual(light);
  });

  test("trims the whitespace a declaration carries into its value", () => {
    document.documentElement.style.setProperty("--accent", "  #123456  ");
    try {
      expect(readChartPalette().accent).toBe("#123456");
    } finally {
      document.documentElement.style.removeProperty("--accent");
    }
  });

  test("leaves a token empty when the stylesheet does not define it", () => {
    style.textContent = "";

    expect(readChartPalette().accent).toBe("");
  });
});
