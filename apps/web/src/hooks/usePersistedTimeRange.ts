import { useCallback, useState } from "react";
import { type TimeRange, VALID_TIME_RANGES } from "@/utils/timeRange";

const STORAGE_KEY = "wan-monitor-date-range";
const DEFAULT_RANGE: TimeRange = "1h";

function isValidTimeRange(value: string | null): value is TimeRange {
  return (
    value !== null && (VALID_TIME_RANGES as readonly string[]).includes(value)
  );
}

function getInitialTimeRange(): TimeRange {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return isValidTimeRange(saved) ? saved : DEFAULT_RANGE;
  } catch {
    return DEFAULT_RANGE;
  }
}

export function usePersistedTimeRange() {
  const [timeRange, setTimeRangeState] =
    useState<TimeRange>(getInitialTimeRange);

  const setTimeRange = useCallback((range: TimeRange) => {
    try {
      localStorage.setItem(STORAGE_KEY, range);
    } catch {
      // localStorage may be unavailable (e.g., private browsing)
    }
    setTimeRangeState(range);
  }, []);

  return { timeRange, setTimeRange };
}
