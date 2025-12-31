import { Box, Stat, StatGroup, StatLabel, StatNumber } from '@chakra-ui/react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { usePingMetrics } from '@/api/hooks/usePingMetrics';
import type { PingMetric } from '@/api/types';
import { ChartContainer } from '@/components/charts/ChartContainer';
import { EmptyState, ErrorState } from '@/components/charts/ChartStates';
import { useChartTheme } from '@/components/charts/useChartTheme';

export interface LatencyChartProps {
  startTime?: Date;
  endTime?: Date;
  host?: string;
}

interface ChartDataPoint {
  time: string;
  latency: number;
}

interface Stats {
  current: string;
  avg: string;
  min: string;
  max: string;
}

function calculateStats(data: PingMetric[]): Stats {
  if (data.length === 0) {
    return { current: '-', avg: '-', min: '-', max: '-' };
  }

  const latencies = data.map((d) => d.latency).filter((l) => l >= 0);

  if (latencies.length === 0) {
    return { current: '-', avg: '-', min: '-', max: '-' };
  }

  return {
    current: latencies[latencies.length - 1]?.toFixed(1) ?? '-',
    avg: (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(1),
    min: Math.min(...latencies).toFixed(1),
    max: Math.max(...latencies).toFixed(1),
  };
}

export function LatencyChart({ startTime, endTime, host }: LatencyChartProps) {
  const { data, isLoading, error } = usePingMetrics({
    startTime,
    endTime,
    host,
  });
  const theme = useChartTheme();

  if (error) {
    return <ErrorState message="Failed to load latency data" />;
  }

  if (!isLoading && (!data || data.data.length === 0)) {
    return <EmptyState message="No latency data available" />;
  }

  const chartData: ChartDataPoint[] =
    data?.data.map((d) => ({
      time: new Date(d.timestamp).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      latency: d.latency,
    })) ?? [];

  const stats = calculateStats(data?.data ?? []);

  return (
    <Box>
      <StatGroup mb={4}>
        <Stat>
          <StatLabel fontSize="xs" color="gray.500">
            Current
          </StatLabel>
          <StatNumber fontSize="lg">{stats.current} ms</StatNumber>
        </Stat>
        <Stat>
          <StatLabel fontSize="xs" color="gray.500">
            Avg
          </StatLabel>
          <StatNumber fontSize="lg">{stats.avg} ms</StatNumber>
        </Stat>
        <Stat>
          <StatLabel fontSize="xs" color="gray.500">
            Min/Max
          </StatLabel>
          <StatNumber fontSize="lg">
            {stats.min}/{stats.max} ms
          </StatNumber>
        </Stat>
      </StatGroup>

      <ChartContainer height={250} isLoading={isLoading}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.gridColor} />
          <XAxis
            dataKey="time"
            tick={{ fill: theme.textColor, fontSize: 11 }}
          />
          <YAxis
            unit=" ms"
            tick={{ fill: theme.textColor, fontSize: 11 }}
            width={45}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: theme.tooltipBg,
              border: `1px solid ${theme.tooltipBorder}`,
              borderRadius: '6px',
            }}
          />
          {stats.avg !== '-' && (
            <ReferenceLine
              y={Number.parseFloat(stats.avg)}
              stroke={theme.colors.info}
              strokeDasharray="3 3"
              label={{ value: 'Avg', fill: theme.textColor, fontSize: 10 }}
            />
          )}
          <Line
            type="monotone"
            dataKey="latency"
            stroke={theme.colors.primary}
            dot={false}
            strokeWidth={2}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ChartContainer>
    </Box>
  );
}
