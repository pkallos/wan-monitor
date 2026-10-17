/**
 * The colours the ECharts options consume, resolved from the CSS variables in
 * `styles.css`. Those variables are the single source of truth; nothing here
 * hardcodes a hex value.
 */
export type ChartPalette = Readonly<{
  card: string;
  ink: string;
  inkSecondary: string;
  rule: string;
  accent: string;
  degraded: string;
  down: string;
  band: string;
  fontFamily: string;
}>;

/**
 * Reads the palette for whichever theme `<html>` currently carries, so it
 * must run after the ApplyTheme Command has toggled the `dark` class. A token
 * the stylesheet doesn't define resolves to an empty string, which ECharts
 * treats as "use the default". The font stack is the one non-colour token:
 * canvas text can't inherit from the DOM, so it is read alongside the colours.
 */
export const readChartPalette = (
  root: Element = document.documentElement
): ChartPalette => {
  const styles = getComputedStyle(root);
  const token = (name: string): string =>
    styles.getPropertyValue(`--${name}`).trim();

  return {
    card: token("card"),
    ink: token("ink"),
    inkSecondary: token("ink-2"),
    rule: token("rule"),
    accent: token("accent"),
    degraded: token("deg"),
    down: token("down"),
    band: token("chart-band"),
    fontFamily: token("font-sans"),
  };
};
