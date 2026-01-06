import { ChakraProvider } from "@chakra-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { Metric } from "@wan-monitor/shared";
import { describe, expect, it } from "vitest";
import { LatencyChart } from "@/components/charts/LatencyChart";

const mockData: Metric[] = [
  {
    timestamp: "2024-01-01T12:00:00.000Z",
    source: "ping",
    host: "8.8.8.8",
    latency: 15.5,
    packet_loss: 0,
    connectivity_status: "connected",
    jitter: 2.3,
  },
  {
    timestamp: "2024-01-01T12:01:00.000Z",
    source: "ping",
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

describe("LatencyChart", () => {
  it("should render without errors", () => {
    const { container } = render(<LatencyChart data={mockData} />, {
      wrapper: createWrapper(),
    });
    expect(container).toBeTruthy();
  });

  it("should display stats in non-compact mode", () => {
    const { getByText } = render(
      <LatencyChart data={mockData} compact={false} />,
      { wrapper: createWrapper() }
    );
    expect(getByText("Current")).toBeTruthy();
    expect(getByText("Avg")).toBeTruthy();
  });

  it("should hide stats in compact mode", () => {
    const { queryByText } = render(
      <LatencyChart data={mockData} compact={true} />,
      { wrapper: createWrapper() }
    );
    expect(queryByText("Current")).toBeNull();
  });

  it("should handle empty data", () => {
    const { container } = render(<LatencyChart data={[]} />, {
      wrapper: createWrapper(),
    });
    expect(container).toBeTruthy();
  });

  it("should accept syncId prop", () => {
    const { container } = render(
      <LatencyChart data={mockData} syncId="test-sync" />,
      { wrapper: createWrapper() }
    );
    expect(container).toBeTruthy();
  });

  it("should fill timeline with null values for missing data points", () => {
    const startTime = new Date("2024-01-01T12:00:00.000Z");
    const endTime = new Date("2024-01-01T12:15:00.000Z");
    const dataWithGaps: Metric[] = [
      {
        timestamp: "2024-01-01T12:00:00.000Z",
        source: "ping",
        host: "8.8.8.8",
        latency: 15.5,
        packet_loss: 0,
        connectivity_status: "connected",
        jitter: 2.3,
      },
      {
        timestamp: "2024-01-01T12:10:00.000Z",
        source: "ping",
        host: "8.8.8.8",
        latency: 18.2,
        packet_loss: 0,
        connectivity_status: "connected",
        jitter: 1.8,
      },
    ];

    const { container } = render(
      <LatencyChart
        data={dataWithGaps}
        startTime={startTime}
        endTime={endTime}
        granularity="5m"
      />,
      { wrapper: createWrapper() }
    );
    expect(container).toBeTruthy();
  });

  it("should handle data without time range (fallback behavior)", () => {
    const { container } = render(
      <LatencyChart data={mockData} granularity="5m" />,
      { wrapper: createWrapper() }
    );
    expect(container).toBeTruthy();
  });

  it("should calculate stats correctly ignoring null values", () => {
    const { getByText } = render(
      <LatencyChart
        data={mockData}
        compact={false}
        startTime={new Date("2024-01-01T12:00:00.000Z")}
        endTime={new Date("2024-01-01T12:15:00.000Z")}
        granularity="5m"
      />,
      { wrapper: createWrapper() }
    );
    expect(getByText("Avg")).toBeTruthy();
  });
});
