import { TOKEN_KEY } from "@/constants/auth";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  return {};
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// Speed test error codes from backend
export const SpeedTestErrorCode = {
  ALREADY_RUNNING: "SPEED_TEST_ALREADY_RUNNING",
  EXECUTION_FAILED: "SPEED_TEST_EXECUTION_FAILED",
  TIMEOUT: "SPEED_TEST_TIMEOUT",
} as const;

export type SpeedTestErrorCode =
  (typeof SpeedTestErrorCode)[keyof typeof SpeedTestErrorCode];

export interface SpeedTestTriggerSuccess {
  success: true;
  timestamp: string;
  result: {
    downloadMbps: number;
    uploadMbps: number;
    pingMs: number;
    jitter?: number;
    server?: string;
    isp?: string;
    externalIp?: string;
  };
}

export interface SpeedTestTriggerError {
  success: false;
  timestamp: string;
  error: {
    code: SpeedTestErrorCode;
    message: string;
  };
}

export type SpeedTestTriggerResult =
  | SpeedTestTriggerSuccess
  | SpeedTestTriggerError;

export const apiClient = {
  get: async <T>(
    path: string,
    params?: Record<string, string | undefined>
  ): Promise<T> => {
    // Construct full path by combining API_BASE with the relative path
    const fullPath = path.startsWith("/")
      ? `${API_BASE}${path}`
      : `${API_BASE}/${path}`;
    const url = new URL(fullPath, window.location.origin);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, value);
        }
      }
    }

    const res = await fetch(url.toString(), {
      headers: {
        ...getAuthHeaders(),
      },
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new ApiError(`API error: ${res.status}`, res.status, errorData);
    }

    return res.json();
  },

  post: async <T>(path: string, body: unknown): Promise<T> => {
    // Construct full path by combining API_BASE with the relative path
    const fullPath = path.startsWith("/")
      ? `${API_BASE}${path}`
      : `${API_BASE}/${path}`;
    const url = new URL(fullPath, window.location.origin);

    const res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders(),
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new ApiError(`API error: ${res.status}`, res.status, errorData);
    }

    return res.json();
  },

  triggerSpeedTest: async (): Promise<SpeedTestTriggerResult> => {
    const fullPath = `${API_BASE}/speedtest/trigger`;
    const url = new URL(fullPath, window.location.origin);

    const res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders(),
      },
      body: JSON.stringify({}),
    });

    // For speed test, we return the JSON body even on error responses
    // because the backend returns structured error info (409 for already running, 500 for failures)
    const data: SpeedTestTriggerResult = await res.json();

    // If we got a non-2xx status that isn't in our expected error responses, throw
    if (!res.ok && data.success !== false) {
      throw new ApiError(`API error: ${res.status}`, res.status, data);
    }

    return data;
  },
};
