// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { PanelHeader } from './PanelHeader';

describe('PanelHeader', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the title as an h2', () => {
    render(<PanelHeader title="Search flights" endpoint="GET /api/flights" />);
    expect(
      screen.getByRole('heading', { level: 2, name: 'Search flights' }),
    ).toBeInTheDocument();
  });

  it('renders the endpoint caption', () => {
    render(<PanelHeader title="X" endpoint="GET /api/weather/current" />);
    expect(screen.getByText('GET /api/weather/current')).toBeInTheDocument();
  });
});
