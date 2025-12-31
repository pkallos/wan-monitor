import { ChakraProvider } from "@chakra-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { SpeedMetric } from "@wan-monitor/shared";
import { describe, expect, it } from "vitest";
import { SpeedChart } from "@/components/charts/SpeedChart";

const mockData: SpeedMetric[] = [
  {
    timestamp: "2024-01-01T12:00:00.000Z",
    download_speed: 100.5,
    upload_speed: 50.2,
    latency: 10,
    jitter: 2,
    isp: "Test ISP",
  },
  {
    timestamp: "2024-01-01T12:30:00.000Z",
    download_speed: 95.3,
    upload_speed: 48.7,
    latency: 12,
    jitter: 3,
    isp: "Test ISP",
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

describe("SpeedChart", () => {
  it("should render without errors", () => {
    const { container } = render(<SpeedChart data={mockData} />, {
      wrapper: createWrapper(),
    });
    expect(container).toBeTruthy();
  });

  it("should display stats in non-compact mode", () => {
    const { getByText } = render(
      <SpeedChart data={mockData} compact={false} />,
      { wrapper: createWrapper() }
    );
    expect(getByText("Avg Download")).toBeTruthy();
    expect(getByText("Avg Upload")).toBeTruthy();
  });

  it("should hide stats in compact mode", () => {
    const { queryByText } = render(
      <SpeedChart data={mockData} compact={true} />,
      { wrapper: createWrapper() }
    );
    expect(queryByText("Avg Download")).toBeNull();
  });

  it("should handle empty data", () => {
    const { container } = render(<SpeedChart data={[]} />, {
      wrapper: createWrapper(),
    });
    expect(container).toBeTruthy();
  });

  it("should accept syncId prop", () => {
    const { container } = render(
      <SpeedChart data={mockData} syncId="test-sync" />,
      { wrapper: createWrapper() }
    );
    expect(container).toBeTruthy();
  });
});
