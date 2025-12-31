import { Box, HStack, Skeleton, Text, Tooltip } from "@chakra-ui/react";
import type { ConnectivityStatusPoint, Granularity } from "@wan-monitor/shared";
import { useMemo } from "react";
import {
  CONNECTIVITY_COLORS,
  CONNECTIVITY_LABELS,
  CONNECTIVITY_THRESHOLDS,
  type ConnectivityStatus,
} from "@/constants/connectivity";
import { granularityToMs } from "@/utils/granularity";
import { alignTimestampToGranularity } from "@/utils/timeAlignment";

export interface ConnectivityStatusChartProps {
  data?: ConnectivityStatusPoint[];
  isLoading?: boolean;
  uptimePercentage?: number;
  startTime?: Date;
  endTime?: Date;
  granularity?: Granularity;
}

interface TimelineSegment {
  timestamp: string;
  status: ConnectivityStatus;
  color: string;
  label: string;
}

export function ConnectivityStatusChart({
  data = [],
  isLoading = false,
  uptimePercentage = 0,
  startTime,
  endTime,
  granularity = "5m",
}: ConnectivityStatusChartProps) {
  // Convert data points to timeline segments, filling gaps with "no-info"
  const segments = useMemo((): TimelineSegment[] => {
    // If no time range specified, can't fill timeline
    if (!startTime || !endTime) {
      if (data.length === 0) return [];

      // Fallback to old behavior without timeline filling
      return data.map((point) => {
        const threshold = CONNECTIVITY_THRESHOLDS.dominantStatusPercentage;
        let status: ConnectivityStatus;
        let color: string;
        let label: string;

        if (point.downPercentage > threshold) {
          status = "down";
          color = CONNECTIVITY_COLORS.down;
          label = CONNECTIVITY_LABELS.down;
        } else if (point.degradedPercentage > threshold) {
          status = "degraded";
          color = CONNECTIVITY_COLORS.degraded;
          label = CONNECTIVITY_LABELS.degraded;
        } else {
          status = "up";
          color = CONNECTIVITY_COLORS.up;
          label = CONNECTIVITY_LABELS.up;
        }

        return {
          timestamp: point.timestamp,
          status,
          color,
          label,
        };
      });
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

    const result: TimelineSegment[] = [];
    // Align start and end times to granularity boundaries
    const startMs = alignTimestampToGranularity(startTime, granularity);
    const endMs = alignTimestampToGranularity(endTime, granularity);

    // Generate all time slots from start to end (exclusive of end to avoid off-by-one)
    for (let currentMs = startMs; currentMs < endMs; currentMs += intervalMs) {
      const dataPoint = dataMap.get(currentMs);

      if (dataPoint) {
        // We have data for this time slot
        const threshold = CONNECTIVITY_THRESHOLDS.dominantStatusPercentage;
        let status: ConnectivityStatus;
        let color: string;
        let label: string;

        if (dataPoint.downPercentage > threshold) {
          status = "down";
          color = CONNECTIVITY_COLORS.down;
          label = CONNECTIVITY_LABELS.down;
        } else if (dataPoint.degradedPercentage > threshold) {
          status = "degraded";
          color = CONNECTIVITY_COLORS.degraded;
          label = CONNECTIVITY_LABELS.degraded;
        } else {
          status = "up";
          color = CONNECTIVITY_COLORS.up;
          label = CONNECTIVITY_LABELS.up;
        }

        result.push({
          timestamp: dataPoint.timestamp,
          status,
          color,
          label,
        });
      } else {
        // No data for this time slot - fill with "no-info"
        result.push({
          timestamp: new Date(currentMs).toISOString(),
          status: "noInfo",
          color: CONNECTIVITY_COLORS.noInfo,
          label: CONNECTIVITY_LABELS.noInfo,
        });
      }
    }

    return result;
  }, [data, granularity, startTime, endTime]);

  if (isLoading) {
    return <Skeleton height="24px" borderRadius="md" />;
  }

  return (
    <Box>
      <HStack spacing={1} mb={2} fontSize="xs" color="gray.500">
        <Text fontWeight="medium">Uptime: {uptimePercentage.toFixed(2)}%</Text>
      </HStack>
      {segments.length === 0 ? (
        <Box
          height="24px"
          borderRadius="md"
          bg="gray.200"
          _dark={{ bg: "gray.700" }}
        />
      ) : (
        <HStack spacing={0} height="24px" borderRadius="md" overflow="hidden">
          {segments.map((segment, index) => (
            <Tooltip
              key={`${segment.timestamp}-${index}`}
              label={`${new Date(segment.timestamp).toLocaleString()}: ${segment.label}`}
              placement="top"
            >
              <Box
                height="100%"
                flex={1}
                bg={segment.color}
                transition="all 0.3s ease"
                _hover={{ opacity: 0.8 }}
              />
            </Tooltip>
          ))}
        </HStack>
      )}
    </Box>
  );
}
