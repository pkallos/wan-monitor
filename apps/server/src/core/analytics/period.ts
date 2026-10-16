/**
 * The ping cycle period to size outages and downtime with: the one measured
 * from the window's own cycles (see `buildQueryCyclePeriod`), or the
 * configured interval when the window has too few cycles to measure one.
 */
export const cyclePeriodMs = (
  measuredMs: number | null,
  configuredIntervalSeconds: number
): number => measuredMs ?? configuredIntervalSeconds * 1000;
