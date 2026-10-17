import { Schema as S } from "effect";

/** What the user picks. `system` defers to the OS and tracks it live. */
export const ThemePreference = S.Literals(["light", "dark", "system"]);
export type ThemePreference = typeof ThemePreference.Type;

/** What the page actually renders: `<html>` carries the `dark` class or it doesn't. */
export type Theme = Exclude<ThemePreference, "system">;

export const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

// The one TS-side read of the OS preference; `index.html`'s boot script
// keeps its own copy since it runs before any module loads, but the two
// fallback chains must agree on what a fresh, unhydrated visit renders.
export const systemTheme = (): Theme =>
  globalThis.matchMedia?.(DARK_SCHEME_QUERY).matches ? "dark" : "light";

export const resolveTheme = (preference: ThemePreference): Theme =>
  preference === "system" ? systemTheme() : preference;
