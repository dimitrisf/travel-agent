// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { EndpointCard } from './EndpointCard';

describe('EndpointCard', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders title, blurb, and sample query', () => {
    render(
      <EndpointCard
        title="Weather"
        href="/explorer/weather"
        blurb="Current conditions and forecast."
        sample="GET /api/weather/current?city=Berlin"
      />,
    );
    expect(
      screen.getByRole('heading', { level: 2, name: 'Weather' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Current conditions and forecast.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('GET /api/weather/current?city=Berlin'),
    ).toBeInTheDocument();
  });

  it('links to the given href', () => {
    render(
      <EndpointCard
        title="Weather"
        href="/explorer/weather"
        blurb="x"
        sample="x"
      />,
    );
    // CardActionArea composes with next/link and renders an <a>.
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/explorer/weather');
  });
});
