import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePingMetrics } from '@/api/hooks/usePingMetrics';
import type { PingMetricsResponse } from '@/api/types';

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
  ],
  meta: {
    startTime: '2024-01-01T11:00:00.000Z',
    endTime: '2024-01-01T12:00:00.000Z',
    count: 2,
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
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('usePingMetrics', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = vi.fn();
  });

  it('should fetch ping metrics successfully', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const { result } = renderHook(() => usePingMetrics(), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(mockResponse);
    expect(result.current.error).toBeNull();
  });

  it('should pass query parameters correctly', async () => {
    const startTime = new Date('2024-01-01T10:00:00.000Z');
    const endTime = new Date('2024-01-01T12:00:00.000Z');
    const host = '1.1.1.1';
    const limit = 500;

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const { result } = renderHook(
      () =>
        usePingMetrics({
          startTime,
          endTime,
          host,
          limit,
        }),
      {
        wrapper: createWrapper(),
      }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const callUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const url = new URL(callUrl);

    expect(url.pathname).toBe('/metrics/ping');
    expect(url.searchParams.get('startTime')).toBe(startTime.toISOString());
    expect(url.searchParams.get('endTime')).toBe(endTime.toISOString());
    expect(url.searchParams.get('host')).toBe(host);
    expect(url.searchParams.get('limit')).toBe(limit.toString());
  });

  it('should handle API errors', async () => {
    const errorResponse = {
      error: 'Database error',
      message: 'Failed to query metrics',
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => errorResponse,
    });

    const { result } = renderHook(() => usePingMetrics(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeTruthy();
  });

  it('should respect enabled option', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const { result } = renderHook(() => usePingMetrics({ enabled: false }), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.isFetching).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should use default parameters when none provided', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const { result } = renderHook(() => usePingMetrics(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const callUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const url = new URL(callUrl);

    expect(url.pathname).toBe('/metrics/ping');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
