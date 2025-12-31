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
import { ErrorState } from '@/components/charts/ChartStates';
import { useChartTheme } from '@/components/charts/useChartTheme';

export interface LatencyChartProps {
  startTime?: Date;
  endTime?: Date;
  host?: string;
}

interface ChartDataPoint {
  time: string;
  timestamp: number;
  latency: number | null;
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

function generateTimeRange(
  start: Date,
  end: Date,
  intervalMinutes: number
): ChartDataPoint[] {
  const points: ChartDataPoint[] = [];
  const current = new Date(start);

  while (current <= end) {
    points.push({
      time: current.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      timestamp: current.getTime(),
      latency: null,
    });
    current.setMinutes(current.getMinutes() + intervalMinutes);
  }

  return points;
}

function mergeDataIntoTimeRange(
  timeRange: ChartDataPoint[],
  actualData: PingMetric[]
): ChartDataPoint[] {
  return timeRange.map((point) => {
    // Find closest data point within 5 minutes
    const closestData = actualData.find((d) => {
      const diff = Math.abs(new Date(d.timestamp).getTime() - point.timestamp);
      return diff < 5 * 60 * 1000; // 5 minutes tolerance
    });

    return {
      ...point,
      latency: closestData?.latency ?? null,
    };
  });
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

  // Default to last hour if not specified
  const now = new Date();
  const start = startTime ?? new Date(now.getTime() - 60 * 60 * 1000);
  const end = endTime ?? now;

  // Calculate appropriate interval based on time range
  const rangeHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
  const intervalMinutes = rangeHours <= 1 ? 1 : rangeHours <= 24 ? 30 : 60;

  // Generate full time range
  const timeRange = generateTimeRange(start, end, intervalMinutes);

  // Merge actual data into time range
  const chartData = mergeDataIntoTimeRange(timeRange, data?.data ?? []);

  const stats = calculateStats(data?.data ?? []);

  // Calculate Y-axis domain with padding
  const maxLatency = stats.max !== '-' ? Number.parseFloat(stats.max) : 100;
  const minLatency = stats.min !== '-' ? Number.parseFloat(stats.min) : 0;
  const padding = (maxLatency - minLatency) * 0.2 || maxLatency * 0.2 || 10;
  const yAxisDomain = [Math.max(0, minLatency - padding), maxLatency + padding];

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
            domain={yAxisDomain}
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
            connectNulls={false}
          />
        </LineChart>
      </ChartContainer>
    </Box>
  );
}
