import { Box, Stat, StatGroup, StatLabel, StatNumber } from '@chakra-ui/react';
import type { PingMetric } from '@wan-monitor/shared';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { usePingMetrics } from '@/api/hooks/usePingMetrics';
import { ChartContainer } from '@/components/charts/ChartContainer';
import { ErrorState } from '@/components/charts/ChartStates';
import { useChartTheme } from '@/components/charts/useChartTheme';

export interface JitterChartProps {
  startTime?: Date;
  endTime?: Date;
  host?: string;
  syncId?: string;
  compact?: boolean;
  data?: PingMetric[];
  isLoading?: boolean;
}

interface ChartDataPoint {
  time: string;
  timestamp: number;
  jitter: number | null;
}

interface Stats {
  current: string;
  avg: string;
  stability: string;
}

const ACCEPTABLE_JITTER_THRESHOLD = 10; // ms

function calculateStats(data: PingMetric[]): Stats {
  if (data.length === 0) {
    return { current: '-', avg: '-', stability: '-' };
  }

  const jitters = data
    .map((d) => d.jitter)
    .filter((j): j is number => j !== null && j !== undefined && j >= 0);

  if (jitters.length === 0) {
    return { current: '-', avg: '-', stability: '-' };
  }

  const avg = jitters.reduce((a, b) => a + b, 0) / jitters.length;

  // Calculate stability score: lower variance = higher stability
  // Stability is inverse of coefficient of variation (CV)
  const variance =
    jitters.reduce((sum, val) => sum + (val - avg) ** 2, 0) / jitters.length;
  const stdDev = Math.sqrt(variance);
  const cv = avg > 0 ? stdDev / avg : 0;
  const stability = Math.max(0, Math.min(100, 100 * (1 - cv))); // 0-100 scale

  return {
    current: jitters[jitters.length - 1]?.toFixed(1) ?? '-',
    avg: avg.toFixed(1),
    stability: stability.toFixed(0),
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
      jitter: null,
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
    const closestData = actualData.find((d) => {
      const diff = Math.abs(new Date(d.timestamp).getTime() - point.timestamp);
      return diff < 5 * 60 * 1000;
    });

    return {
      ...point,
      jitter: closestData?.jitter ?? null,
    };
  });
}

export function JitterChart({
  startTime,
  endTime,
  host,
  syncId,
  compact = false,
  data: externalData,
  isLoading: externalLoading,
}: JitterChartProps) {
  const {
    data: fetchedData,
    isLoading: fetchedLoading,
    error,
  } = usePingMetrics({
    startTime,
    endTime,
    host,
    enabled: externalData === undefined,
  });
  const theme = useChartTheme();

  const data = externalData ?? fetchedData?.data ?? [];
  const isLoading = externalLoading ?? fetchedLoading;

  if (error && externalData === undefined) {
    return <ErrorState message="Failed to load jitter data" />;
  }

  const now = new Date();
  const start = startTime ?? new Date(now.getTime() - 60 * 60 * 1000);
  const end = endTime ?? now;

  const rangeHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
  const intervalMinutes = rangeHours <= 1 ? 1 : rangeHours <= 24 ? 30 : 60;

  const timeRange = generateTimeRange(start, end, intervalMinutes);
  const chartData = mergeDataIntoTimeRange(timeRange, data);

  const stats = calculateStats(data);

  return (
    <Box>
      {!compact && (
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
              Stability
            </StatLabel>
            <StatNumber fontSize="lg">{stats.stability}%</StatNumber>
          </Stat>
        </StatGroup>
      )}

      <ChartContainer height={compact ? 180 : 250} isLoading={isLoading}>
        <ComposedChart data={chartData} syncId={syncId}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.gridColor} />

          <XAxis
            dataKey="time"
            tick={{ fill: theme.textColor, fontSize: 11 }}
          />
          <YAxis
            unit=" ms"
            tick={{ fill: theme.textColor, fontSize: 11 }}
            width={50}
            domain={[0, 'auto']}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: theme.tooltipBg,
              border: `1px solid ${theme.tooltipBorder}`,
              borderRadius: '6px',
            }}
            formatter={(value: number) => [`${value?.toFixed(2)} ms`, 'Jitter']}
          />

          {/* Acceptable jitter threshold line */}
          <ReferenceLine
            y={ACCEPTABLE_JITTER_THRESHOLD}
            stroke={theme.colors.warning}
            strokeDasharray="5 5"
            strokeWidth={1.5}
            label={{
              value: 'Acceptable',
              position: 'insideTopRight',
              fill: theme.colors.warning,
              fontSize: 10,
            }}
          />

          {/* Area fill for visual emphasis */}
          <Area
            type="monotone"
            dataKey="jitter"
            fill={theme.colors.info}
            fillOpacity={0.2}
            stroke="none"
            connectNulls={false}
          />

          {/* Line chart */}
          <Line
            type="monotone"
            dataKey="jitter"
            stroke={theme.colors.info}
            dot={false}
            strokeWidth={2}
            activeDot={{ r: 4 }}
            connectNulls={false}
          />
        </ComposedChart>
      </ChartContainer>
    </Box>
  );
}
