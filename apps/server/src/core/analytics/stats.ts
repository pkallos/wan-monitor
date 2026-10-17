/**
 * Percentile `p` (0 to 1) of `values` by linear interpolation between the two
 * nearest ranks. Null when there are no values.
 */
export const percentile = (
  values: readonly number[],
  p: number
): number | null => {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = p * (sorted.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  return lower + (upper - lower) * (rank - lowerIndex);
};

/** Largest value, or null for none. Iterates, so a long series can't overflow the call stack. */
export const max = (values: readonly number[]): number | null =>
  values.reduce<number | null>(
    (largest, value) => (largest === null || value > largest ? value : largest),
    null
  );

export const median = (values: readonly number[]): number | null =>
  percentile(values, 0.5);
