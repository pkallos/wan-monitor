import { Box, Stat, StatGroup, StatLabel, StatNumber } from "@chakra-ui/react";
import type { Granularity, PingMetric } from "@shared/api";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartContainer } from "@/components/charts/ChartContainer";
import { useChartTheme } from "@/components/charts/useChartTheme";
import { granularityToMs } from "@/utils/granularity";
import { alignTimestampToGranularity } from "@/utils/timeAlignment";

export interface JitterChartProps {
  startTime?: Date;
  endTime?: Date;
  host?: string;
  syncId?: string;
  compact?: boolean;
  data?: PingMetric[];
  isLoading?: boolean;
  granularity?: Granularity;
}

interface ChartDataPoint {
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
    return { current: "-", avg: "-", stability: "-" };
  }

  const jitters = data
    .map((d) => d.jitter)
    .filter((j): j is number => j !== null && j !== undefined && j >= 0);

  if (jitters.length === 0) {
    return { current: "-", avg: "-", stability: "-" };
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
    current: jitters[jitters.length - 1]?.toFixed(1) ?? "-",
    avg: avg.toFixed(1),
    stability: stability.toFixed(0),
  };
}

function formatDataForChart(
  data: PingMetric[],
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
        jitter: d.jitter ?? null,
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
      jitter: dataPoint?.jitter ?? null,
    });
  }

  return result;
}

export function JitterChart({
  startTime,
  endTime,
  syncId,
  compact = false,
  data: externalData = [],
  isLoading = false,
  granularity = "5m",
}: JitterChartProps) {
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
            unit=" ms"
            tick={{ fill: theme.textColor, fontSize: 11 }}
            width={50}
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
            formatter={(value: number) => [`${value?.toFixed(2)} ms`, "Jitter"]}
          />

          {/* Acceptable jitter threshold line */}
          <ReferenceLine
            y={ACCEPTABLE_JITTER_THRESHOLD}
            stroke={theme.colors.warning}
            strokeDasharray="5 5"
            strokeWidth={1.5}
            label={{
              value: "Acceptable",
              position: "insideTopRight",
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
