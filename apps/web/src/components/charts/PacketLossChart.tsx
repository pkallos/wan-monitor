import { Box, Stat, StatGroup, StatLabel, StatNumber } from "@chakra-ui/react";
import type { Granularity, Metric } from "@wan-monitor/shared";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartContainer } from "@/components/charts/ChartContainer";
import { useChartTheme } from "@/components/charts/useChartTheme";
import { granularityToMs } from "@/utils/granularity";
import { alignTimestampToGranularity } from "@/utils/timeAlignment";

export interface PacketLossChartProps {
  startTime?: Date;
  endTime?: Date;
  host?: string;
  syncId?: string;
  compact?: boolean;
  data?: Metric[];
  isLoading?: boolean;
  granularity?: Granularity;
}

interface ChartDataPoint {
  timestamp: number;
  packetLoss: number | null;
}

interface Stats {
  current: string;
  avg: string;
  max: string;
  spikes: number;
}

function calculateStats(data: Metric[]): Stats {
  if (data.length === 0) {
    return { current: "-", avg: "-", max: "-", spikes: 0 };
  }

  const losses = data
    .map((d) => d.packet_loss)
    .filter((l): l is number => l !== undefined && l >= 0);

  if (losses.length === 0) {
    return { current: "-", avg: "-", max: "-", spikes: 0 };
  }

  const avg = losses.reduce((a, b) => a + b, 0) / losses.length;
  const spikes = losses.filter((l) => l > 5).length;

  return {
    current: losses[losses.length - 1]?.toFixed(1) ?? "-",
    avg: avg.toFixed(1),
    max: Math.max(...losses).toFixed(1),
    spikes,
  };
}

function formatDataForChart(
  data: Metric[],
  startTime?: Date,
  endTime?: Date,
  granularity: Granularity = "5m"
): ChartDataPoint[] {
  // If no time range specified, can't fill timeline
  if (!startTime || !endTime) {
    return [...data]
      .sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      )
      .map((d) => ({
        timestamp: new Date(d.timestamp).getTime(),
        packetLoss: d.packet_loss ?? null,
      }));
  }

  // Calculate expected interval in milliseconds
  const intervalMs = granularityToMs(granularity);

  // Create a map of existing data points for quick lookup
  // Align data timestamps to granularity boundaries for matching
  const dataMap = new Map(
    data.map((point) => {
      const alignedMs = alignTimestampToGranularity(
        new Date(point.timestamp),
        granularity
      );
      return [alignedMs, point];
    })
  );

  const result: ChartDataPoint[] = [];
  // Align start and end times to granularity boundaries
  const startMs = alignTimestampToGranularity(startTime, granularity);
  const endMs = alignTimestampToGranularity(endTime, granularity);

  // Generate all time slots from start to end (exclusive of end to avoid off-by-one)
  for (let currentMs = startMs; currentMs < endMs; currentMs += intervalMs) {
    const dataPoint = dataMap.get(currentMs);

    result.push({
      timestamp: currentMs,
      packetLoss: dataPoint?.packet_loss ?? null,
    });
  }

  return result;
}

export function PacketLossChart({
  startTime,
  endTime,
  syncId,
  compact = false,
  data: externalData = [],
  isLoading = false,
  granularity = "5m",
}: PacketLossChartProps) {
  const theme = useChartTheme();
  const data = externalData;

  const chartData = formatDataForChart(data, startTime, endTime, granularity);
  const stats = calculateStats(data);

  // Calculate X-axis domain from time range props or data bounds
  const xDomain: [number, number] | ["dataMin", "dataMax"] =
    startTime && endTime
      ? [startTime.getTime(), endTime.getTime()]
      : ["dataMin", "dataMax"];

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
            dataKey="timestamp"
            type="number"
            scale="time"
            domain={xDomain}
            tickFormatter={(ts: number) =>
              new Date(ts).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })
            }
            tick={{ fill: theme.textColor, fontSize: 11 }}
          />
          <YAxis
            unit="%"
            tick={{ fill: theme.textColor, fontSize: 11 }}
            width={45}
            domain={[0, "auto"]}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: theme.tooltipBg,
              border: `1px solid ${theme.tooltipBorder}`,
              borderRadius: "6px",
            }}
            labelFormatter={(ts: number) =>
              new Date(ts).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })
            }
            formatter={(value: number) => [
              `${value?.toFixed(1)}%`,
              "Packet Loss",
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
