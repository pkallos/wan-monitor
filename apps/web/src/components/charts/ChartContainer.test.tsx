import { ChakraProvider } from '@chakra-ui/react';
import { render } from '@testing-library/react';
import { LineChart } from 'recharts';
import { describe, expect, it } from 'vitest';
import { ChartContainer } from '@/components/charts/ChartContainer';

const renderWithChakra = (ui: React.ReactElement) => {
  return render(<ChakraProvider>{ui}</ChakraProvider>);
};

const MockChart = () => <LineChart data={[]} />;

describe('ChartContainer', () => {
  it('should render children when not loading', () => {
    const { container } = renderWithChakra(
      <ChartContainer isLoading={false}>
        <MockChart />
      </ChartContainer>
    );

    expect(container).toBeTruthy();
    const skeleton = document.querySelector('.chakra-skeleton');
    expect(skeleton).toBeFalsy();
  });

  it('should render skeleton when loading', () => {
    renderWithChakra(
      <ChartContainer isLoading={true}>
        <MockChart />
      </ChartContainer>
    );

    const skeleton = document.querySelector('.chakra-skeleton');
    expect(skeleton).toBeTruthy();
  });

  it('should render without errors with custom height', () => {
    const customHeight = 500;
    const { container } = renderWithChakra(
      <ChartContainer height={customHeight} isLoading={false}>
        <MockChart />
      </ChartContainer>
    );

    expect(container).toBeTruthy();
  });

  it('should render with default props', () => {
    const { container } = renderWithChakra(
      <ChartContainer>
        <MockChart />
      </ChartContainer>
    );

    expect(container).toBeTruthy();
  });
});
