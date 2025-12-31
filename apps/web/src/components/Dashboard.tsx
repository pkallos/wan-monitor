import {
  Box,
  Container,
  Heading,
  HStack,
  IconButton,
  SimpleGrid,
  Spinner,
  Text,
  Tooltip,
  useColorModeValue,
  VStack,
} from '@chakra-ui/react';
import { useEffect, useMemo, useState } from 'react';
import { FiPause, FiPlay, FiRefreshCw } from 'react-icons/fi';
import { useMetrics } from '@/api/hooks/useMetrics';
import { JitterChart } from '@/components/charts/JitterChart';
import { LatencyChart } from '@/components/charts/LatencyChart';
import { PacketLossChart } from '@/components/charts/PacketLossChart';
import { SpeedChart } from '@/components/charts/SpeedChart';
import { DateRangeSelector } from '@/components/DateRangeSelector';
import { MetricCard } from '@/components/MetricCard';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import type { TimeRange } from '@/utils/timeRange';
import { getTimeRangeDates } from '@/utils/timeRange';

const CHART_SYNC_ID = 'network-metrics';

export function Dashboard() {
  const bg = useColorModeValue('gray.50', 'gray.900');
  const cardBg = useColorModeValue('white', 'gray.800');
  const borderColor = useColorModeValue('gray.200', 'gray.700');
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const { startTime, endTime } = useMemo(
    () => getTimeRangeDates(timeRange),
    [timeRange]
  );

  const {
    isPaused,
    togglePause,
    refetchInterval,
    updateLastUpdated,
    secondsSinceUpdate,
  } = useAutoRefresh();

  const {
    pingMetrics,
    speedMetrics,
    isLoading,
    isRefetching,
    dataUpdatedAt,
    refetch,
  } = useMetrics({
    startTime,
    endTime,
    refetchInterval,
  });

  // Update last updated timestamp when data changes
  useEffect(() => {
    if (dataUpdatedAt) {
      updateLastUpdated();
    }
  }, [dataUpdatedAt, updateLastUpdated]);

  const lastUpdatedText =
    secondsSinceUpdate !== null
      ? secondsSinceUpdate < 60
        ? `${secondsSinceUpdate}s ago`
        : `${Math.floor(secondsSinceUpdate / 60)}m ago`
      : 'Loading...';

  const latestSpeed = speedMetrics[0];
  const latestPing = pingMetrics[0];

  const isConnected = latestPing?.connectivity_status === 'up';
  const connectivityStatus = isConnected ? 'good' : 'error';
  const connectivityText = isConnected ? 'Online' : 'Offline';

  const downloadSpeed = latestSpeed?.download_speed?.toFixed(1) ?? '-';
  const uploadSpeed = latestSpeed?.upload_speed?.toFixed(1) ?? '-';
  const ispName = latestSpeed?.isp ?? 'Unknown ISP';

  const formatTimeAgo = (timestamp: string | undefined): string => {
    if (!timestamp) return '';
    const seconds = Math.floor(
      (Date.now() - new Date(timestamp).getTime()) / 1000
    );
    if (seconds < 60) return `as of ${seconds}s ago`;
    if (seconds < 3600) return `as of ${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `as of ${Math.floor(seconds / 3600)}h ago`;
    return `as of ${Math.floor(seconds / 86400)}d ago`;
  };

  const pingTimeAgo = formatTimeAgo(latestPing?.timestamp);
  const speedTimeAgo = formatTimeAgo(latestSpeed?.timestamp);

  return (
    <Box minH="100vh" bg={bg}>
      <Container maxW="container.xl" py={8}>
        <HStack justify="space-between" mb={6}>
          <VStack align="start" spacing={0}>
            <Heading size="xl" fontWeight="bold">
              WAN Monitor
            </Heading>
            <Text fontSize="sm" color="gray.500">
              {ispName}
            </Text>
          </VStack>
          <HStack spacing={4}>
            <HStack spacing={2}>
              {isRefetching && <Spinner size="sm" color="blue.500" />}
              <Text fontSize="xs" color="gray.500">
                Updated {lastUpdatedText}
              </Text>
              <Tooltip label="Refresh now">
                <IconButton
                  aria-label="Refresh now"
                  icon={<FiRefreshCw />}
                  size="sm"
                  variant="ghost"
                  onClick={() => refetch()}
                  isDisabled={isRefetching}
                />
              </Tooltip>
              <Tooltip
                label={isPaused ? 'Resume auto-refresh' : 'Pause auto-refresh'}
              >
                <IconButton
                  aria-label={
                    isPaused ? 'Resume auto-refresh' : 'Pause auto-refresh'
                  }
                  icon={isPaused ? <FiPlay /> : <FiPause />}
                  size="sm"
                  variant="ghost"
                  onClick={togglePause}
                />
              </Tooltip>
            </HStack>
            <DateRangeSelector value={timeRange} onChange={setTimeRange} />
          </HStack>
        </HStack>

        {/* Top Row: 3 Metric Cards */}
        <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4} mb={6}>
          <MetricCard
            title="Connectivity"
            value={connectivityText}
            subtitle={pingTimeAgo}
            status={connectivityStatus}
          />
          <MetricCard
            title="Download Speed"
            value={downloadSpeed}
            unit="Mbps"
            subtitle={speedTimeAgo}
            status="good"
          />
          <MetricCard
            title="Upload Speed"
            value={uploadSpeed}
            unit="Mbps"
            subtitle={speedTimeAgo}
            status="good"
          />
        </SimpleGrid>

        {/* Bottom Section: Stacked Charts with Linked Cursors */}
        <Box
          bg={cardBg}
          borderWidth="1px"
          borderColor={borderColor}
          borderRadius="lg"
          p={6}
          shadow="sm"
        >
          <Heading size="md" mb={4}>
            Network Quality
          </Heading>

          <VStack spacing={6} align="stretch">
            {/* Latency Chart */}
            <Box>
              <Text fontSize="sm" fontWeight="semibold" color="gray.500" mb={2}>
                Latency (ms)
              </Text>
              <LatencyChart
                startTime={startTime}
                endTime={endTime}
                syncId={CHART_SYNC_ID}
                compact
                data={pingMetrics}
                isLoading={isLoading}
              />
            </Box>

            {/* Packet Loss Chart */}
            <Box>
              <Text fontSize="sm" fontWeight="semibold" color="gray.500" mb={2}>
                Packet Loss (%)
              </Text>
              <PacketLossChart
                startTime={startTime}
                endTime={endTime}
                syncId={CHART_SYNC_ID}
                compact
                data={pingMetrics}
                isLoading={isLoading}
              />
            </Box>

            {/* Jitter Chart */}
            <Box>
              <Text fontSize="sm" fontWeight="semibold" color="gray.500" mb={2}>
                Jitter (ms)
              </Text>
              <JitterChart
                startTime={startTime}
                endTime={endTime}
                syncId={CHART_SYNC_ID}
                compact
                data={pingMetrics}
                isLoading={isLoading}
              />
            </Box>
          </VStack>
        </Box>

        {/* Speed Test Results */}
        <Box
          bg={cardBg}
          borderWidth="1px"
          borderColor={borderColor}
          borderRadius="lg"
          p={6}
          mt={6}
          shadow="sm"
        >
          <Heading size="md" mb={4}>
            Speed Test History
          </Heading>
          <SpeedChart data={speedMetrics} isLoading={isLoading} />
        </Box>
      </Container>
    </Box>
  );
}
