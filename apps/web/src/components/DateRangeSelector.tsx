import { Button, ButtonGroup } from '@chakra-ui/react';
import type { TimeRange } from '@/utils/timeRange';
import { TIME_RANGE_LABELS } from '@/utils/timeRange';

export interface DateRangeSelectorProps {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
}

const RANGES: TimeRange[] = ['1h', '24h', '7d', '30d'];

export function DateRangeSelector({ value, onChange }: DateRangeSelectorProps) {
  return (
    <ButtonGroup size="sm" isAttached variant="outline">
      {RANGES.map((range) => (
        <Button
          key={range}
          onClick={() => onChange(range)}
          colorScheme={value === range ? 'blue' : undefined}
          variant={value === range ? 'solid' : 'outline'}
        >
          {TIME_RANGE_LABELS[range]}
        </Button>
      ))}
    </ButtonGroup>
  );
}
