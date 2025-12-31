import { ChakraProvider } from '@chakra-ui/react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyState, ErrorState } from '@/components/charts/ChartStates';

const renderWithChakra = (ui: React.ReactElement) => {
  return render(<ChakraProvider>{ui}</ChakraProvider>);
};

describe('ChartStates', () => {
  describe('ErrorState', () => {
    it('should render error message', () => {
      const { getByText } = renderWithChakra(
        <ErrorState message="Test error message" />
      );

      expect(getByText('Test error message')).toBeTruthy();
    });
  });

  describe('EmptyState', () => {
    it('should render empty message', () => {
      const { getByText } = renderWithChakra(
        <EmptyState message="No data available" />
      );

      expect(getByText('No data available')).toBeTruthy();
    });
  });
});
