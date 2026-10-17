import { Schema as S } from "effect";

/** What the latency chart draws: one line for every host together, or a line per host. */
export const LatencyView = S.Literals(["all", "perHost"]);
export type LatencyView = typeof LatencyView.Type;

export const DEFAULT_LATENCY_VIEW: LatencyView = "all";
