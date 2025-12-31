import { Box, Stat, StatGroup, StatLabel, StatNumber } from '@chakra-ui/react';
import type { PingMetric } from '@wan-monitor/shared';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartContainer } from '@/components/charts/ChartContainer';
import { useChartTheme } from '@/components/charts/useChartTheme';

export interface LatencyChartProps {
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

function formatDataForChart(data: PingMetric[]): ChartDataPoint[] {
  return [...data]
    .sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )
    .map((d) => ({
      time: new Date(d.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
      timestamp: new Date(d.timestamp).getTime(),
      latency: d.latency ?? null,
    }));
}

export function LatencyChart({
  startTime,
  endTime,
  syncId,
  compact = false,
  data: externalData = [],
  isLoading = false,
}: LatencyChartProps) {
  const theme = useChartTheme();
  const data = externalData;

  const chartData = formatDataForChart(data);
  const stats = calculateStats(data);

  // Calculate X-axis domain from time range props or data bounds
  const xDomain: [number, number] | ['dataMin', 'dataMax'] =
    startTime && endTime
      ? [startTime.getTime(), endTime.getTime()]
      : ['dataMin', 'dataMax'];

  // Calculate Y-axis domain: always start at 0, add padding to max
  const maxLatency = stats.max !== '-' ? Number.parseFloat(stats.max) : 100;
  const padding = maxLatency * 0.2 || 10;
  const yAxisDomain: [number, number] = [0, Math.ceil(maxLatency + padding)];

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
              Min/Max
            </StatLabel>
            <StatNumber fontSize="lg">
              {stats.min}/{stats.max} ms
            </StatNumber>
          </Stat>
        </StatGroup>
      )}

      <ChartContainer height={compact ? 180 : 250} isLoading={isLoading}>
        <LineChart data={chartData} syncId={syncId}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.gridColor} />
          <XAxis
            dataKey="timestamp"
            type="number"
            scale="time"
            domain={xDomain}
            tickFormatter={(ts: number) =>
              new Date(ts).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })
            }
            tick={{ fill: theme.textColor, fontSize: 11 }}
          />
          <YAxis
            tick={{ fill: theme.textColor, fontSize: 11 }}
            width={55}
            domain={yAxisDomain}
            tickFormatter={(value: number) => `${Math.round(value)} ms`}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: theme.tooltipBg,
              border: `1px solid ${theme.tooltipBorder}`,
              borderRadius: '6px',
            }}
            labelFormatter={(ts: number) =>
              new Date(ts).toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })
            }
            formatter={(value: number) => [
              `${value?.toFixed(1)} ms`,
              'Latency',
            ]}
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
