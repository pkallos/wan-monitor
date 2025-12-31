import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

describe("Dashboard", () => {
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
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
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
      }),
    });

    const { findByText } = render(<Dashboard />, {
      wrapper: createTestWrapper(),
    });

    expect(await findByText("Online")).toBeTruthy();
  });
});
