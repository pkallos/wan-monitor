import { render, screen } from "@testing-library/react";
import type { ConnectivityStatusPoint } from "@wan-monitor/shared";
import { describe, expect, it } from "vitest";
import { ConnectivityStatusChart } from "./ConnectivityStatusChart";

const mockData: ConnectivityStatusPoint[] = [
  {
    timestamp: "2024-01-01T10:00:00Z",
    status: "up",
    upPercentage: 100,
    downPercentage: 0,
    degradedPercentage: 0,
  },
  {
    timestamp: "2024-01-01T10:05:00Z",
    status: "degraded",
    upPercentage: 50,
    downPercentage: 0,
    degradedPercentage: 50,
  },
  {
    timestamp: "2024-01-01T10:10:00Z",
    status: "down",
    upPercentage: 0,
    downPercentage: 100,
    degradedPercentage: 0,
  },
];

describe("ConnectivityStatusChart", () => {
  it("renders without crashing", () => {
    render(<ConnectivityStatusChart data={mockData} uptimePercentage={99.5} />);
    expect(screen.getByText(/Uptime:/)).toBeInTheDocument();
  });

  it("displays uptime percentage", () => {
    render(<ConnectivityStatusChart data={mockData} uptimePercentage={99.5} />);
    expect(screen.getByText(/99.50%/)).toBeInTheDocument();
  });

  it("renders status bar segments", () => {
    const { getByTestId } = render(
      <ConnectivityStatusChart data={mockData} uptimePercentage={99.5} />
    );
    // Should have colored segments in the flex container
    const statusBar = getByTestId("connectivity-status-bar");
    const segments = statusBar.children;
    expect(segments.length).toBeGreaterThan(0);
  });

  it("displays uptime label", () => {
    render(<ConnectivityStatusChart data={mockData} uptimePercentage={99.5} />);
    expect(screen.getByText(/Uptime:/)).toBeInTheDocument();
  });

  it("renders colored status bar", () => {
    const { getByTestId } = render(
      <ConnectivityStatusChart data={mockData} uptimePercentage={99.5} />
    );
    // Should render a horizontal status bar with colored segments
    const statusBar = getByTestId("connectivity-status-bar");
    expect(statusBar).toBeInTheDocument();
  });

  it("shows loading state", () => {
    const { container } = render(
      <ConnectivityStatusChart
        data={[]}
        uptimePercentage={0}
        isLoading={true}
      />
    );
    // Shows a skeleton loader when loading
    expect(container.querySelector(".chakra-skeleton")).toBeInTheDocument();
  });

  it("handles empty data", () => {
    render(<ConnectivityStatusChart data={[]} uptimePercentage={0} />);
    expect(screen.getByText(/0.00%/)).toBeInTheDocument();
  });

  it("calculates status segments correctly", () => {
    const mixedData: ConnectivityStatusPoint[] = [
      {
        timestamp: "2024-01-01T10:00:00Z",
        status: "up",
        upPercentage: 80,
        downPercentage: 10,
        degradedPercentage: 10,
      },
      {
        timestamp: "2024-01-01T10:05:00Z",
        status: "up",
        upPercentage: 90,
        downPercentage: 5,
        degradedPercentage: 5,
      },
    ];

    const { getByTestId } = render(
      <ConnectivityStatusChart data={mixedData} uptimePercentage={85} />
    );
    // Should render multiple colored segments
    const statusBar = getByTestId("connectivity-status-bar");
    const segments = statusBar.children;
    expect(segments.length).toBeGreaterThan(0);
  });

  it("fills timeline from startTime when data starts later", () => {
    // Data only available from 10:30, but timeline should start at 10:00
    const sparseData: ConnectivityStatusPoint[] = [
      {
        timestamp: "2024-01-01T10:30:00Z",
        status: "up",
        upPercentage: 100,
        downPercentage: 0,
        degradedPercentage: 0,
      },
      {
        timestamp: "2024-01-01T10:35:00Z",
        status: "up",
        upPercentage: 100,
        downPercentage: 0,
        degradedPercentage: 0,
      },
    ];

    const startTime = new Date("2024-01-01T10:00:00Z");
    const endTime = new Date("2024-01-01T11:00:00Z");

    const { getByTestId } = render(
      <ConnectivityStatusChart
        data={sparseData}
        uptimePercentage={100}
        startTime={startTime}
        endTime={endTime}
        granularity="5m"
      />
    );

    // Should have segments for the full hour (12 segments for 5m intervals)
    // 6 "no data" segments before first data point + 2 data segments + more after
    const statusBar = getByTestId("connectivity-status-bar");
    const segments = statusBar.children;
    expect(segments.length).toBeGreaterThan(2); // More than just the 2 data points
  });

  it("fills timeline to endTime when data ends early", () => {
    // Data ends at 10:10, but timeline should go to 11:00
    const earlyEndingData: ConnectivityStatusPoint[] = [
      {
        timestamp: "2024-01-01T10:00:00Z",
        status: "up",
        upPercentage: 100,
        downPercentage: 0,
        degradedPercentage: 0,
      },
      {
        timestamp: "2024-01-01T10:05:00Z",
        status: "up",
        upPercentage: 100,
        downPercentage: 0,
        degradedPercentage: 0,
      },
      {
        timestamp: "2024-01-01T10:10:00Z",
        status: "up",
        upPercentage: 100,
        downPercentage: 0,
        degradedPercentage: 0,
      },
    ];

    const startTime = new Date("2024-01-01T10:00:00Z");
    const endTime = new Date("2024-01-01T11:00:00Z");

    const { getByTestId } = render(
      <ConnectivityStatusChart
        data={earlyEndingData}
        uptimePercentage={100}
        startTime={startTime}
        endTime={endTime}
        granularity="5m"
      />
    );

    // Should have 2 merged segments: 1 for "up" data (3 consecutive), 1 for "noInfo" (9 consecutive)
    const statusBar = getByTestId("connectivity-status-bar");
    const segments = statusBar.children;
    expect(segments.length).toBe(2);
  });

  it("fills complete timeline for 7-day range with sparse data", () => {
    // Only 2 data points over 7 days
    const verysSparseData: ConnectivityStatusPoint[] = [
      {
        timestamp: "2024-01-03T12:00:00Z",
        status: "up",
        upPercentage: 100,
        downPercentage: 0,
        degradedPercentage: 0,
      },
      {
        timestamp: "2024-01-05T12:00:00Z",
        status: "up",
        upPercentage: 100,
        downPercentage: 0,
        degradedPercentage: 0,
      },
    ];

    const startTime = new Date("2024-01-01T00:00:00Z");
    const endTime = new Date("2024-01-08T00:00:00Z");

    const { getByTestId } = render(
      <ConnectivityStatusChart
        data={verysSparseData}
        uptimePercentage={100}
        startTime={startTime}
        endTime={endTime}
        granularity="5m"
      />
    );

    // With merging, should have 5 segments: noInfo before first data, first up, noInfo between, second up, noInfo after
    const statusBar = getByTestId("connectivity-status-bar");
    const segments = statusBar.children;
    expect(segments.length).toBe(5);
  });
});
