import { useCallback, useEffect, useState } from "react";

const AUTO_REFRESH_INTERVAL = 30_000; // 30 seconds

export interface UseAutoRefreshReturn {
  isPaused: boolean;
  togglePause: () => void;
  lastUpdated: Date | null;
  refetchInterval: number | false;
  updateLastUpdated: () => void;
  secondsSinceUpdate: number | null;
}

export function useAutoRefresh(): UseAutoRefreshReturn {
  const [isPaused, setIsPaused] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [secondsSinceUpdate, setSecondsSinceUpdate] = useState<number | null>(
    null
  );

  const togglePause = useCallback(() => {
    setIsPaused((prev) => !prev);
  }, []);

  const updateLastUpdated = useCallback(() => {
    setLastUpdated(new Date());
  }, []);

  // Update seconds counter every second
  useEffect(() => {
    if (!lastUpdated) return;

    const updateSeconds = () => {
      const seconds = Math.floor((Date.now() - lastUpdated.getTime()) / 1000);
      setSecondsSinceUpdate(seconds);
    };

    updateSeconds();
    const interval = setInterval(updateSeconds, 1000);

    return () => clearInterval(interval);
  }, [lastUpdated]);

  return {
    isPaused,
    togglePause,
    lastUpdated,
    refetchInterval: isPaused ? false : AUTO_REFRESH_INTERVAL,
    updateLastUpdated,
    secondsSinceUpdate,
  };
}
