import { ChakraProvider } from '@chakra-ui/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { vi } from 'vitest';

export function createTestWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ChakraProvider>{children}</ChakraProvider>
    </QueryClientProvider>
  );
}

export function createMockAuthContext(overrides = {}) {
  return {
    isAuthenticated: true,
    isLoading: false,
    username: 'admin',
    authRequired: true,
    login: vi.fn(),
    logout: vi.fn(),
    checkAuth: vi.fn(),
    ...overrides,
  };
}

export function mockFetchWithAuthStatus(authRequired: boolean) {
  return (url: string) => {
    if (url.includes('/auth/status')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ authRequired }),
      });
    }
    return Promise.resolve({
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
  };
}
