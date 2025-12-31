const API_BASE = import.meta.env.VITE_API_URL || '/api';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const apiClient = {
  get: async <T>(
    path: string,
    params?: Record<string, string | undefined>
  ): Promise<T> => {
    const url = new URL(path, window.location.origin + API_BASE);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, value);
        }
      }
    }

    const res = await fetch(url.toString());

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new ApiError(`API error: ${res.status}`, res.status, errorData);
    }

    return res.json();
  },

  post: async <T>(path: string, body: unknown): Promise<T> => {
    const url = new URL(path, window.location.origin + API_BASE);

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new ApiError(`API error: ${res.status}`, res.status, errorData);
    }

    return res.json();
  },
};
