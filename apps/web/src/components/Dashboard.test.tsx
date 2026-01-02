import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiClient } from "@/api/client";
import { Dashboard } from "@/components/Dashboard";
import { createTestWrapper } from "@/test/utils";

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    username: "admin",
    authRequired: true,
    login: vi.fn(),
    logout: vi.fn(),
    checkAuth: vi.fn(),
  }),
}));

// Mock apiClient for speed test trigger tests
vi.mock("@/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/api/client")>();
  return {
    ...original,
    apiClient: {
      ...original.apiClient,
      get: vi.fn(),
      triggerSpeedTest: vi.fn(),
    },
  };
});

// Track toast calls
const mockToast = vi.fn();
vi.mock("@chakra-ui/react", async (importOriginal) => {
  const original = await importOriginal<typeof import("@chakra-ui/react")>();
  return {
    ...original,
    useToast: () => mockToast,
  };
});

const mockApiClientGet = apiClient.get as ReturnType<typeof vi.fn>;
const mockTriggerSpeedTest = apiClient.triggerSpeedTest as ReturnType<
  typeof vi.fn
>;

describe("Dashboard", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default mock for API get (metrics, connectivity)
    mockApiClientGet.mockResolvedValue({
      data: [],
      meta: {
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        count: 0,
      },
    });
    // Default mock for speed test trigger (no-op unless overridden)
    mockTriggerSpeedTest.mockResolvedValue({
      success: true,
      timestamp: new Date().toISOString(),
      result: {
        downloadMbps: 100,
        uploadMbps: 50,
        pingMs: 15,
      },
    });
  });

  it("should render dashboard title", () => {
    const { getByText } = render(<Dashboard />, {
      wrapper: createTestWrapper(),
    });

    expect(getByText("WAN Monitor")).toBeTruthy();
  });

  it("should render metric cards in top row", () => {
    const { getByText } = render(<Dashboard />, {
      wrapper: createTestWrapper(),
    });

    expect(getByText("Connectivity")).toBeTruthy();
    expect(getByText("Download Speed")).toBeTruthy();
    expect(getByText("Upload Speed")).toBeTruthy();
  });

  it("should render network quality section with chart labels", () => {
    const { getByText } = render(<Dashboard />, {
      wrapper: createTestWrapper(),
    });

    expect(getByText("Network Quality")).toBeTruthy();
    expect(getByText("Latency (ms)")).toBeTruthy();
    expect(getByText("Packet Loss (%)")).toBeTruthy();
    expect(getByText("Jitter (ms)")).toBeTruthy();
  });

  it("should display ISP name placeholder when no data", () => {
    const { getByText } = render(<Dashboard />, {
      wrapper: createTestWrapper(),
    });

    expect(getByText("Unknown ISP")).toBeTruthy();
  });

  it("should display offline status when no ping data", () => {
    const { getByText } = render(<Dashboard />, {
      wrapper: createTestWrapper(),
    });

    // When no data, connectivity_status is undefined, so shows Offline
    expect(getByText("Offline")).toBeTruthy();
  });

  it("should display online status when ping data shows up", async () => {
    mockApiClientGet.mockResolvedValue({
      data: [
        {
          source: "ping",
          connectivity_status: "up",
          latency: 10,
          packet_loss: 0,
          host: "8.8.8.8",
          timestamp: new Date().toISOString(),
        },
      ],
      meta: {
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        count: 1,
      },
    });

    const { findByText } = render(<Dashboard />, {
      wrapper: createTestWrapper(),
    });

    expect(await findByText("Online")).toBeTruthy();
  });

  it("should render speed test trigger button", () => {
    const { getByRole } = render(<Dashboard />, {
      wrapper: createTestWrapper(),
    });

    const button = getByRole("button", { name: /run speed test/i });
    expect(button).toBeTruthy();
  });

  it("should show loading state when speed test is running", async () => {
    // Delay speed test response to capture loading state
    mockTriggerSpeedTest.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                success: true,
                timestamp: new Date().toISOString(),
                result: {
                  downloadMbps: 100,
                  uploadMbps: 50,
                  pingMs: 15,
                },
              }),
            100
          );
        })
    );

    const { getByRole, getByText } = render(<Dashboard />, {
      wrapper: createTestWrapper(),
    });

    const button = getByRole("button", { name: /run speed test/i });
    fireEvent.click(button);

    // Button should show loading state
    await waitFor(() => {
      expect(getByText(/running/i)).toBeTruthy();
    });
  });

  it("should call apiClient.triggerSpeedTest when button is clicked", async () => {
    const { getByRole } = render(<Dashboard />, {
      wrapper: createTestWrapper(),
    });

    const button = getByRole("button", { name: /run speed test/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockTriggerSpeedTest).toHaveBeenCalledTimes(1);
    });
  });

  it("should show success toast when speed test completes", async () => {
    mockTriggerSpeedTest.mockResolvedValue({
      success: true,
      timestamp: new Date().toISOString(),
      result: {
        downloadMbps: 100.5,
        uploadMbps: 50.25,
        pingMs: 15,
      },
    });

    const { getByRole } = render(<Dashboard />, {
      wrapper: createTestWrapper(),
    });

    const button = getByRole("button", { name: /run speed test/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Speed test complete",
          status: "success",
        })
      );
    });
  });

  it("should show warning toast when speed test is already running", async () => {
    mockTriggerSpeedTest.mockResolvedValue({
      success: false,
      timestamp: new Date().toISOString(),
      error: {
        code: "SPEED_TEST_ALREADY_RUNNING",
        message: "A speed test is already in progress.",
      },
    });

    const { getByRole } = render(<Dashboard />, {
      wrapper: createTestWrapper(),
    });

    const button = getByRole("button", { name: /run speed test/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Speed test in progress",
          status: "warning",
        })
      );
    });
  });

  it("should show error toast when speed test fails", async () => {
    mockTriggerSpeedTest.mockResolvedValue({
      success: false,
      timestamp: new Date().toISOString(),
      error: {
        code: "SPEED_TEST_EXECUTION_FAILED",
        message: "Network connection failed",
      },
    });

    const { getByRole } = render(<Dashboard />, {
      wrapper: createTestWrapper(),
    });

    const button = getByRole("button", { name: /run speed test/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Speed test failed",
          status: "error",
        })
      );
    });
  });

  it("should show error toast on network error", async () => {
    mockTriggerSpeedTest.mockRejectedValue(new Error("Network unavailable"));

    const { getByRole } = render(<Dashboard />, {
      wrapper: createTestWrapper(),
    });

    const button = getByRole("button", { name: /run speed test/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Speed test failed",
          description: "Network unavailable",
          status: "error",
        })
      );
    });
  });

  it("should display DB unavailable banner when API returns DB_UNAVAILABLE", async () => {
    mockApiClientGet.mockRejectedValue(
      new ApiError("API error: 503", 503, {
        error: "DB_UNAVAILABLE",
        message: "Database temporarily unavailable",
        timestamp: new Date().toISOString(),
      })
    );

    const { findByText } = render(<Dashboard />, {
      wrapper: createTestWrapper(),
    });

    expect(
      await findByText(
        "Database temporarily unavailable. Retrying automatically."
      )
    ).toBeTruthy();
  });
});
