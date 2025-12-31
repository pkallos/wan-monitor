import {
  CartesianGrid,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartContainer } from '@/components/charts/ChartContainer';
import { useChartTheme } from '@/components/charts/useChartTheme';

export interface TimeSeriesChartProps<T extends Record<string, unknown>> {
  data: T[];
  xKey: keyof T;
  yKey: keyof T;
  color?: string;
  unit?: string;
  height?: number;
  isLoading?: boolean;
  formatXAxis?: (value: unknown) => string;
  formatYAxis?: (value: unknown) => string;
  formatTooltip?: (value: unknown) => string;
}

export function TimeSeriesChart<T extends Record<string, unknown>>({
  data,
  xKey,
  yKey,
  color,
  unit,
  height = 300,
  isLoading = false,
  formatXAxis,
  formatYAxis,
  formatTooltip,
}: TimeSeriesChartProps<T>) {
  const theme = useChartTheme();

  const xAxisFormatter = formatXAxis || ((value: unknown) => String(value));
  const yAxisFormatter = formatYAxis || ((value: unknown) => String(value));
  const tooltipFormatter =
    formatTooltip || ((value: unknown) => `${value}${unit || ''}`);

  return (
    <ChartContainer height={height} isLoading={isLoading}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={theme.gridColor} />
        <XAxis
          dataKey={xKey as string}
          tick={{ fill: theme.textColor, fontSize: 12 }}
          tickFormatter={xAxisFormatter}
        />
        <YAxis
          tick={{ fill: theme.textColor, fontSize: 12 }}
          tickFormatter={yAxisFormatter}
          unit={unit}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: theme.tooltipBg,
            border: `1px solid ${theme.tooltipBorder}`,
            borderRadius: '6px',
          }}
          formatter={tooltipFormatter}
        />
        <Line
          type="monotone"
          dataKey={yKey as string}
          stroke={color || theme.colors.primary}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ChartContainer>
  );
}
