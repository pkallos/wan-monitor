import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('App', () => {
  it('renders the app title', () => {
    render(<App />);
    expect(screen.getByText('WAN Monitor')).toBeInTheDocument();
  });

  it('renders the initialization message', () => {
    render(<App />);
    expect(
      screen.getByText('Network monitoring dashboard - initialization complete')
    ).toBeInTheDocument();
  });
});
