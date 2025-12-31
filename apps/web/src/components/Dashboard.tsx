import {
  Box,
  Container,
  Heading,
  HStack,
  SimpleGrid,
  Text,
  useColorModeValue,
  VStack,
} from '@chakra-ui/react';
import { useMemo, useState } from 'react';
import { usePingMetrics } from '@/api/hooks/usePingMetrics';
import { useSpeedMetrics } from '@/api/hooks/useSpeedMetrics';
import { JitterChart } from '@/components/charts/JitterChart';
import { LatencyChart } from '@/components/charts/LatencyChart';
import { PacketLossChart } from '@/components/charts/PacketLossChart';
import { DateRangeSelector } from '@/components/DateRangeSelector';
import { MetricCard } from '@/components/MetricCard';
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

  const { data: speedData } = useSpeedMetrics({
    startTime,
    endTime,
    limit: 1,
  });

  const { data: pingData, isLoading: pingLoading } = usePingMetrics({
    startTime,
    endTime,
  });

  const pingMetrics = pingData?.data ?? [];
  const latestSpeed = speedData?.data?.[0];
  const latestPing = pingMetrics[0];

  const isConnected = latestPing?.connectivity_status === 'up';
  const connectivityStatus = isConnected ? 'good' : 'error';
  const connectivityText = isConnected ? 'Online' : 'Offline';

  const downloadSpeed = latestSpeed?.download_speed?.toFixed(1) ?? '-';
  const uploadSpeed = latestSpeed?.upload_speed?.toFixed(1) ?? '-';
  const ispName = latestSpeed?.isp ?? 'Unknown ISP';

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
          <DateRangeSelector value={timeRange} onChange={setTimeRange} />
        </HStack>

        {/* Top Row: 3 Metric Cards */}
        <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4} mb={6}>
          <MetricCard
            title="Connectivity"
            value={connectivityText}
            status={connectivityStatus}
          />
          <MetricCard
            title="Download Speed"
            value={downloadSpeed}
            unit="Mbps"
            status="good"
          />
          <MetricCard
            title="Upload Speed"
            value={uploadSpeed}
            unit="Mbps"
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
                isLoading={pingLoading}
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
                isLoading={pingLoading}
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
                isLoading={pingLoading}
              />
            </Box>
          </VStack>
        </Box>
      </Container>
    </Box>
  );
}
