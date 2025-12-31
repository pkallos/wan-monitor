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

  it('should render all metric cards', () => {
    const { getByText } = render(<Dashboard />, {
      wrapper: createWrapper(),
    });

    expect(getByText('Connectivity')).toBeTruthy();
    expect(getByText('Latency')).toBeTruthy();
    expect(getByText('Packet Loss')).toBeTruthy();
    expect(getByText('Jitter')).toBeTruthy();
    expect(getByText('Download Speed')).toBeTruthy();
    expect(getByText('Upload Speed')).toBeTruthy();
  });

  it('should render refresh button', () => {
    const { getByLabelText } = render(<Dashboard />, {
      wrapper: createWrapper(),
    });

    expect(getByLabelText('Refresh data')).toBeTruthy();
  });

  it('should display placeholder values', () => {
    const { getByText } = render(<Dashboard />, {
      wrapper: createWrapper(),
    });

    expect(getByText('Online')).toBeTruthy();
    expect(getByText('0.0')).toBeTruthy();
  });
});
