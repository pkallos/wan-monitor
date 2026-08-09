import { Schema as S } from "effect";

export const Theme = S.Literals(["light", "dark"]);
export type Theme = typeof Theme.Type;

// The one TS-side read of the OS preference; `index.html`'s boot script
// keeps its own copy since it runs before any module loads, but the two
// fallback chains must agree on what a fresh, unhydrated visit renders.
export const systemTheme = (): Theme =>
  globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
