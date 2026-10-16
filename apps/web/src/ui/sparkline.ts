import { Array as Array_ } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

export const SPARKLINE_WIDTH = 100;
export const SPARKLINE_HEIGHT = 28;
const SPARKLINE_PADDING = 2;
const SPARKLINE_MAX_POINTS = 48;
const STROKE_WIDTH = 1.5;

export type SparklineValue = number | null;

type Box = Readonly<{ width: number; height: number; padding: number }>;

type Point = Readonly<{ x: number; y: number }>;

const round = (value: number): number => Math.round(value * 100) / 100;

const isNumber = (value: SparklineValue): value is number => value !== null;

const average = (values: ReadonlyArray<number>): number =>
  Array_.reduce(values, 0, (sum, value) => sum + value) / values.length;

/**
 * Averages `values` into at most `maxPoints` buckets so a month of
 * one-minute samples draws as a handful of points. A bucket with no readings
 * stays a gap rather than collapsing to zero.
 */
export const downsample = (
  values: ReadonlyArray<SparklineValue>,
  maxPoints: number
): ReadonlyArray<SparklineValue> => {
  if (values.length <= maxPoints) return values;
  const bucketSize = values.length / maxPoints;
  return Array_.makeBy(maxPoints, (bucket) => {
    const readings = values
      .slice(
        Math.floor(bucket * bucketSize),
        Math.floor((bucket + 1) * bucketSize)
      )
      .filter(isNumber);
    return readings.length === 0 ? null : average(readings);
  });
};

/**
 * Builds the SVG path of a line chart: x spreads the points across the full
 * width, y maps the series' own min and max onto the padded height. A gap
 * (`null`) starts a new subpath, and a lone point is drawn as a zero-length
 * segment so a round linecap still renders it.
 */
export const sparklinePath = (
  values: ReadonlyArray<SparklineValue>,
  { width, height, padding }: Box
): string => {
  const readings = values.filter(isNumber);
  if (readings.length === 0) return "";

  const min = Math.min(...readings);
  const range = Math.max(...readings) - min;
  const drawableHeight = height - 2 * padding;
  const xFor = (index: number): number =>
    values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
  const yFor = (value: number): number =>
    range === 0
      ? height / 2
      : padding + (1 - (value - min) / range) * drawableHeight;

  const initialRuns: ReadonlyArray<ReadonlyArray<Point>> = [[]];
  const runs = Array_.reduce(values, initialRuns, (acc, value, index) => {
    const current = acc.slice(0, -1);
    const last = acc[acc.length - 1] ?? [];
    return value === null
      ? [...acc, []]
      : [...current, [...last, { x: xFor(index), y: yFor(value) }]];
  });

  return runs
    .filter((run) => run.length > 0)
    .map((run) =>
      // A lone point repeats itself so the round linecap still draws it.
      (run.length === 1 ? [...run, ...run] : run)
        .map(
          ({ x, y }, index) =>
            `${index === 0 ? "M" : "L"}${round(x)} ${round(y)}`
        )
        .join("")
    )
    .join("");
};

export type SparklineOptions = Readonly<{
  values: ReadonlyArray<SparklineValue>;
  className?: string;
}>;

export const sparkline = <Message>(
  h: HtmlBuilder<Message>,
  { values, className = "" }: SparklineOptions
): Html => {
  const path = sparklinePath(downsample(values, SPARKLINE_MAX_POINTS), {
    width: SPARKLINE_WIDTH,
    height: SPARKLINE_HEIGHT,
    padding: SPARKLINE_PADDING,
  });
  return h.svg(
    [
      h.Attribute("viewBox", `0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`),
      h.Attribute("preserveAspectRatio", "none"),
      h.Attribute("aria-hidden", "true"),
      h.Class(`h-7 w-full overflow-visible ${className}`.trim()),
    ],
    path === ""
      ? []
      : [
          h.path(
            [
              h.Attribute("d", path),
              h.Attribute("fill", "none"),
              h.Attribute("stroke", "currentColor"),
              h.Attribute("stroke-width", String(STROKE_WIDTH)),
              h.Attribute("stroke-linecap", "round"),
              h.Attribute("stroke-linejoin", "round"),
              h.Attribute("vector-effect", "non-scaling-stroke"),
            ],
            []
          ),
        ]
  );
};
