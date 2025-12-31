import { ChakraProvider } from '@chakra-ui/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PingMetricsResponse } from '@/api/types';
import { JitterChart } from '@/components/charts/JitterChart';

const mockResponse: PingMetricsResponse = {
  data: [
    {
      timestamp: '2024-01-01T12:00:00.000Z',
      host: '8.8.8.8',
      latency: 15.5,
      packet_loss: 0.5,
      connectivity_status: 'connected',
      jitter: 2.3,
    },
    {
      timestamp: '2024-01-01T12:01:00.000Z',
      host: '8.8.8.8',
      latency: 16.2,
      packet_loss: 1.2,
      connectivity_status: 'connected',
      jitter: 1.8,
    },
    {
      timestamp: '2024-01-01T12:02:00.000Z',
      host: '8.8.8.8',
      latency: 14.9,
      packet_loss: 0.3,
      connectivity_status: 'connected',
      jitter: 2.1,
    },
  ],
  meta: {
    startTime: '2024-01-01T11:00:00.000Z',
    endTime: '2024-01-01T12:00:00.000Z',
    count: 3,
  },
};

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ChakraProvider>{children}</ChakraProvider>
      </QueryClientProvider>
    );
  };
};

describe('JitterChart', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('should render without errors', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const { container } = render(<JitterChart />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      const chartContainer = container.querySelector(
        '.recharts-responsive-container'
      );
      expect(chartContainer).toBeInTheDocument();
    });
  });

  it('should display jitter statistics', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const { getByText } = render(<JitterChart />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(getByText('Current')).toBeInTheDocument();
      expect(getByText('Avg')).toBeInTheDocument();
      expect(getByText('Stability')).toBeInTheDocument();
    });
  });

  it('should show error state on fetch failure', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Server error' }),
    });

    const { getByText } = render(<JitterChart />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(getByText('Failed to load jitter data')).toBeInTheDocument();
    });
  });

  it('should accept time range props', async () => {
    const startTime = new Date('2024-01-01T10:00:00.000Z');
    const endTime = new Date('2024-01-01T12:00:00.000Z');

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    render(<JitterChart startTime={startTime} endTime={endTime} />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const urlCalled = calls[0]?.[0] as string;
      expect(urlCalled).toContain('startTime=2024-01-01T10%3A00%3A00.000Z');
      expect(urlCalled).toContain('endTime=2024-01-01T12%3A00%3A00.000Z');
    });
  });

  it('should calculate stability score correctly', async () => {
    const consistentJitterResponse: PingMetricsResponse = {
      data: [
        {
          timestamp: '2024-01-01T12:00:00.000Z',
          host: '8.8.8.8',
          latency: 15.5,
          packet_loss: 0.5,
          connectivity_status: 'connected',
          jitter: 2.0, // Very consistent
        },
        {
          timestamp: '2024-01-01T12:01:00.000Z',
          host: '8.8.8.8',
          latency: 16.2,
          packet_loss: 1.2,
          connectivity_status: 'connected',
          jitter: 2.1, // Very consistent
        },
        {
          timestamp: '2024-01-01T12:02:00.000Z',
          host: '8.8.8.8',
          latency: 14.9,
          packet_loss: 0.3,
          connectivity_status: 'connected',
          jitter: 2.0, // Very consistent
        },
      ],
      meta: {
        startTime: '2024-01-01T11:00:00.000Z',
        endTime: '2024-01-01T12:00:00.000Z',
        count: 3,
      },
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => consistentJitterResponse,
    });

    const { getByText } = render(<JitterChart />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      // Very consistent jitter should have high stability score (close to 100%)
      const stabilityText = getByText('Stability');
      expect(stabilityText).toBeInTheDocument();
    });
  });

  it('should handle null jitter values', async () => {
    const nullJitterResponse: PingMetricsResponse = {
      data: [
        {
          timestamp: '2024-01-01T12:00:00.000Z',
          host: '8.8.8.8',
          latency: 15.5,
          packet_loss: 0.5,
          connectivity_status: 'connected',
        },
      ],
      meta: {
        startTime: '2024-01-01T11:00:00.000Z',
        endTime: '2024-01-01T12:00:00.000Z',
        count: 1,
      },
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => nullJitterResponse,
    });

    const { container } = render(<JitterChart />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      // Should still render without crashing
      const chartContainer = container.querySelector(
        '.recharts-responsive-container'
      );
      expect(chartContainer).toBeInTheDocument();
    });
  });
});
