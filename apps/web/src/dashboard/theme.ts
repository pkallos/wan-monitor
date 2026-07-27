import { Schema as S } from "effect";

export const Theme = S.Literals(["light", "dark"]);
export type Theme = typeof Theme.Type;
