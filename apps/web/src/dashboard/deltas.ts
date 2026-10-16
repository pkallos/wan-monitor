import type { RangeSummary } from "@shared/api/routes/summary";
import { Option } from "effect";

export type DeltaTone = "good" | "bad" | "neutral";
export type DeltaWord = "better" | "worse" | "steady";

/** A change since the previous window: a signed value, a verdict, and the baseline. */
export type Delta = Readonly<{
  text: string;
  word: DeltaWord;
  tone: DeltaTone;
  rest: string;
}>;

export type DeltaInput = Readonly<{
  current: number | null;
  previous: number | null;
  /** Whether a rise is an improvement (availability) or a regression (latency). */
  higherIsBetter: boolean;
  /** The unit of the change itself: "pt" for a change in a percentage. */
  unit: string;
  /** The unit of the level the change is measured from; defaults to `unit`. */
  levelUnit?: string;
  decimals: number;
  /** Changes smaller than this read as steady. */
  steadyBelow: number;
}>;

const MINUS = "−";

const withUnit = (value: string, unit: string): string =>
  unit === "%" ? `${value}${unit}` : `${value} ${unit}`;

export const makeDelta = ({
  current,
  previous,
  higherIsBetter,
  unit,
  levelUnit = unit,
  decimals,
  steadyBelow,
}: DeltaInput): Option.Option<Delta> => {
  if (current === null || previous === null) return Option.none();

  const change = current - previous;
  const isSteady = Math.abs(change) < steadyBelow;
  const magnitude = Math.abs(change).toFixed(decimals);
  // A change that rounds to zero carries no sign, so "steady" never reads "−0.0".
  const sign = Number(magnitude) === 0 ? "" : change > 0 ? "+" : MINUS;
  const text = withUnit(`${sign}${magnitude}`, unit);
  const rest = `vs ${withUnit(previous.toFixed(decimals), levelUnit)} prev.`;

  if (isSteady) {
    return Option.some({ text, word: "steady", tone: "neutral", rest });
  }
  const isBetter = change > 0 === higherIsBetter;
  return Option.some({
    text,
    word: isBetter ? "better" : "worse",
    tone: isBetter ? "good" : "bad",
    rest,
  });
};

export type SummaryDeltas = Readonly<{
  availability: Option.Option<Delta>;
  uptime: Option.Option<Delta>;
  latency: Option.Option<Delta>;
  loss: Option.Option<Delta>;
  jitter: Option.Option<Delta>;
}>;

/** Each figure's change against the same figure of the equal-length window before it. */
export const summaryDeltas = (
  range: RangeSummary,
  previous: RangeSummary
): SummaryDeltas => ({
  availability: makeDelta({
    current: range.availabilityPercentage,
    previous: previous.availabilityPercentage,
    higherIsBetter: true,
    unit: "pt",
    levelUnit: "%",
    decimals: 2,
    steadyBelow: 0.05,
  }),
  uptime: makeDelta({
    current: range.uptimePercentage,
    previous: previous.uptimePercentage,
    higherIsBetter: true,
    unit: "pt",
    levelUnit: "%",
    decimals: 2,
    steadyBelow: 0.05,
  }),
  latency: makeDelta({
    current: range.latencyP50,
    previous: previous.latencyP50,
    higherIsBetter: false,
    unit: "ms",
    decimals: 1,
    steadyBelow: 0.5,
  }),
  loss: makeDelta({
    current: range.avgPacketLoss,
    previous: previous.avgPacketLoss,
    higherIsBetter: false,
    unit: "pt",
    levelUnit: "%",
    decimals: 2,
    steadyBelow: 0.05,
  }),
  jitter: makeDelta({
    current: range.avgJitter,
    previous: previous.avgJitter,
    higherIsBetter: false,
    unit: "ms",
    decimals: 1,
    steadyBelow: 0.3,
  }),
});
