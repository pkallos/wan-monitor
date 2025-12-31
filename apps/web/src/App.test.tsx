import { ChakraProvider } from '@chakra-ui/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';

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

describe('App', () => {
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

  it('renders the dashboard', () => {
    render(<App />, { wrapper: createWrapper() });
    const heading = screen.getByRole('heading', { name: /WAN Monitor/i });
    expect(heading).toBeInTheDocument();
  });

  it('renders metric cards', () => {
    render(<App />, { wrapper: createWrapper() });
    expect(screen.getByText('Connectivity')).toBeInTheDocument();
    expect(screen.getByText('Latency')).toBeInTheDocument();
  });
});
