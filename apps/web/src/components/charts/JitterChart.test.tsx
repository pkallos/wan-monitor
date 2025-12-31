import { ChakraProvider } from "@chakra-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { PingMetric } from "@wan-monitor/shared";
import { describe, expect, it } from "vitest";
import { JitterChart } from "@/components/charts/JitterChart";

const mockData: PingMetric[] = [
  {
    timestamp: "2024-01-01T12:00:00.000Z",
    host: "8.8.8.8",
    latency: 15.5,
    packet_loss: 0,
    connectivity_status: "connected",
    jitter: 2.3,
  },
  {
    timestamp: "2024-01-01T12:01:00.000Z",
    host: "8.8.8.8",
    latency: 16.2,
    packet_loss: 0,
    connectivity_status: "connected",
    jitter: 1.8,
  },
];

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ChakraProvider>{children}</ChakraProvider>
    </QueryClientProvider>
  );
};

describe("JitterChart", () => {
  it("should render without errors", () => {
    const { container } = render(<JitterChart data={mockData} />, {
      wrapper: createWrapper(),
    });
    expect(container).toBeTruthy();
  });

  it("should display stats in non-compact mode", () => {
    const { getByText } = render(
      <JitterChart data={mockData} compact={false} />,
      { wrapper: createWrapper() }
    );
    expect(getByText("Current")).toBeTruthy();
    expect(getByText("Avg")).toBeTruthy();
  });

  it("should hide stats in compact mode", () => {
    const { queryByText } = render(
      <JitterChart data={mockData} compact={true} />,
      { wrapper: createWrapper() }
    );
    expect(queryByText("Current")).toBeNull();
  });

  it("should handle empty data", () => {
    const { container } = render(<JitterChart data={[]} />, {
      wrapper: createWrapper(),
    });
    expect(container).toBeTruthy();
  });

  it("should handle data with undefined jitter", () => {
    const dataWithUndefinedJitter: PingMetric[] = [
      {
        timestamp: "2024-01-01T12:00:00.000Z",
        host: "8.8.8.8",
        latency: 15.5,
        packet_loss: 0,
        connectivity_status: "connected",
      },
    ];
    const { container } = render(
      <JitterChart data={dataWithUndefinedJitter} />,
      { wrapper: createWrapper() }
    );
    expect(container).toBeTruthy();
  });

  it("should accept syncId prop", () => {
    const { container } = render(
      <JitterChart data={mockData} syncId="test-sync" />,
      { wrapper: createWrapper() }
    );
    expect(container).toBeTruthy();
  });
});
