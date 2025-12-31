import { Box, Stat, StatGroup, StatLabel, StatNumber } from '@chakra-ui/react';
import type { PingMetric } from '@wan-monitor/shared';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { usePingMetrics } from '@/api/hooks/usePingMetrics';
import { ChartContainer } from '@/components/charts/ChartContainer';
import { ErrorState } from '@/components/charts/ChartStates';
import { useChartTheme } from '@/components/charts/useChartTheme';

export interface PacketLossChartProps {
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
  packetLoss: number | null;
}

interface Stats {
  current: string;
  avg: string;
  max: string;
  spikes: number;
}

function calculateStats(data: PingMetric[]): Stats {
  if (data.length === 0) {
    return { current: '-', avg: '-', max: '-', spikes: 0 };
  }

  const losses = data.map((d) => d.packet_loss).filter((l) => l >= 0);

  if (losses.length === 0) {
    return { current: '-', avg: '-', max: '-', spikes: 0 };
  }

  const avg = losses.reduce((a, b) => a + b, 0) / losses.length;
  const spikes = losses.filter((l) => l > 5).length;

  return {
    current: losses[losses.length - 1]?.toFixed(1) ?? '-',
    avg: avg.toFixed(1),
    max: Math.max(...losses).toFixed(1),
    spikes,
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
      packetLoss: null,
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
      packetLoss: closestData?.packet_loss ?? null,
    };
  });
}

export function PacketLossChart({
  startTime,
  endTime,
  host,
  syncId,
  compact = false,
  data: externalData,
  isLoading: externalLoading,
}: PacketLossChartProps) {
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
    return <ErrorState message="Failed to load packet loss data" />;
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
            <StatNumber fontSize="lg">{stats.current}%</StatNumber>
          </Stat>
          <Stat>
            <StatLabel fontSize="xs" color="gray.500">
              Avg
            </StatLabel>
            <StatNumber fontSize="lg">{stats.avg}%</StatNumber>
          </Stat>
          <Stat>
            <StatLabel fontSize="xs" color="gray.500">
              Max
            </StatLabel>
            <StatNumber fontSize="lg">{stats.max}%</StatNumber>
          </Stat>
          <Stat>
            <StatLabel fontSize="xs" color="gray.500">
              Spikes
            </StatLabel>
            <StatNumber fontSize="lg">{stats.spikes}</StatNumber>
          </Stat>
        </StatGroup>
      )}

      <ChartContainer height={compact ? 180 : 250} isLoading={isLoading}>
        <LineChart data={chartData} syncId={syncId}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.gridColor} />

          {/* Green zone: 0-1% (excellent) */}
          <ReferenceArea
            y1={0}
            y2={1}
            fill={theme.colors.success}
            fillOpacity={0.1}
          />

          {/* Yellow zone: 1-5% (degraded) */}
          <ReferenceArea
            y1={1}
            y2={5}
            fill={theme.colors.warning}
            fillOpacity={0.1}
          />

          {/* Red zone: >5% (poor) */}
          <ReferenceArea
            y1={5}
            y2={100}
            fill={theme.colors.danger}
            fillOpacity={0.1}
          />

          <XAxis
            dataKey="time"
            tick={{ fill: theme.textColor, fontSize: 11 }}
          />
          <YAxis
            unit="%"
            tick={{ fill: theme.textColor, fontSize: 11 }}
            width={45}
            domain={[0, 'auto']}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: theme.tooltipBg,
              border: `1px solid ${theme.tooltipBorder}`,
              borderRadius: '6px',
            }}
            formatter={(value: number) => [
              `${value?.toFixed(1)}%`,
              'Packet Loss',
            ]}
          />
          <Line
            type="monotone"
            dataKey="packetLoss"
            stroke={theme.colors.danger}
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
