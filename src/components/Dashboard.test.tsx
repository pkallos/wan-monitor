import { ChakraProvider } from '@chakra-ui/react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Dashboard } from '@/components/Dashboard';

const renderWithChakra = (ui: React.ReactElement) => {
  return render(<ChakraProvider>{ui}</ChakraProvider>);
};

describe('Dashboard', () => {
  it('should render dashboard title', () => {
    const { getByText } = renderWithChakra(<Dashboard />);

    expect(getByText('WAN Monitor')).toBeTruthy();
  });

  it('should render all metric cards', () => {
    const { getByText } = renderWithChakra(<Dashboard />);

    expect(getByText('Connectivity')).toBeTruthy();
    expect(getByText('Latency')).toBeTruthy();
    expect(getByText('Packet Loss')).toBeTruthy();
    expect(getByText('Jitter')).toBeTruthy();
    expect(getByText('Download Speed')).toBeTruthy();
    expect(getByText('Upload Speed')).toBeTruthy();
  });

  it('should render refresh button', () => {
    const { getByLabelText } = renderWithChakra(<Dashboard />);

    expect(getByLabelText('Refresh data')).toBeTruthy();
  });

  it('should display placeholder values', () => {
    const { getByText } = renderWithChakra(<Dashboard />);

    expect(getByText('Online')).toBeTruthy();
    expect(getByText('15.3')).toBeTruthy();
    expect(getByText('0.0')).toBeTruthy();
  });
});
