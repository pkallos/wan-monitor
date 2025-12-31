export type TimeRange = '1h' | '24h' | '7d' | '30d';

export interface TimeRangeDates {
  startTime: Date;
  endTime: Date;
}

export function getTimeRangeDates(range: TimeRange): TimeRangeDates {
  const endTime = new Date();
  const startTime = new Date();

  switch (range) {
    case '1h':
      startTime.setHours(startTime.getHours() - 1);
      break;
    case '24h':
      startTime.setDate(startTime.getDate() - 1);
      break;
    case '7d':
      startTime.setDate(startTime.getDate() - 7);
      break;
    case '30d':
      startTime.setDate(startTime.getDate() - 30);
      break;
  }

  return { startTime, endTime };
}

export const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  '1h': '1 Hour',
  '24h': '24 Hours',
  '7d': '7 Days',
  '30d': '30 Days',
};
