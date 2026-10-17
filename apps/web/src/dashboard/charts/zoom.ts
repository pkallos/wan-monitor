/** The slice of a chart's x axis in view, as percentages of the painted window. */
export type ZoomRange = Readonly<{ start: number; end: number }>;

export type PaintedWindow = Readonly<{ startMs: number; endMs: number }>;

export const FULL_ZOOM: ZoomRange = { start: 0, end: 100 };

// A refresh re-fetches a preset window against a later clock, so its bounds
// move while the viewer's selection is unchanged. Windows that still cover
// this much of the same span are that same selection.
const SAME_SELECTION_OVERLAP = 0.9;

const span = (window: PaintedWindow): number => window.endMs - window.startMs;

const isSameSelection = (
  previous: PaintedWindow,
  next: PaintedWindow
): boolean => {
  const overlapMs =
    Math.min(previous.endMs, next.endMs) -
    Math.max(previous.startMs, next.startMs);
  return (
    overlapMs >= SAME_SELECTION_OVERLAP * Math.max(span(previous), span(next))
  );
};

const clampPercent = (percent: number): number =>
  Math.min(Math.max(percent, 0), 100);

/**
 * The zoom to repaint a chart with. A full repaint resets echarts' zoom, so
 * the viewer's zoom is carried over as the same span of time when the new
 * window is the same selection, and reset when it is a different one or the
 * zoomed span has left the window.
 */
export const carryZoom = (
  zoom: ZoomRange,
  previous: PaintedWindow,
  next: PaintedWindow
): ZoomRange => {
  if (zoom.start <= FULL_ZOOM.start && zoom.end >= FULL_ZOOM.end) {
    return FULL_ZOOM;
  }
  if (!isSameSelection(previous, next)) return FULL_ZOOM;

  const toPercent = (percentOfPrevious: number): number =>
    clampPercent(
      ((previous.startMs +
        (percentOfPrevious / 100) * span(previous) -
        next.startMs) /
        span(next)) *
        100
    );
  const carried = { start: toPercent(zoom.start), end: toPercent(zoom.end) };
  return carried.end > carried.start ? carried : FULL_ZOOM;
};
