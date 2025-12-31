import { ChakraProvider } from '@chakra-ui/react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart';

const mockData = [
  { timestamp: '12:00', value: 10 },
  { timestamp: '12:01', value: 15 },
  { timestamp: '12:02', value: 12 },
  { timestamp: '12:03', value: 18 },
  { timestamp: '12:04', value: 14 },
];

const renderWithChakra = (ui: React.ReactElement) => {
  return render(<ChakraProvider>{ui}</ChakraProvider>);
};

describe('TimeSeriesChart', () => {
  it('should render without errors', () => {
    const { container } = renderWithChakra(
      <TimeSeriesChart
        data={mockData}
        xKey="timestamp"
        yKey="value"
        height={300}
      />
    );

    expect(container).toBeTruthy();
  });

  it('should display loading skeleton when isLoading is true', () => {
    renderWithChakra(
      <TimeSeriesChart
        data={mockData}
        xKey="timestamp"
        yKey="value"
        isLoading={true}
      />
    );

    const skeleton = document.querySelector('.chakra-skeleton');
    expect(skeleton).toBeTruthy();
  });

  it('should not show skeleton when isLoading is false', () => {
    renderWithChakra(
      <TimeSeriesChart
        data={mockData}
        xKey="timestamp"
        yKey="value"
        isLoading={false}
      />
    );

    const skeleton = document.querySelector('.chakra-skeleton');
    expect(skeleton).toBeFalsy();
  });

  it('should handle empty data array without errors', () => {
    const { container } = renderWithChakra(
      <TimeSeriesChart data={[]} xKey="timestamp" yKey="value" />
    );

    expect(container).toBeTruthy();
  });

  it('should accept all prop types without errors', () => {
    const formatXAxis = (value: unknown) => `T${value}`;
    const formatYAxis = (value: unknown) => `${value}ms`;
    const formatTooltip = (value: unknown) => `Value: ${value}`;

    const { container } = renderWithChakra(
      <TimeSeriesChart
        data={mockData}
        xKey="timestamp"
        yKey="value"
        color="#ff0000"
        unit="ms"
        height={400}
        formatXAxis={formatXAxis}
        formatYAxis={formatYAxis}
        formatTooltip={formatTooltip}
      />
    );

    expect(container).toBeTruthy();
  });
});
