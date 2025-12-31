import { RepeatIcon } from '@chakra-ui/icons';
import {
  Box,
  Container,
  Heading,
  HStack,
  IconButton,
  SimpleGrid,
  useColorModeValue,
} from '@chakra-ui/react';
import { LatencyChart } from '@/components/charts/LatencyChart';
import { MetricCard } from '@/components/MetricCard';

export function Dashboard() {
  const bg = useColorModeValue('gray.50', 'gray.900');

  return (
    <Box minH="100vh" bg={bg}>
      <Container maxW="container.xl" py={8}>
        <HStack justify="space-between" mb={8}>
          <Heading size="xl" fontWeight="bold">
            WAN Monitor
          </Heading>
          <HStack spacing={4}>
            <IconButton
              aria-label="Refresh data"
              icon={<RepeatIcon />}
              variant="outline"
              size="md"
            />
          </HStack>
        </HStack>

        <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={6}>
          <MetricCard title="Connectivity" value="Online" status="good" />
          <MetricCard title="Latency">
            <LatencyChart />
          </MetricCard>
          <MetricCard title="Packet Loss" value="0.0" unit="%" status="good" />
          <MetricCard title="Jitter" value="2.1" unit="ms" status="good" />
          <MetricCard
            title="Download Speed"
            value="245.6"
            unit="Mbps"
            status="good"
          />
          <MetricCard
            title="Upload Speed"
            value="38.2"
            unit="Mbps"
            status="good"
          />
        </SimpleGrid>
      </Container>
    </Box>
  );
}
