import { ChakraProvider } from "@chakra-ui/react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MetricCard } from "@/components/MetricCard";

const renderWithChakra = (ui: React.ReactElement) => {
  return render(<ChakraProvider>{ui}</ChakraProvider>);
};

describe("MetricCard", () => {
  it("should render with title only", () => {
    const { getByText } = renderWithChakra(<MetricCard title="Test Metric" />);

    expect(getByText("Test Metric")).toBeTruthy();
  });

  it("should render with value and unit", () => {
    const { getByText } = renderWithChakra(
      <MetricCard title="Latency" value={15.3} unit="ms" />
    );

    expect(getByText("Latency")).toBeTruthy();
    expect(getByText("15.3")).toBeTruthy();
    expect(getByText("ms")).toBeTruthy();
  });

  it("should render with children", () => {
    const { getByText } = renderWithChakra(
      <MetricCard title="Chart">
        <div>Chart content</div>
      </MetricCard>
    );

    expect(getByText("Chart")).toBeTruthy();
    expect(getByText("Chart content")).toBeTruthy();
  });

  it("should render with good status", () => {
    const { container } = renderWithChakra(
      <MetricCard title="Status" value="Online" status="good" />
    );

    expect(container).toBeTruthy();
  });

  it("should render with warning status", () => {
    const { container } = renderWithChakra(
      <MetricCard title="Status" value="Degraded" status="warning" />
    );

    expect(container).toBeTruthy();
  });

  it("should render with error status", () => {
    const { container } = renderWithChakra(
      <MetricCard title="Status" value="Offline" status="error" />
    );

    expect(container).toBeTruthy();
  });

  it("should render string values", () => {
    const { getByText } = renderWithChakra(
      <MetricCard title="Connection" value="Connected" />
    );

    expect(getByText("Connected")).toBeTruthy();
  });

  it("should render numeric values", () => {
    const { getByText } = renderWithChakra(
      <MetricCard title="Count" value={42} />
    );

    expect(getByText("42")).toBeTruthy();
  });
});
