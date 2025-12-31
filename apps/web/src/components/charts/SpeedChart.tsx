import { Box, Stat, StatGroup, StatLabel, StatNumber } from '@chakra-ui/react';
import type { SpeedMetric } from '@wan-monitor/shared';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartContainer } from '@/components/charts/ChartContainer';
import { useChartTheme } from '@/components/charts/useChartTheme';

export interface SpeedChartProps {
  startTime?: Date;
  endTime?: Date;
  syncId?: string;
  compact?: boolean;
  data?: SpeedMetric[];
  isLoading?: boolean;
}

interface ChartDataPoint {
  time: string;
  timestamp: number;
  download: number | null;
  upload: number | null;
}

interface Stats {
  avgDownload: string;
  avgUpload: string;
  maxDownload: string;
  maxUpload: string;
}

function calculateStats(data: SpeedMetric[]): Stats {
  if (data.length === 0) {
    return {
      avgDownload: '-',
      avgUpload: '-',
      maxDownload: '-',
      maxUpload: '-',
    };
  }

  const downloads = data
    .map((d) => d.download_speed)
    .filter((d) => d !== undefined && d >= 0) as number[];
  const uploads = data
    .map((d) => d.upload_speed)
    .filter((u) => u !== undefined && u >= 0) as number[];

  if (downloads.length === 0 && uploads.length === 0) {
    return {
      avgDownload: '-',
      avgUpload: '-',
      maxDownload: '-',
      maxUpload: '-',
    };
  }

  const avgDownload =
    downloads.length > 0
      ? downloads.reduce((a, b) => a + b, 0) / downloads.length
      : 0;
  const avgUpload =
    uploads.length > 0
      ? uploads.reduce((a, b) => a + b, 0) / uploads.length
      : 0;
  const maxDownload = downloads.length > 0 ? Math.max(...downloads) : 0;
  const maxUpload = uploads.length > 0 ? Math.max(...uploads) : 0;

  return {
    avgDownload: avgDownload.toFixed(1),
    avgUpload: avgUpload.toFixed(1),
    maxDownload: maxDownload.toFixed(1),
    maxUpload: maxUpload.toFixed(1),
  };
}

function formatDataForChart(data: SpeedMetric[]): ChartDataPoint[] {
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
      download: d.download_speed ?? null,
      upload: d.upload_speed ?? null,
    }));
}

export function SpeedChart({
  startTime,
  endTime,
  syncId,
  compact = false,
  data: externalData = [],
  isLoading = false,
}: SpeedChartProps) {
  const theme = useChartTheme();
  const data = externalData;

  const chartData = formatDataForChart(data);
  const stats = calculateStats(data);

  // Calculate X-axis domain from time range props or data bounds
  const xDomain: [number, number] | ['dataMin', 'dataMax'] =
    startTime && endTime
      ? [startTime.getTime(), endTime.getTime()]
      : ['dataMin', 'dataMax'];

  return (
    <Box>
      {!compact && (
        <StatGroup mb={4}>
          <Stat>
            <StatLabel>Avg Download</StatLabel>
            <StatNumber fontSize="lg">{stats.avgDownload} Mbps</StatNumber>
          </Stat>
          <Stat>
            <StatLabel>Avg Upload</StatLabel>
            <StatNumber fontSize="lg">{stats.avgUpload} Mbps</StatNumber>
          </Stat>
          <Stat>
            <StatLabel>Max Download</StatLabel>
            <StatNumber fontSize="lg">{stats.maxDownload} Mbps</StatNumber>
          </Stat>
          <Stat>
            <StatLabel>Max Upload</StatLabel>
            <StatNumber fontSize="lg">{stats.maxUpload} Mbps</StatNumber>
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
            unit=" Mbps"
            tick={{ fill: theme.textColor, fontSize: 11 }}
            width={65}
            domain={[0, 'auto']}
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
            formatter={(value: number, name: string) => [
              `${value?.toFixed(1)} Mbps`,
              name === 'download' ? 'Download' : 'Upload',
            ]}
          />
          {!compact && <Legend />}
          <Line
            type="monotone"
            dataKey="download"
            name="Download"
            stroke={theme.colors.primary}
            dot={{ r: 4 }}
            strokeWidth={2}
            activeDot={{ r: 6 }}
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey="upload"
            name="Upload"
            stroke={theme.colors.success}
            dot={{ r: 4 }}
            strokeWidth={2}
            activeDot={{ r: 6 }}
            connectNulls={false}
          />
        </LineChart>
      </ChartContainer>
    </Box>
  );
}
