import {
  Box,
  HStack,
  Skeleton,
  Text,
  Tooltip,
  useColorModeValue,
} from "@chakra-ui/react";
import type { ConnectivityStatusPoint, Granularity } from "@shared/api";
import { useMemo, useRef, useState } from "react";
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
  count: number;
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
          count: 1,
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
          count: 1,
        });
      } else {
        // No data for this time slot - fill with "no-info"
        result.push({
          timestamp: new Date(currentMs).toISOString(),
          status: "noInfo",
          color: CONNECTIVITY_COLORS.noInfo,
          label: CONNECTIVITY_LABELS.noInfo,
          count: 1,
        });
      }
    }

    return result;
  }, [data, granularity, startTime, endTime]);

  // Merge consecutive segments with the same status to reduce DOM overhead
  const mergedSegments = useMemo((): TimelineSegment[] => {
    if (segments.length === 0) return [];

    const merged: TimelineSegment[] = [];
    let current = { ...segments[0] };

    for (let i = 1; i < segments.length; i++) {
      if (segments[i].status === current.status) {
        // Same status - increment count
        current.count += segments[i].count;
      } else {
        // Different status - push current and start new
        merged.push(current);
        current = { ...segments[i] };
      }
    }

    // Push the last segment
    merged.push(current);

    return merged;
  }, [segments]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredSegment, setHoveredSegment] = useState<TimelineSegment | null>(
    null
  );
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const emptyBg = useColorModeValue("gray.200", "gray.700");

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || mergedSegments.length === 0) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const totalWeight = mergedSegments.reduce((sum, seg) => sum + seg.count, 0);
    const relativePos = x / rect.width;

    // Find which segment we're hovering over
    let cumulative = 0;
    for (const segment of mergedSegments) {
      cumulative += segment.count / totalWeight;
      if (relativePos <= cumulative) {
        setHoveredSegment(segment);
        setTooltipPos({ x: e.clientX, y: e.clientY });
        break;
      }
    }
  };

  const formatTooltipLabel = (segment: TimelineSegment): string => {
    const startTime = new Date(segment.timestamp);
    if (segment.count === 1) {
      return `${startTime.toLocaleString()}: ${segment.label}`;
    }

    // Calculate end time based on count and granularity
    const intervalMs = granularityToMs(granularity);
    const endTime = new Date(startTime.getTime() + segment.count * intervalMs);

    return `${startTime.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} - ${endTime.toLocaleString([], { hour: "2-digit", minute: "2-digit" })}: ${segment.label}`;
  };

  const handleMouseLeave = () => {
    setHoveredSegment(null);
  };

  if (isLoading) {
    return <Skeleton height="24px" borderRadius="md" />;
  }

  return (
    <Box>
      <HStack spacing={1} mb={2} fontSize="xs" color="gray.500">
        <Text fontWeight="medium">Uptime: {uptimePercentage.toFixed(2)}%</Text>
      </HStack>
      {segments.length === 0 ? (
        <Box height="24px" borderRadius="md" bg={emptyBg} />
      ) : (
        <>
          <div
            ref={containerRef}
            role="img"
            aria-label="Connectivity status timeline"
            style={{
              position: "relative",
              display: "flex",
              height: "24px",
              borderRadius: "6px",
              overflow: "hidden",
              cursor: "pointer",
            }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            data-testid="connectivity-status-bar"
          >
            {mergedSegments.map((segment, index) => (
              <div
                key={`${segment.timestamp}-${index}`}
                style={{
                  height: "100%",
                  flex: segment.count,
                  backgroundColor: segment.color,
                  transition: "opacity 0.2s ease",
                  opacity: hoveredSegment === segment ? 0.8 : 1,
                }}
              />
            ))}
          </div>
          {hoveredSegment && (
            <Tooltip
              label={formatTooltipLabel(hoveredSegment)}
              isOpen={true}
              placement="top"
            >
              <Box
                position="fixed"
                left={`${tooltipPos.x}px`}
                top={`${tooltipPos.y}px`}
                pointerEvents="none"
                opacity={0}
              />
            </Tooltip>
          )}
        </>
      )}
    </Box>
  );
}
