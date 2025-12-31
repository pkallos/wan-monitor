import { ChakraProvider } from '@chakra-ui/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PingMetricsResponse } from '@/api/types';
import { LatencyChart } from '@/components/charts/LatencyChart';

const mockResponse: PingMetricsResponse = {
  data: [
    {
      timestamp: '2024-01-01T12:00:00.000Z',
      host: '8.8.8.8',
      latency: 15.5,
      packet_loss: 0,
      connectivity_status: 'connected',
      jitter: 2.3,
    },
    {
      timestamp: '2024-01-01T12:01:00.000Z',
      host: '8.8.8.8',
      latency: 16.2,
      packet_loss: 0,
      connectivity_status: 'connected',
      jitter: 1.8,
    },
    {
      timestamp: '2024-01-01T12:02:00.000Z',
      host: '8.8.8.8',
      latency: 14.9,
      packet_loss: 0,
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

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ChakraProvider>{children}</ChakraProvider>
    </QueryClientProvider>
  );
};

describe('LatencyChart', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = vi.fn();
  });

  it('should display stats when data loads', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const { getByText } = render(<LatencyChart />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(getByText('Current')).toBeTruthy();
      expect(getByText('Avg')).toBeTruthy();
      expect(getByText('Min/Max')).toBeTruthy();
    });
  });

  it('should show error state on API failure', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Server error' }),
    });

    const { getByText } = render(<LatencyChart />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(getByText('Failed to load latency data')).toBeInTheDocument();
    });
  });

  it('should show chart with full time range even when no data available', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [],
        meta: {
          startTime: '2024-01-01T11:00:00.000Z',
          endTime: '2024-01-01T12:00:00.000Z',
          count: 0,
        },
      }),
    });

    const { container } = render(<LatencyChart />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      // Should render chart container
      const chartContainer = container.querySelector(
        '.recharts-responsive-container'
      );
      expect(chartContainer).toBeInTheDocument();
    });
  });

  it('should accept time range props', async () => {
    const startTime = new Date('2024-01-01T10:00:00.000Z');
    const endTime = new Date('2024-01-01T12:00:00.000Z');

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    render(<LatencyChart startTime={startTime} endTime={endTime} />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    const callUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const url = new URL(callUrl);

    expect(url.searchParams.get('startTime')).toBe(startTime.toISOString());
    expect(url.searchParams.get('endTime')).toBe(endTime.toISOString());
  });

  it('should accept host prop', async () => {
    const host = '1.1.1.1';

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    render(<LatencyChart host={host} />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    const callUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const url = new URL(callUrl);

    expect(url.searchParams.get('host')).toBe(host);
  });
});
