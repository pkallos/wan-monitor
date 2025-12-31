import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';
import { createTestWrapper } from '@/test/utils';

describe('App', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    global.fetch = vi.fn();
  });

  it('renders the dashboard when auth is not required', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      (url: string) => {
        if (url.includes('/auth/status')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ authRequired: false }),
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
      }
    );

    render(<App />, { wrapper: createTestWrapper() });

    await waitFor(() => {
      const heading = screen.getByRole('heading', { name: /WAN Monitor/i });
      expect(heading).toBeInTheDocument();
    });
  });

  it('renders login page when auth is required and not authenticated', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      (url: string) => {
        if (url.includes('/auth/status')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ authRequired: true }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 401,
          json: async () => ({ error: 'Not authenticated' }),
        });
      }
    );

    render(<App />, { wrapper: createTestWrapper() });

    await waitFor(() => {
      expect(
        screen.getByText('Sign in to access the dashboard')
      ).toBeInTheDocument();
    });
  });

  it('renders metric cards when authenticated', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      (url: string) => {
        if (url.includes('/auth/status')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ authRequired: false }),
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
      }
    );

    render(<App />, { wrapper: createTestWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Connectivity')).toBeInTheDocument();
      expect(screen.getByText('Download Speed')).toBeInTheDocument();
      expect(screen.getByText('Upload Speed')).toBeInTheDocument();
    });
  });
});
