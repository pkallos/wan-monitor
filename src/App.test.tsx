import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '@/App';

describe('App', () => {
  it('renders the dashboard', () => {
    render(
      <ChakraProvider>
        <App />
      </ChakraProvider>
    );
    const heading = screen.getByRole('heading', { name: /WAN Monitor/i });
    expect(heading).toBeInTheDocument();
  });

  it('renders metric cards', () => {
    render(
      <ChakraProvider>
        <App />
      </ChakraProvider>
    );
    expect(screen.getByText('Connectivity')).toBeInTheDocument();
    expect(screen.getByText('Latency')).toBeInTheDocument();
  });
});
