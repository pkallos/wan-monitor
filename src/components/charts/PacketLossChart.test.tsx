import { ChakraProvider } from '@chakra-ui/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PingMetricsResponse } from '@/api/types';
import { PacketLossChart } from '@/components/charts/PacketLossChart';

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

describe('PacketLossChart', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('should render without errors', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const { container } = render(<PacketLossChart />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      const chartContainer = container.querySelector(
        '.recharts-responsive-container'
      );
      expect(chartContainer).toBeInTheDocument();
    });
  });

  it('should display packet loss statistics', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const { getByText } = render(<PacketLossChart />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(getByText('Current')).toBeInTheDocument();
      expect(getByText('Avg')).toBeInTheDocument();
      expect(getByText('Max')).toBeInTheDocument();
      expect(getByText('Spikes')).toBeInTheDocument();
    });
  });

  it('should show error state on fetch failure', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Server error' }),
    });

    const { getByText } = render(<PacketLossChart />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(getByText('Failed to load packet loss data')).toBeInTheDocument();
    });
  });

  it('should accept time range props', async () => {
    const startTime = new Date('2024-01-01T10:00:00.000Z');
    const endTime = new Date('2024-01-01T12:00:00.000Z');

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    render(<PacketLossChart startTime={startTime} endTime={endTime} />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const urlCalled = calls[0]?.[0] as string;
      expect(urlCalled).toContain('startTime=2024-01-01T10%3A00%3A00.000Z');
      expect(urlCalled).toContain('endTime=2024-01-01T12%3A00%3A00.000Z');
    });
  });

  it('should calculate spike count correctly', async () => {
    const highLossResponse: PingMetricsResponse = {
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
          packet_loss: 8.5, // Spike
          connectivity_status: 'connected',
          jitter: 1.8,
        },
        {
          timestamp: '2024-01-01T12:02:00.000Z',
          host: '8.8.8.8',
          latency: 14.9,
          packet_loss: 12.0, // Spike
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

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => highLossResponse,
    });

    const { getByText } = render(<PacketLossChart />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      // Should show 2 spikes (packet loss > 5%)
      const spikesText = getByText('Spikes');
      expect(spikesText).toBeInTheDocument();
    });
  });
});
