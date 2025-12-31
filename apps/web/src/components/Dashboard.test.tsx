import { ChakraProvider } from '@chakra-ui/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from '@/components/Dashboard';

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

describe('Dashboard', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = vi.fn();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [],
        meta: {
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          count: 0,
        },
      }),
    });
  });

  it('should render dashboard title', () => {
    const { getByText } = render(<Dashboard />, {
      wrapper: createWrapper(),
    });

    expect(getByText('WAN Monitor')).toBeTruthy();
  });

  it('should render metric cards in top row', () => {
    const { getByText } = render(<Dashboard />, {
      wrapper: createWrapper(),
    });

    expect(getByText('Connectivity')).toBeTruthy();
    expect(getByText('Download Speed')).toBeTruthy();
    expect(getByText('Upload Speed')).toBeTruthy();
  });

  it('should render network quality section with chart labels', () => {
    const { getByText } = render(<Dashboard />, {
      wrapper: createWrapper(),
    });

    expect(getByText('Network Quality')).toBeTruthy();
    expect(getByText('Latency (ms)')).toBeTruthy();
    expect(getByText('Packet Loss (%)')).toBeTruthy();
    expect(getByText('Jitter (ms)')).toBeTruthy();
  });

  it('should display ISP name placeholder when no data', () => {
    const { getByText } = render(<Dashboard />, {
      wrapper: createWrapper(),
    });

    expect(getByText('Unknown ISP')).toBeTruthy();
  });

  it('should display offline status when no ping data', () => {
    const { getByText } = render(<Dashboard />, {
      wrapper: createWrapper(),
    });

    // When no data, connectivity_status is undefined, so shows Offline
    expect(getByText('Offline')).toBeTruthy();
  });

  it('should display online status when ping data shows up', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ connectivity_status: 'up', latency: 10, packet_loss: 0 }],
        meta: {
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          count: 1,
        },
      }),
    });

    const { findByText } = render(<Dashboard />, {
      wrapper: createWrapper(),
    });

    expect(await findByText('Online')).toBeTruthy();
  });
});
